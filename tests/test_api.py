"""Run:  python -m pytest tests   (or just: python tests/test_api.py)"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.app import app

c = app.test_client()

def test_meta():
    m = c.get("/api/meta").json
    assert m["movies"] > 200 and {"Tamil", "Hindi", "English"} <= {l["name"] for l in m["languages"]}

def test_recommend_changes_with_alpha():
    seed = c.get("/api/personas/kollywood/seed").json["ratings"]
    a = [r["id"] for r in c.post("/api/recommend", json=dict(ratings=seed, alpha=0, n=8)).json["items"]]
    b = [r["id"] for r in c.post("/api/recommend", json=dict(ratings=seed, alpha=1, n=8)).json["items"]]
    assert a != b and not set(a) & set(map(int, seed))

def test_cold_start():
    assert c.post("/api/recommend", json=dict(ratings={}, n=5)).json["cold"] is True

if __name__ == "__main__":
    test_meta(); test_recommend_changes_with_alpha(); test_cold_start(); print("all tests passed")
