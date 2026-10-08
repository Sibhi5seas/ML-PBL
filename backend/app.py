"""SmartFlix API + static frontend server."""
import json, os, random, urllib.parse
import numpy as np
from flask import Flask, jsonify, request, send_from_directory

from . import data_loader as dl, evaluate
from .engine import Engine
from .personas import PERSONAS, BY_KEY, affinity

ROOT = dl.ROOT
FRONT = os.path.join(ROOT, "frontend")
METRICS = os.path.join(dl.DATA, "metrics.json")

app = Flask(__name__, static_folder=FRONT, static_url_path="")
app.json.sort_keys = False

MOVIES = dl.load_movies()
RATINGS = dl.load_ratings(MOVIES)
ENGINE = Engine(MOVIES, RATINGS)
MEDIA = dl.load_media()
BY_ID = MOVIES.set_index("movieId")


def movie_dict(mid, extra=None):
    r = BY_ID.loc[int(mid)]
    i = ENGINE.idx_of[int(mid)]
    media = MEDIA.get(f"{r.title}|{r.year}", {})
    q = urllib.parse.quote_plus(f"{r.title} {r.year} official trailer")
    d = dict(
        id=int(mid), title=r.title, year=int(r.year), language=r.language,
        genres=[g for g in r.genres.split(",") if g], director=r.director,
        cast=[c for c in r.cast.split(",") if c], score=float(r.score), overview=r.overview,
        ratings=int(ENGINE.item_count[i]), avg=round(float(ENGINE.item_mean[i]), 2),
        poster=media.get("poster"), backdrop=media.get("backdrop"), trailer=media.get("trailer"),
        yt=f"https://www.youtube.com/results?search_query={q}",
    )
    if extra:
        d.update(extra)
    return d


def parse_profile(raw):
    out = {}
    for k, v in (raw or {}).items():
        try:
            if int(k) in ENGINE.idx_of:
                out[int(k)] = float(np.clip(float(v), 0.5, 5.0))
        except (ValueError, TypeError):
            pass
    return out


# ---------------- pages ----------------
@app.route("/")
def index():
    return send_from_directory(FRONT, "index.html")


