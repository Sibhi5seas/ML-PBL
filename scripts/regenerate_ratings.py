"""Regenerate the synthetic demo ratings (optional)."""
import os, sys, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from backend import data_loader as dl, synth  # noqa: E402

n = int(sys.argv[1]) if len(sys.argv) > 1 else 500
m = dl.load_movies()
synth.generate(m, n_users=n).to_csv(dl.RATINGS, index=False)
json.dump({"source": "synthetic", "catalog": dl.catalog_hash()}, open(dl.RATINGS_META, "w"))
print("done", n, "users")
