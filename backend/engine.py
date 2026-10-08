"""SmartFlix hybrid recommendation engine.

Pipeline (see report, Section 4.1):
  Data -> Preprocessing -> Feature extraction -> {Content-Based, Collaborative}
       -> Hybrid engine -> Top-N ranking

  HybridScore(u,i) = alpha * ContentScore(u,i) + (1 - alpha) * CollaborativeScore(u,i)

Content-Based : TF-IDF over genres/language/director/cast/overview + cosine similarity.
Collaborative : item-based CF (mean-centred cosine with co-rating shrinkage, Sarwar et al. 2001).
Ranking       : min-max normalised hybrid score, optional MMR re-ranking for diversity.
"""
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS
from sklearn.metrics.pairwise import cosine_similarity


def _tok(s: str) -> str:
    return s.strip().lower().replace(" ", "_").replace(".", "").replace("'", "")


def _minmax(x, mask=None):
    x = np.asarray(x, float)
    sel = x if mask is None else x[mask]
    if sel.size == 0:
        return np.zeros_like(x)
    lo, hi = sel.min(), sel.max()
    if hi - lo < 1e-12:
        return np.full_like(x, 0.5)
    return (x - lo) / (hi - lo)


class Engine:
    K_NEIGHBOURS = 20
    SHRINK = 8.0

    def __init__(self, movies: pd.DataFrame, ratings: pd.DataFrame):
        self.movies = movies.reset_index(drop=True)
        self.n = len(self.movies)
        self.ids = self.movies["movieId"].to_numpy()
        self.idx_of = {int(m): i for i, m in enumerate(self.ids)}
        self._build_content()
        self._build_cf(ratings)

    # ---------- content-based ----------
    def _soup(self, r) -> str:
        toks = []
        genres = [g for g in r.genres.split(",") if g]
        toks += [("g_" + _tok(g) + " ") * 3 for g in genres]
        toks.append(("lang_" + _tok(r.language) + " ") * 2)
        toks += [("dir_" + _tok(d) + " ") * 2 for d in r.director.split(",")]
        toks += ["cast_" + _tok(c) for c in r.cast.split(",")]
        toks.append("dec_%d" % (r.year // 10 * 10))
        toks += [w for w in r.overview.lower().replace(",", " ").replace(".", " ").split()
                 if w not in ENGLISH_STOP_WORDS and len(w) > 2]
        return " ".join(toks)

    def _build_content(self):
        soup = [self._soup(r) for r in self.movies.itertuples()]
        self.tfidf = TfidfVectorizer(analyzer=lambda s: s.split(), sublinear_tf=True)
        self.X = self.tfidf.fit_transform(soup)
        self.S_content = cosine_similarity(self.X)
        np.fill_diagonal(self.S_content, 0.0)

    # ---------- collaborative ----------
    def _build_cf(self, ratings: pd.DataFrame):
        r = ratings[ratings["movieId"].isin(self.idx_of)].copy()
        users = {u: k for k, u in enumerate(sorted(r["userId"].unique()))}
        U, I = len(users), self.n
        M = np.zeros((U, I))
        mask = np.zeros((U, I))
        for u, m, v in zip(r["userId"], r["movieId"], r["rating"]):
            M[users[u], self.idx_of[int(m)]] = v
            mask[users[u], self.idx_of[int(m)]] = 1
        cnt_u = np.maximum(mask.sum(1), 1)
        mean_u = M.sum(1) / cnt_u
        Rc = (M - mean_u[:, None]) * mask
        num = Rc.T @ Rc
        norm = np.sqrt((Rc ** 2).sum(0))
        sim = num / (np.outer(norm, norm) + 1e-9)
        co = mask.T @ mask
        sim = sim * (co / (co + self.SHRINK))
        np.fill_diagonal(sim, 0.0)
        self.S_cf = sim
        self.M, self.mask, self.n_users = M, mask, U
        self.n_ratings = int(mask.sum())
        self.item_count = mask.sum(0)
        item_mean = np.where(self.item_count > 0, M.sum(0) / np.maximum(self.item_count, 1), 0)
        self.item_mean = item_mean
        # popularity prior (cold-start + baseline)
        cat = _minmax(self.movies["score"])
        self.pop = _minmax(0.55 * _minmax(np.log1p(self.item_count)) + 0.45 * cat)
        self.global_mean = float(M.sum() / max(mask.sum(), 1))

    # ---------- scoring ----------
    def components(self, profile: dict):
        """profile: {movieId: rating 0.5-5}. Returns raw component arrays."""
        pairs = [(self.idx_of[int(m)], float(v)) for m, v in profile.items() if int(m) in self.idx_of]
        n = self.n
        if not pairs:
            return None
        ridx = np.array([p[0] for p in pairs])
        vals = np.array([p[1] for p in pairs])
        center = 0.5 * vals.mean() + 0.5 * 3.0
        w = np.clip((vals - 3.0) / 2.0, -1, 1)
        if np.abs(w).sum() < 1e-9:
            w = np.full_like(w, 0.2)
        # content
        Sc = self.S_content[:, ridx]
        content = (Sc * w).sum(1) / np.abs(w).sum()
        # collaborative: top-k positive neighbours among rated items
        Sf = self.S_cf[:, ridx].copy()
        Sf[Sf < 0] = 0
        k = min(self.K_NEIGHBOURS, Sf.shape[1])
        if Sf.shape[1] > k:
            thr = -np.partition(-Sf, k - 1, axis=1)[:, k - 1:k]
            Sf = np.where(Sf >= thr, Sf, 0)
        dev = vals - center
        support = Sf.sum(1)
        cf_dev = (Sf * dev).sum(1) / np.maximum(support, 1e-9)
        cf_dev = cf_dev * support / (support + 0.15)
        return dict(ridx=ridx, vals=vals, w=w, center=center, content=content,
                    cf_dev=cf_dev, support=support, Sc=Sc, Sf=Sf, dev=dev)

    def score(self, profile: dict, alpha=0.5):
        comp = self.components(profile)
        if comp is None:
            z = np.zeros(self.n)
            return dict(hybrid=self.pop.copy(), content=z, cf=z, comp=None, cand=np.ones(self.n, bool))
        cand = np.ones(self.n, bool)
        cand[comp["ridx"]] = False
        c = _minmax(comp["content"], cand)
        f_raw = _minmax(comp["cf_dev"], cand & (comp["support"] > 1e-6))
        f = np.where(comp["support"] > 1e-6, f_raw, 0.3 * self.pop)
        hybrid = alpha * c + (1 - alpha) * f + 0.04 * self.pop
        return dict(hybrid=hybrid, content=c, cf=f, comp=comp, cand=cand)

    def predict_ratings(self, profile: dict):
        comp = self.components(profile)
        if comp is None:
            return np.full(self.n, self.global_mean)
        return np.clip(comp["center"] + comp["cf_dev"], 0.5, 5.0)

    # ---------- public recommend ----------
    def recommend(self, profile, alpha=0.5, diversity=0.2, n=12, langs=None, genres=None,
                  year_min=None, year_max=None, exclude=()):
        s = self.score(profile, alpha)
        ok = s["cand"].copy()
        m = self.movies
        if langs:
            ok &= m["language"].isin(langs).to_numpy()
        if genres:
            gs = set(genres)
            ok &= np.array([bool(gs & set(g.split(","))) for g in m["genres"]])
        if year_min is not None:
            ok &= (m["year"] >= year_min).to_numpy()
        if year_max is not None:
            ok &= (m["year"] <= year_max).to_numpy()
        for e in exclude:
            if int(e) in self.idx_of:
                ok[self.idx_of[int(e)]] = False
        hyb = np.where(ok, s["hybrid"], -1e9)
        lam = float(np.clip(diversity, 0, 1)) * 0.6
        chosen = []
        pool = np.argsort(-hyb)[: max(n * 6, 60)]
        pool = [i for i in pool if hyb[i] > -1e8]
        hmax = max((hyb[i] for i in pool), default=1) or 1
        while pool and len(chosen) < n:
            best, best_v = None, -1e18
            for i in pool:
                red = max((self.S_content[i, j] for j in chosen), default=0.0)
                v = (1 - lam) * (hyb[i] / hmax) - lam * red
                if v > best_v:
                    best, best_v = i, v
            chosen.append(best)
            pool.remove(best)
        out = []
        comp = s["comp"]
        for i in chosen:
            because = []
            if comp is not None:
                contrib = comp["Sc"][i] * comp["w"] + comp["Sf"][i] * np.maximum(comp["dev"], 0)
                for j in np.argsort(-contrib)[:2]:
                    if contrib[j] > 1e-6:
                        because.append(int(self.ids[comp["ridx"][j]]))
            c, f = float(s["content"][i]), float(s["cf"][i])
            out.append(dict(movieId=int(self.ids[i]), hybrid=float(s["hybrid"][i]), content=c, cf=f,
                            lead="content" if alpha * c >= (1 - alpha) * f else "collaborative",
                            because=because))
        return out

    def similar(self, movie_id, k=8):
        i = self.idx_of[int(movie_id)]
        top_c = [int(self.ids[j]) for j in np.argsort(-self.S_content[i])[:k]]
        top_f = [int(self.ids[j]) for j in np.argsort(-self.S_cf[i])[: k * 2] if self.S_cf[i, j] > 0][:k]
        return top_c, top_f

    def taste(self, profile):
        comp = self.components(profile)
        if comp is None:
            return dict(genres={}, languages={}, decades={})
        g, l, d = {}, {}, {}
        m = self.movies
        for idx, w in zip(comp["ridx"], comp["w"]):
            row = m.iloc[idx]
            wt = max(w, 0.0) + 0.05
            for gg in row.genres.split(","):
                g[gg] = g.get(gg, 0) + wt
            l[row.language] = l.get(row.language, 0) + wt
            dec = int(row.year // 10 * 10)
            d[dec] = d.get(dec, 0) + wt
        norm = lambda dct: {k: round(v / max(dct.values()), 3) for k, v in sorted(dct.items(), key=lambda kv: -kv[1])}
        return dict(genres=norm(g), languages=norm(l), decades={str(k): v for k, v in norm(d).items()})
