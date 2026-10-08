import hashlib, json, os
import pandas as pd
from . import synth

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CATALOG = os.path.join(DATA, "catalog.psv")
RATINGS = os.path.join(DATA, "ratings.csv")
RATINGS_META = os.path.join(DATA, "ratings.meta.json")
MEDIA = os.path.join(DATA, "media.json")


def load_movies() -> pd.DataFrame:
    df = pd.read_csv(CATALOG, sep="|").fillna("")
    df.insert(0, "movieId", range(1, len(df) + 1))
    df["year"] = df["year"].astype(int)
    df["score"] = df["score"].astype(float)
    return df


def catalog_hash() -> str:
    with open(CATALOG, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()[:12]


def load_ratings(movies: pd.DataFrame) -> pd.DataFrame:
    """Return ratings; build the synthetic table on first run."""
    meta = {}
    if os.path.exists(RATINGS_META):
        meta = json.load(open(RATINGS_META))
    stale = (not os.path.exists(RATINGS)) or (meta.get("source") == "synthetic" and meta.get("catalog") != catalog_hash())
    if stale:
        print("[smartflix] generating synthetic demo ratings ...")
        r = synth.generate(movies)
        r.to_csv(RATINGS, index=False)
        json.dump({"source": "synthetic", "catalog": catalog_hash()}, open(RATINGS_META, "w"))
        return r
    return pd.read_csv(RATINGS)


def ratings_source() -> str:
    if os.path.exists(RATINGS_META):
        return json.load(open(RATINGS_META)).get("source", "unknown")
    return "unknown"


def load_media() -> dict:
    if os.path.exists(MEDIA):
        try:
            return json.load(open(MEDIA, encoding="utf-8"))
        except Exception:
            return {}
    return {}
