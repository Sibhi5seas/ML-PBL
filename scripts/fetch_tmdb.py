"""Fetch real posters, backdrops and trailer keys from TMDB -> data/media.json

    set TMDB_API_KEY=your_key        (Windows)
    export TMDB_API_KEY=your_key     (macOS / Linux)
    python scripts/fetch_tmdb.py

Safe to re-run: already fetched titles are skipped. Uses only the standard library.
"""
import json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from backend import data_loader as dl  # noqa: E402

KEY = os.environ.get("TMDB_API_KEY") or ""
if not KEY and os.path.exists(os.path.join(ROOT, ".env")):
    for line in open(os.path.join(ROOT, ".env")):
        if line.startswith("TMDB_API_KEY="):
            KEY = line.split("=", 1)[1].strip()
if not KEY:
    sys.exit("Set TMDB_API_KEY (env var or .env file). Free key: https://www.themoviedb.org/settings/api")

IMG = "https://image.tmdb.org/t/p/"


def get(path, **params):
    params["api_key"] = KEY
    url = f"https://api.themoviedb.org/3{path}?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.load(r)


def main():
    movies = dl.load_movies()
    media = dl.load_media()
    for n, r in enumerate(movies.itertuples(), 1):
        k = f"{r.title}|{r.year}"
        if k in media and media[k].get("poster"):
            continue
        try:
            res = get("/search/movie", query=r.title, year=r.year).get("results") or \
                  get("/search/movie", query=r.title).get("results") or []
            if not res:
                print(f"[{n}/{len(movies)}] no match: {k}")
                continue
            hit = res[0]
            vids = get(f"/movie/{hit['id']}/videos").get("results", [])
            yt = [v for v in vids if v["site"] == "YouTube"]
            yt.sort(key=lambda v: (v["type"] != "Trailer", not v.get("official", False)))
            media[k] = dict(
                poster=IMG + "w500" + hit["poster_path"] if hit.get("poster_path") else None,
                backdrop=IMG + "w1280" + hit["backdrop_path"] if hit.get("backdrop_path") else None,
                trailer=yt[0]["key"] if yt else None,
            )
            print(f"[{n}/{len(movies)}] ok: {k}  trailer={'yes' if yt else 'no'}")
        except Exception as e:  # network hiccup: keep going
            print(f"[{n}/{len(movies)}] error {k}: {e}")
        if n % 20 == 0:
            json.dump(media, open(dl.MEDIA, "w", encoding="utf-8"), indent=1)
        time.sleep(0.12)
    json.dump(media, open(dl.MEDIA, "w", encoding="utf-8"), indent=1)
    print("Saved", dl.MEDIA)


if __name__ == "__main__":
    main()
