"""Synthetic rating generator.

The catalog (data/catalog.psv) is real. Real per-user ratings for it do not exist
offline, so a *seeded synthetic* ratings table is generated in the MovieLens
format (userId, movieId, rating, timestamp) with latent taste personas.
Replace it with real MovieLens data via scripts/load_movielens.py.
"""
import numpy as np
import pandas as pd
from .personas import PERSONAS, affinity


def generate(movies: pd.DataFrame, n_users=500, seed=42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    genres = [g.split(",") for g in movies["genres"]]
    langs = movies["language"].tolist()
    scores = movies["score"].to_numpy(float)
    ids = movies["movieId"].to_numpy()
    # popularity prior: well-scored + (slightly) recent + mass-market languages
    lang_mass = np.array([{"English": 1.0, "Hindi": .9, "Tamil": .85, "Telugu": .75}.get(l, .55) for l in langs])
    pop = np.exp((scores - 7.5) * 0.8) * lang_mass * (1 + 0.012 * (movies["year"].to_numpy() - 1950).clip(0))
    rows = []
    for u in range(1, n_users + 1):
        primary = PERSONAS[rng.integers(len(PERSONAS))]
        secondary = PERSONAS[rng.integers(len(PERSONAS))] if rng.random() < .4 else None
        aff = np.array([affinity(primary, l, g) for l, g in zip(langs, genres)])
        if secondary is not None:
            aff = np.maximum(aff, 0.6 * np.array([affinity(secondary, l, g) for l, g in zip(langs, genres)]))
        p = pop * np.exp(2.2 * aff)
        p /= p.sum()
        k = int(rng.integers(22, 60))
        pick = rng.choice(len(movies), size=k, replace=False, p=p)
        generosity = rng.normal(0, 0.25)
        for i in pick:
            r = 2.1 + 2.0 * aff[i] + 0.35 * (scores[i] - 7.5) + generosity + rng.normal(0, 0.55)
            r = float(np.clip(np.round(r * 2) / 2, 0.5, 5.0))
            rows.append((u, int(ids[i]), r, 1_600_000_000 + int(rng.integers(0, 90_000_000))))
    return pd.DataFrame(rows, columns=["userId", "movieId", "rating", "timestamp"])
