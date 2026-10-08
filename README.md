# SmartFlix — Hybrid Movie Recommendation System

Chennai Institute of Technology · Dept. of CSE · PBL (Machine Learning) 2026–27
Team: **M P Sibhi**, **Ruhan Prasad S** · Faculty guide: **Dr. T. Vignesh**

A cinematic web app + Python ML backend implementing the architecture in the PBL report:

```
MovieLens-format data → preprocessing → TF-IDF features ─┬─ content-based filtering ─┐
                                                          └─ item-based collaborative ─┴─ hybrid engine → Top-N ranking → UI
HybridScore(u,i) = α · ContentScore(u,i) + (1 − α) · CollaborativeScore(u,i)
```

## Run it (2 minutes)

```bash
cd smartflix
python -m venv venv
venv\Scripts\activate          # Windows        (macOS/Linux: source venv/bin/activate)
pip install -r requirements.txt
python run.py                  # opens http://127.0.0.1:5000
```
Python 3.9+. First start generates the demo ratings and evaluation metrics (a few seconds).

## What's inside

| Path | Purpose |
|---|---|
| `data/catalog.psv` | **248 real films** (title, year, language, genres, director, cast, score, plot): Tamil 46, Hindi 50, Telugu 20, Malayalam 22, Kannada 10, Bengali 6, Marathi 1, English/Hollywood 93. Edit it freely (pipe-separated). |
| `backend/engine.py` | TF-IDF + cosine content model, item-based CF (mean-centred cosine, co-rating shrinkage), hybrid blend, MMR diversity re-ranking, explanations. |
| `backend/evaluate.py` | Fixed train/test protocol: Precision@K, Recall@K, NDCG@K, hit-rate, MAE, RMSE, α-sweep, cold-start test. |
| `backend/app.py` | Flask REST API + serves the frontend. |
| `frontend/` | Vanilla JS/CSS/SVG/Canvas — no build step, no npm. |
| `scripts/` | `load_movielens.py`, `fetch_tmdb.py`, `regenerate_ratings.py`. |

API: `/api/meta`, `/api/movies`, `/api/movie/<id>`, `/api/deck`, `POST /api/recommend`, `POST /api/taste`, `/api/personas/<key>/seed`, `/api/metrics`.

## Using it
1. **Calibrate** — drag film cards right (love), up (like), left (not for me), or tap a persona orb. Keys: ← ↑ → ↓.
2. **Your reel** — turn the **α dial** (content ↔ collaborative) and **variety dial**; filter by language orbs and release-year scrubber.
3. **Universe** — browse/search all films. Press **/** or **Ctrl/⌘+K** anywhere for instant search.
4. **Lab** — live metrics and α-sweep computed on a held-out split.

## Two honest notes about the data

**1. Ratings are synthetic by default.** There is no real per-user rating data for this catalogue offline, so
`data/ratings.csv` is a seeded synthetic table (500 viewers, ~20k ratings, MovieLens format) generated from taste personas.
The Lab page says so explicitly. To use **real MovieLens 32M ratings**:
```bash
# download ml-32m.zip from https://grouplens.org/datasets/movielens/32m/ and unzip
python scripts/load_movielens.py path/to/ml-32m --max-ratings 200000
python run.py
```
It matches catalogue films to MovieLens by title+year and keeps a working subset (as in the report).
MovieLens contains few Indian-language films, so expect fewer matches for those; synthetic ratings remain the better demo for them.

**2. Posters/trailers.** Posters are generated (unique procedural art per film) so the site works offline. For **real posters,
backdrops and YouTube trailers**, get a free key at themoviedb.org/settings/api, then:
```bash
set TMDB_API_KEY=your_key        # Windows   (macOS/Linux: export TMDB_API_KEY=your_key)
python scripts/fetch_tmdb.py     # writes data/media.json, restart the server
```
Without a key, "Watch trailer" opens a YouTube search for the film's official trailer.
Scores in the catalogue are approximate public ratings, included for ranking/priors.

## Results
Metrics shown in the Lab are computed live from `backend/evaluate.py` — nothing is hard-coded. On the bundled synthetic data,
collaborative filtering alone is slightly stronger than a 50/50 blend (the synthetic taste structure is collaborative by construction);
the hybrid's value is explainability, coverage of unrated films and the tunable α. Re-run on real MovieLens to get real numbers.

## Troubleshooting
* Blank loader / "backend not reachable" → start with `python run.py` and open http://127.0.0.1:5000 (not the HTML file directly).
* Port busy → `set PORT=5050` then `python run.py`.
* Fonts need internet (Google Fonts); the site falls back to system fonts offline.
