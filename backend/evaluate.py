"""Offline evaluation with a fixed train/test protocol (report, Sec. 4.5 & 6.1).

Per user: 25 % of their ratings are held out (seeded). Models see only the
remaining 75 %. "Relevant" = held-out rating >= 4. Metrics: Precision@K,
Recall@K, NDCG@K (Top-N) and MAE / RMSE (rating prediction).
"""
import numpy as np
from .engine import Engine


def _dcg(rel):
    return float(sum(r / np.log2(i + 2) for i, r in enumerate(rel)))


def _topn_metrics(rank_idx, relevant, k):
    top = rank_idx[:k]
    hits = [1.0 if i in relevant else 0.0 for i in top]
    p = sum(hits) / k
    r = sum(hits) / len(relevant)
    ideal = _dcg([1.0] * min(len(relevant), k))
    return p, r, (_dcg(hits) / ideal if ideal else 0.0), (1.0 if sum(hits) > 0 else 0.0)


def run(movies, ratings, k=10, seed=7, test_frac=0.25):
    rng = np.random.default_rng(seed)
    ratings = ratings.sample(frac=1.0, random_state=seed).reset_index(drop=True)
    test_idx = []
    for _, g in ratings.groupby("userId"):
        if len(g) < 8:
            continue
        t = rng.choice(g.index.to_numpy(), size=max(2, int(len(g) * test_frac)), replace=False)
        test_idx.extend(t.tolist())
    test = ratings.loc[test_idx]
    train = ratings.drop(index=test_idx)
    eng = Engine(movies, train)
    train_by_u = {u: dict(zip(g.movieId, g.rating)) for u, g in train.groupby("userId")}
    test_by_u = {u: dict(zip(g.movieId, g.rating)) for u, g in test.groupby("userId")}

    alphas = [round(a, 1) for a in np.arange(0, 1.01, 0.1)]
    methods = {"Popularity": None, "Content-Based": 1.0, "Collaborative": 0.0, "SmartFlix Hybrid": 0.5}
    acc = {m: [] for m in methods}
    cold = {m: [] for m in methods}   # cold-start: only 3 known ratings per user
    sweep = {a: [] for a in alphas}
    err_cf, err_user, err_glob = [], [], []

    for u, prof in train_by_u.items():
        te = test_by_u.get(u, {})
        relevant = {eng.idx_of[int(m)] for m, v in te.items() if v >= 4.0}
        if not relevant:
            continue
        seen = {eng.idx_of[int(m)] for m in prof}
        comp = eng.components(prof)
        if comp is None:
            continue
        for name, a in methods.items():
            sc = eng.pop.copy() if a is None else eng.score(prof, a)["hybrid"]
            sc = sc.copy()
            sc[list(seen)] = -1e9
            acc[name].append(_topn_metrics(np.argsort(-sc), relevant, k))
        keys = list(prof.keys())
        if len(keys) >= 6:
            pick = rng.choice(len(keys), size=3, replace=False)
            prof3 = {keys[i]: prof[keys[i]] for i in pick}
            for name, a in methods.items():
                sc = eng.pop.copy() if a is None else eng.score(prof3, a)["hybrid"]
                sc = sc.copy()
                sc[list(seen)] = -1e9
                cold[name].append(_topn_metrics(np.argsort(-sc), relevant, k))
        for a in alphas:
            sc = eng.score(prof, a)["hybrid"].copy()
            sc[list(seen)] = -1e9
            sweep[a].append(_topn_metrics(np.argsort(-sc), relevant, k)[2])
        pred = np.clip(comp["center"] + comp["cf_dev"], 0.5, 5.0)
        umean = float(np.mean(list(prof.values())))
        for m, v in te.items():
            err_cf.append(pred[eng.idx_of[int(m)]] - v)
            err_user.append(umean - v)
            err_glob.append(eng.global_mean - v)

    def agg(rows):
        a = np.array(rows)
        return dict(precision=float(a[:, 0].mean()), recall=float(a[:, 1].mean()),
                    ndcg=float(a[:, 2].mean()), hit=float(a[:, 3].mean()))

    rmse = lambda e: float(np.sqrt(np.mean(np.square(e))))
    mae = lambda e: float(np.mean(np.abs(e)))
    return dict(
        k=k, users_evaluated=len(acc["Popularity"]), train_ratings=int(len(train)), test_ratings=int(len(test)),
        methods={m: agg(r) for m, r in acc.items()},
        cold_start={m: agg(r) for m, r in cold.items()},
        alpha_sweep=[dict(alpha=a, ndcg=float(np.mean(v))) for a, v in sweep.items()],
        rating_prediction=dict(
            collaborative=dict(mae=mae(err_cf), rmse=rmse(err_cf)),
            user_mean=dict(mae=mae(err_user), rmse=rmse(err_user)),
            global_mean=dict(mae=mae(err_glob), rmse=rmse(err_glob))),
    )