# ---------------- API ----------------
@app.route("/api/meta")
def meta():
    langs = MOVIES["language"].value_counts()
    genres = {}
    for g in MOVIES["genres"]:
        for x in g.split(","):
            genres[x] = genres.get(x, 0) + 1
    hist = MOVIES.groupby(MOVIES["year"] // 5 * 5).size()
    return jsonify(
        movies=len(MOVIES), users=ENGINE.n_users, ratings=ENGINE.n_ratings,
        ratings_source=dl.ratings_source(),
        languages=[dict(name=k, count=int(v)) for k, v in langs.items()],
        genres=[dict(name=k, count=v) for k, v in sorted(genres.items(), key=lambda kv: -kv[1])],
        year_min=int(MOVIES.year.min()), year_max=int(MOVIES.year.max()),
        histogram=[dict(year=int(k), count=int(v)) for k, v in hist.items()],
        has_media=bool(MEDIA),
        personas=[{k: p[k] for k in ("key", "name", "tagline", "hue")} for p in PERSONAS],
    )


@app.route("/api/movies")
def movies():
    q = request.args.get("q", "").strip().lower()
    langs = [x for x in request.args.get("lang", "").split(",") if x]
    genres = [x for x in request.args.get("genre", "").split(",") if x]
    y0 = request.args.get("year_min", type=int)
    y1 = request.args.get("year_max", type=int)
    sort = request.args.get("sort", "popular")
    limit = request.args.get("limit", 60, type=int)
    offset = request.args.get("offset", 0, type=int)
    m = MOVIES
    if q:
        hay = (m.title + " " + m.director + " " + m.cast + " " + m.language + " " + m.genres).str.lower()
        m = m[hay.str.contains(q, regex=False)]
    if langs:
        m = m[m.language.isin(langs)]
    if genres:
        gs = set(genres)
        m = m[[bool(gs & set(g.split(","))) for g in m.genres]]
    if y0 is not None:
        m = m[m.year >= y0]
    if y1 is not None:
        m = m[m.year <= y1]
    idx = [ENGINE.idx_of[int(i)] for i in m.movieId]
    if sort == "year":
        order = np.argsort([-MOVIES.year.iloc[i] for i in idx], kind="stable")
    elif sort == "score":
        order = np.argsort([-MOVIES.score.iloc[i] for i in idx], kind="stable")
    elif sort == "title":
        order = np.argsort([MOVIES.title.iloc[i] for i in idx], kind="stable")
    else:
        order = np.argsort([-ENGINE.pop[i] for i in idx], kind="stable")
    ids = [int(m.movieId.iloc[o]) for o in order]
    return jsonify(total=len(ids), items=[movie_dict(i) for i in ids[offset:offset + limit]])


@app.route("/api/movie/<int:mid>")
def movie(mid):
    if mid not in ENGINE.idx_of:
        return jsonify(error="not found"), 404
    c, f = ENGINE.similar(mid, 8)
    return jsonify(movie=movie_dict(mid), similar=[movie_dict(i) for i in c], fans=[movie_dict(i) for i in f])


@app.route("/api/deck")
def deck():
    """A balanced, shuffled deck of well-known films for taste calibration."""
    n = request.args.get("n", 36, type=int)
    seed = request.args.get("seed", type=int)
    rng = random.Random(seed)
    groups = {"Tamil": [], "Hindi": [], "South": [], "English": []}
    order = np.argsort(-ENGINE.pop)
    for i in order[:200]:
        l = MOVIES.language.iloc[i]
        key = l if l in groups else ("English" if l == "English" else "South")
        if l in ("Telugu", "Malayalam", "Kannada", "Bengali", "Marathi"):
            key = "South"
        groups[key].append(int(MOVIES.movieId.iloc[i]))
    pool = []
    per = n // 4 + 2
    for k in groups:
        pool += groups[k][:per]
    rng.shuffle(pool)
    return jsonify(items=[movie_dict(i) for i in pool[:n]])


@app.route("/api/personas/<key>/seed")
def persona_seed(key):
    p = BY_KEY.get(key)
    if not p:
        return jsonify(error="unknown persona"), 404
    aff = np.array([affinity(p, l, g.split(",")) for l, g in zip(MOVIES.language, MOVIES.genres)])
    s = aff * (0.5 + ENGINE.pop)
    top = np.argsort(-s)[:7]
    ratings = {int(MOVIES.movieId.iloc[i]): (5.0 if r < 4 else 4.0) for r, i in enumerate(top)}
    return jsonify(ratings=ratings, items=[movie_dict(i) for i in ratings])


@app.route("/api/recommend", methods=["POST"])
def recommend():
    b = request.get_json(silent=True) or {}
    prof = parse_profile(b.get("ratings"))
    f = b.get("filters") or {}
    recs = ENGINE.recommend(
        prof, alpha=float(np.clip(b.get("alpha", 0.5), 0, 1)), diversity=float(np.clip(b.get("diversity", 0.2), 0, 1)),
        n=int(np.clip(b.get("n", 12), 1, 40)), langs=f.get("languages"), genres=f.get("genres"),
        year_min=f.get("year_min"), year_max=f.get("year_max"))
    items = []
    for r in recs:
        d = movie_dict(r["movieId"], dict(
            hybrid=round(r["hybrid"], 4), content=round(r["content"], 4), cf=round(r["cf"], 4), lead=r["lead"],
            because=[dict(id=i, title=BY_ID.loc[i].title) for i in r["because"]]))
        items.append(d)
    return jsonify(items=items, rated=len(prof), cold=len(prof) == 0,
                   alpha=b.get("alpha", 0.5), diversity=b.get("diversity", 0.2))


@app.route("/api/taste", methods=["POST"])
def taste():
    b = request.get_json(silent=True) or {}
    return jsonify(ENGINE.taste(parse_profile(b.get("ratings"))))


@app.route("/api/metrics")
def metrics():
    fp = f"{dl.catalog_hash()}-{len(RATINGS)}-{dl.ratings_source()}"
    if os.path.exists(METRICS):
        cached = json.load(open(METRICS))
        if cached.get("fingerprint") == fp:
            return jsonify(cached)
    res = evaluate.run(MOVIES, RATINGS)
    res["fingerprint"] = fp
    res["ratings_source"] = dl.ratings_source()
    json.dump(res, open(METRICS, "w"))
    return jsonify(res)


@app.route("/api/health")
def health():
    return jsonify(ok=True)
