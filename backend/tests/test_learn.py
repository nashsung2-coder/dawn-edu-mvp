"""費曼戰役：學習會話測試。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

os.environ["DAWN_DB"] = "/tmp/test_learn.db"
if os.path.exists("/tmp/test_learn.db"):
    os.remove("/tmp/test_learn.db")

from app import db  # noqa: E402
from app.main import app  # noqa: E402

db.init_db()
client = TestClient(app)


def _reg(name="學習者"):
    r = client.post("/api/v1/auth/register",
                    json={"name": name, "password": "pw1234"})
    assert r.status_code == 201, r.text
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_full_battle_flow():
    token = _reg("戰役者")
    h = _h(token)
    # 開場
    r = client.post("/api/v1/learn/sessions", headers=h,
                    json={"question": "為何遠古時期嬰兒啼哭不會引發野獸？",
                          "grade_band": "高中", "hypothesis": "可能因為野獸怕火"})
    assert r.status_code == 201, r.text
    d = r.json()
    sid = d["id"]
    assert d["depth_level"] == 1
    assert "教會 AI" in d["teaching_preview"]
    # 測驗
    q = client.post(f"/api/v1/learn/sessions/{sid}/quiz", headers=h)
    assert q.status_code == 200, q.text
    assert q.json()["count"] == 3
    assert q.json()["llm"] is False  # 無 key 時降級
    # 作答（全對第一題選項 index 2）
    a = client.post(f"/api/v1/learn/sessions/{sid}/quiz/answers", headers=h,
                    json={"answers": [2, 1, 1]})
    assert a.status_code == 200, a.text
    assert a.json()["correct_count"] == 3
    assert a.json()["mastery"] > 0.15
    # 費曼解釋
    f = client.post(f"/api/v1/learn/sessions/{sid}/feynman", headers=h,
                    json={"explanation": "因為人類會用火和群體保護嬰兒，所以野獸不敢靠近，"
                                         "這其實是群體防禦機制導致的。但是如果落單就危險了。"})
    assert f.status_code == 200, f.text
    assert f.json()["build_score"] > 0
    assert f.json()["can_finish"] is True
    # 授勳
    fin = client.post(f"/api/v1/learn/sessions/{sid}/finish", headers=h,
                      json={"badge_name": "啼哭悖論之刃"})
    assert fin.status_code == 200, fin.text
    badge = fin.json()["badge"]
    assert badge["name"] == "啼哭悖論之刃"
    assert badge["attack"] > 10 and badge["defense"] > 10
    # 武器庫
    b = client.get("/api/v1/learn/badges", headers=h)
    assert len(b.json()["badges"]) == 1
    # 掌握度
    m = client.get("/api/v1/learn/mastery", headers=h)
    assert len(m.json()["topics"]) == 1
    assert m.json()["topics"][0]["sessions_count"] == 1
    # 課本章節
    t = client.get("/api/v1/learn/textbook", headers=h)
    chs = t.json()["chapters"]
    assert len(chs) == 1
    assert chs[0]["question"] == "為何遠古時期嬰兒啼哭不會引發野獸？"
    assert "群體防禦" in chs[0]["explanation"]
    assert chs[0]["badge"]["name"] == "啼哭悖論之刃"


def test_spiral_depth():
    token = _reg("螺旋者")
    h = _h(token)
    for i in range(2):
        r = client.post("/api/v1/learn/sessions", headers=h,
                        json={"question": "為何天空是藍色的？", "grade_band": "國中"})
        assert r.json()["depth_level"] == i + 1
        sid = r.json()["id"]
        # 快速走完
        client.post(f"/api/v1/learn/sessions/{sid}/quiz", headers=h)
        client.post(f"/api/v1/learn/sessions/{sid}/quiz/answers", headers=h,
                    json={"answers": [0, 0, 0]})
        client.post(f"/api/v1/learn/sessions/{sid}/feynman", headers=h,
                    json={"explanation": "因為陽光中的藍光比較容易被大氣散射，所以看到藍色"})
        client.post(f"/api/v1/learn/sessions/{sid}/finish", headers=h, json={})
    m = client.get("/api/v1/learn/mastery", headers=h)
    topics = {t["topic"]: t for t in m.json()["topics"]}
    key = [k for k in topics if "天空" in k][0]
    assert topics[key]["sessions_count"] == 2


def test_validation():
    token = _reg("驗證者")
    h = _h(token)
    r = client.post("/api/v1/learn/sessions", headers=h,
                    json={"question": "", "grade_band": "高中"})
    assert r.status_code == 400
    r = client.post("/api/v1/learn/sessions", headers=h,
                    json={"question": "有效問題", "grade_band": "亂填"})
    assert r.json()["grade_band"] == "高中"  # 非法年級段回退
    sid = r.json()["id"]
    f = client.post(f"/api/v1/learn/sessions/{sid}/feynman", headers=h,
                    json={"explanation": "太短"})
    assert f.status_code == 400
