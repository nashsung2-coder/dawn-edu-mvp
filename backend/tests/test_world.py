"""遊戲世界：寵物／島嶼／市集／探索／每週精選測試。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

os.environ["DAWN_DB"] = "/tmp/test_world.db"
if os.path.exists("/tmp/test_world.db"):
    os.remove("/tmp/test_world.db")

from app import db  # noqa: E402
from app.main import app  # noqa: E402

db.init_db()
client = TestClient(app)


def _reg(name):
    r = client.post("/api/v1/auth/register",
                    json={"name": name, "password": "pw1234"})
    assert r.status_code == 201, r.text
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _earn(h):
    r = client.post("/api/v1/game/earn", headers=h,
                    json={"amount": 50, "reason": "test"})
    assert r.status_code == 200, r.text



def _finish_battle(h, q="為何天空是藍色的？"):
    r = client.post("/api/v1/learn/sessions", headers=h,
                    json={"question": q, "grade_band": "國中"})
    sid = r.json()["id"]
    client.post(f"/api/v1/learn/sessions/{sid}/quiz", headers=h)
    client.post(f"/api/v1/learn/sessions/{sid}/quiz/answers", headers=h,
                json={"answers": [2, 1, 1]})
    client.post(f"/api/v1/learn/sessions/{sid}/feynman", headers=h,
                json={"explanation": "因為陽光中的藍光比較容易被大氣中的分子散射，所以我們看到的天空是藍色的，這就是瑞利散射的機制"})
    f = client.post(f"/api/v1/learn/sessions/{sid}/finish", headers=h, json={})
    assert f.status_code == 200, f.text
    return f.json(), sid


def test_pet_hatch_and_growth():
    h = _h(_reg("寵物者"))
    assert client.get("/api/v1/world/pet", headers=h).json()["pet"] is None
    fin, _ = _finish_battle(h)
    assert fin["pet"]["hatched"] is True
    pet = client.get("/api/v1/world/pet", headers=h).json()["pet"]
    assert pet["level"] == 1 and pet["exp"] == 0
    # 第二場 → 成長
    fin2, _ = _finish_battle(h, q="為何海水是鹹的？")
    assert fin2["pet"]["hatched"] is False
    pet2 = client.get("/api/v1/world/pet", headers=h).json()["pet"]
    assert pet2["exp"] == 60 or pet2["level"] > 1
    # 改名
    rn = client.post("/api/v1/world/pet/rename", headers=h,
                     json={"name": "小藍", "species": ""})
    assert rn.json()["pet"]["name"] == "小藍"


def test_island_and_build():
    h = _h(_reg("島主"))
    # 先賺星砂
    [_earn(h) for _ in range(10)]
    fin, sid = _finish_battle(h)
    isl = client.post("/api/v1/world/islands", headers=h,
                      json={"session_id": sid, "name": "藍天島", "topic": "天空"})
    assert isl.status_code == 201
    iid = isl.json()["island"]["id"]
    b = client.post("/api/v1/world/build", headers=h,
                    json={"island_id": iid, "btype": "圖書館"})
    assert b.status_code == 200, b.text
    assert b.json()["level"] == 1 and b.json()["cost"] == 50
    isls = client.get("/api/v1/world/islands", headers=h).json()["islands"]
    assert len(isls) == 1 and isls[0]["buildings"][0]["btype"] == "圖書館"


def test_market():
    hs = _h(_reg("賣家"))
    hb = _h(_reg("買家"))
    [_earn(hb) for _ in range(10)]
    fin, _ = _finish_battle(hs)
    badge_id = fin["badge"]["id"]
    pub = client.post("/api/v1/world/market", headers=hs,
                      json={"item_type": "badge", "item_id": badge_id,
                            "price": 100, "trade_kind": "sell"})
    assert pub.status_code == 201
    lid = pub.json()["id"]
    mk = client.get("/api/v1/world/market").json()["listings"]
    assert len(mk) == 1
    buy = client.post(f"/api/v1/world/market/{lid}/buy", headers=hb)
    assert buy.status_code == 200, buy.text
    assert "默契已歸零" in buy.json()["note"] or "歸零" in buy.json()["note"]
    # 買家武器庫有這把
    badges = client.get("/api/v1/learn/badges", headers=hb).json()["badges"]
    assert any(b["id"] == badge_id for b in badges)


def test_exploration():
    h = _h(_reg("探險家"))
    zones = client.get("/api/v1/world/zones").json()["zones"]
    assert len(zones) == 3
    e = client.post("/api/v1/world/explore", headers=h,
                    json={"zone": "迷霧群島"})
    assert e.status_code == 201
    eid = e.json()["id"]
    assert e.json()["current"]["title"] == "漂流瓶"
    # 走完三幕
    for _ in range(3):
        c = client.post(f"/api/v1/world/explore/{eid}/choose", headers=h,
                        json={"choice_index": 2})
        assert c.status_code == 200, c.text
    assert c.json()["done"] is True
    assert c.json()["reward"]["starsand"] == 30
    assert len(c.json()["trail"]) == 3


def test_weekly():
    h = _h(_reg("週報者"))
    _finish_battle(h)
    w = client.post("/api/v1/world/weekly", headers=h)
    assert w.status_code == 200, w.text
    d = w.json()
    assert isinstance(d["items"], list)
    assert d["attr_points"] >= 3
    assert "reflect_prompt" in d["review"]
    # 冪等
    w2 = client.post("/api/v1/world/weekly", headers=h)
    assert w2.json()["id"] == d["id"]
    # 屬性點
    pts = client.get("/api/v1/world/attr-points", headers=h).json()["points"]
    assert pts == d["attr_points"]
    badges = client.get("/api/v1/learn/badges", headers=h).json()["badges"]
    sp = client.post("/api/v1/world/attr-points/spend", headers=h,
                     json={"badge_id": badges[0]["id"], "points": 2, "route": "attack"})
    assert sp.status_code == 200, sp.text
    assert sp.json()["points_left"] == pts - 2
