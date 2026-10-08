"""Use REAL MovieLens ratings for the SmartFlix catalog.

1. Download ml-32m.zip from https://grouplens.org/datasets/movielens/32m/ and unzip it.
2. python scripts/load_movielens.py path/to/ml-32m [--max-ratings 200000]

The script matches catalog films to MovieLens by normalised title + year, keeps the
ratings of users who rated >= 8 matched films (a manageable working subset, as in the
report) and writes data/ratings.csv in MovieLens format. Restart the server afterwards;
the metrics page recomputes automatically.
"""
import argparse, json, os, re, sys
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from backend import data_loader as dl  # noqa: E402


def norm(t):
    t = re.sub(r"\(.*?\)", "", t).lower()
    t = re.sub(r"^(.*), (the|a|an)$", r"\2 \1", t.strip())
    return re.sub(r"[^a-z0-9]+", "", t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--max-ratings", type=int, default=200000)
    ap.add_argument("--min-user", type=int, default=8)
    a = ap.parse_args()
    cat = dl.load_movies()
    ml = pd.read_csv(os.path.join(a.folder, "movies.csv"))
    ml["year"] = ml.title.str.extract(r"\((\d{4})\)\s*$").astype(float)
    ml["key"] = ml.title.map(norm) + "_" + ml.year.fillna(0).astype(int).astype(str)
    cat["key"] = cat.title.map(norm) + "_" + cat.year.astype(str)
    link = ml.merge(cat[["movieId", "key", "title"]], on="key", suffixes=("_ml", ""))
    print(f"matched {link.movieId_ml.nunique()} of {len(cat)} catalog films in MovieLens")
    mp = dict(zip(link.movieId_ml, link.movieId))
    chunks = []
    for ch in pd.read_csv(os.path.join(a.folder, "ratings.csv"), chunksize=2_000_000):
        ch = ch[ch.movieId.isin(mp)]
        chunks.append(ch)
    r = pd.concat(chunks)
    r["movieId"] = r.movieId.map(mp)
    r = r.groupby("userId").filter(lambda g: len(g) >= a.min_user)
    users = r.userId.drop_duplicates().sample(frac=1, random_state=1).tolist()
    keep, total = [], 0
    for u in users:
        g = r[r.userId == u]
        if total + len(g) > a.max_ratings:
            break
        keep.append(g)
        total += len(g)
    out = pd.concat(keep)
    out.to_csv(dl.RATINGS, index=False)
    json.dump({"source": "movielens-32m", "catalog": dl.catalog_hash()}, open(dl.RATINGS_META, "w"))
    print(f"wrote {len(out)} real ratings from {out.userId.nunique()} users -> {dl.RATINGS}")


if __name__ == "__main__":
    main()
