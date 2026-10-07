"""曙光教育智能系統 MVP — API 測試。"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DAWN_DB", str(tmp_path / "test.db"))
    from app.main import app

    with TestClient(app) as c:
        yield c


def test_tags_tree(client):
    r = client.get("/api/v1/tags")
    assert r.status_code == 200
    dims = {d["code"]: d for d in r.json()["dimensions"]}
    assert set(["SUBJ", "CONC", "COGN", "STAGE", "LIFE", "INTER", "DIFF", "ABIL", "PSYC", "SAFE"]) <= set(dims)
    subj_names = [t["name"] for t in dims["SUBJ"]["tags"]]
    assert "物理" in subj_names and "地球科學" in subj_names
    # 別名欄位存在
    chem = next(t for t in dims["SUBJ"]["tags"] if t["name"] == "物理")
    assert "理化" in chem["aliases"]


def test_contents_list_and_detail(client):
    r = client.get("/api/v1/contents")
    assert r.status_code == 200
    assert r.json()["total"] == 30
    cid = r.json()["items"][0]["id"]
    r2 = client.get(f"/api/v1/contents/{cid}")
    assert r2.status_code == 200
    assert len(r2.json()["tags"]) >= 3
    assert r2.json()["tags"][0].count(":") == 1
    assert client.get("/api/v1/contents/99999").status_code == 404


def test_intersection_strict(client):
    r = client.get("/api/v1/search/intersection",
                   params={"tags": "SUBJ:物理,CONC:蒸發", "mode": "strict"})
    assert r.status_code == 200
    data = r.json()
    assert data["mode"] == "strict"
    assert len(data["results"]) > 0
    for item in data["results"]:
        assert "SUBJ:物理" in item["matched_tags"]
        assert "CONC:蒸發" in item["matched_tags"]
        assert item["match_score"] == 1.0
        assert "命中" in item["reason"]


def test_intersection_weighted_ordering(client):
    r = client.get("/api/v1/search/intersection",
                   params={"tags": "SUBJ:物理,CONC:蒸發,LIFE:浴室", "mode": "weighted"})
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) > 0
    scores = [x["match_score"] for x in results]
    assert scores == sorted(scores, reverse=True)
    assert all("reason" in x and x["reason"] for x in results)


def test_intersection_fuzzy_partial(client):
    # 物理＋月相：幾乎沒有內容同時命中 → fuzzy 應回傳部分符合＋匹配度
    r = client.get("/api/v1/search/intersection",
                   params={"tags": "SUBJ:物理,CONC:月相", "mode": "fuzzy"})
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) > 0
    assert any(x["match_score"] < 1.0 for x in results)
    partial = next(x for x in results if x["match_score"] < 1.0)
    assert "匹配度" in partial["reason"]


def test_intersection_alias_and_exclude(client):
    # 別名：地科 → 地球科學
    r = client.get("/api/v1/search/intersection",
                   params={"tags": "SUBJ:地科", "mode": "strict"})
    assert r.status_code == 200
    assert r.json()["wanted"] == ["SUBJ:地球科學"]
    assert len(r.json()["results"]) > 0
    # 排除 DIFF:L4
    r2 = client.get("/api/v1/search/intersection",
                    params={"tags": "SUBJ:地球科學", "mode": "weighted", "exclude": "DIFF:L4"})
    assert r2.status_code == 200
    for item in r2.json()["results"]:
        detail = client.get(f"/api/v1/contents/{item['id']}").json()
        assert "DIFF:L4 挑戰" not in detail["tags"]


def test_learning_events_and_flow(client):
    r = client.post("/api/v1/learning-events",
                    json={"user_id": "u1", "content_id": 1, "event_type": "view"})
    assert r.status_code == 200 and r.json()["ok"]
    r = client.post("/api/v1/flow-deposits",
                    json={"user_id": "u1", "content_id": 1, "event_type": "播放",
                          "dwell_ms": 60000, "flow_state": "flow", "context_stage": "引起好奇"})
    assert r.status_code == 200 and r.json()["ok"]


def test_island_init_and_expand_cap(client):
    r = client.get("/api/v1/islands/u_cap")
    assert r.status_code == 200
    island = r.json()
    assert island["territory"] == 1.0
    assert island["resources"]["好奇種子"] == 3
    assert island["resources"]["觀察之眼"] == 1

    # +2, +2, +1 = 5 單位（每日上限）
    for action, expect in [("complete_quest", 3.0), ("complete_quest", 5.0), ("complete_topic", 6.0)]:
        r = client.post("/api/v1/islands/u_cap/expand", json={"action": action})
        assert r.status_code == 200, r.text
        assert r.json()["island"]["territory"] == expect
    # 再 +0.5 就超過上限 → 400
    r = client.post("/api/v1/islands/u_cap/expand", json={"action": "ask_question"})
    assert r.status_code == 400
    assert "每日上限" in r.json()["detail"]
    # 非法 action → 400
    r = client.post("/api/v1/islands/u_cap/expand", json={"action": "fly"})
    assert r.status_code == 400


def _occupy(client, uid, tag):
    r = client.post(f"/api/v1/islands/{uid}/occupy", json={"tag": tag})
    assert r.status_code == 200


def test_duel_territory_gap_rejected(client):
    _occupy(client, "big", "CONC:蒸發")
    _occupy(client, "small", "CONC:蒸發")
    # big 擴張到 6 單位，small 維持 1 → 差距 83% > 50%
    client.post("/api/v1/islands/big/expand", json={"action": "complete_quest"})
    client.post("/api/v1/islands/big/expand", json={"action": "complete_quest"})
    client.post("/api/v1/islands/big/expand", json={"action": "complete_topic"})
    r = client.post("/api/v1/duels",
                    json={"challenger_id": "big", "opponent_id": "small", "tag": "CONC:蒸發"})
    assert r.status_code == 400
    assert "50%" in r.json()["detail"]


def test_duel_full_flow_and_settlement(client):
    _occupy(client, "duel_a", "CONC:蒸發")
    _occupy(client, "duel_b", "CONC:蒸發")
    r = client.post("/api/v1/duels",
                    json={"challenger_id": "duel_a", "opponent_id": "duel_b", "tag": "CONC:蒸發"})
    assert r.status_code == 200, r.text
    duel = r.json()
    assert len(duel["questions"]) == 5

    # 同一對手每日只能一次
    r2 = client.post("/api/v1/duels",
                     json={"challenger_id": "duel_a", "opponent_id": "duel_b", "tag": "CONC:蒸發"})
    assert r2.status_code == 400

    # 從 DB 讀正確答案：a 全對、b 全錯
    from app import db as app_db

    with app_db.get_conn() as conn:
        answers = [row[0] for row in conn.execute(
            "SELECT answer_index FROM duel_questions WHERE duel_id = ? ORDER BY round",
            (duel["duel_id"],))]
    wrong = [(a + 1) % 4 for a in answers]

    ra = client.post(f"/api/v1/duels/{duel['duel_id']}/answers",
                     json={"user_id": "duel_a", "answers": answers})
    assert ra.status_code == 200
    assert ra.json()["settled"] is False
    assert ra.json()["your_score"] == 5
    assert all("concept_note" in f and f["correct"] for f in ra.json()["feedback"])

    rb = client.post(f"/api/v1/duels/{duel['duel_id']}/answers",
                     json={"user_id": "duel_b", "answers": wrong})
    assert rb.status_code == 200
    done = rb.json()
    assert done["settled"] is True
    assert done["winner_id"] == "duel_a"
    assert done["badges"] == {"duel_a": "對決勝利", "duel_b": "觀念修正"}
    assert done["territory_change"] == {"duel_a": "+1", "duel_b": "-1"}

    ia = client.get("/api/v1/islands/duel_a").json()
    ib = client.get("/api/v1/islands/duel_b").json()
    assert ia["territory"] == 2.0 and ib["territory"] == 1.0  # 失敗者不低於 1
    assert "對決勝利" in ia["badges"] and "觀念修正" in ib["badges"]


def test_radar_formula_and_compare(client):
    _occupy(client, "r_a", "SUBJ:物理")
    for t in ["SUBJ:物理", "SUBJ:化學", "SUBJ:生物", "SUBJ:地球科學"]:
        _occupy(client, "r_b", t)
    pa = client.get("/api/v1/radar/r_a").json()
    pb = client.get("/api/v1/radar/r_b").json()
    assert pa["x"] == 25 and pb["x"] == 100  # 跨學科數 × 25
    assert pa["y"] == 0 and pa["z"] == 0

    r = client.get("/api/v1/radar/compare", params={"me": "r_a", "other": "r_b"})
    assert r.status_code == 200
    data = r.json()
    # distance = sqrt(0.75²)/sqrt(3)*100 = 43.30
    assert abs(data["distance_percent"] - 43.30) < 0.01
    assert data["relation"] == "互補"
    assert "43.3" in data["reason"]


def test_radar_relation_boundaries():
    sys.path.insert(0, BACKEND)
    from app.game import radar_distance, relation_label

    assert relation_label(radar_distance({"x": 0, "y": 0, "z": 0}, {"x": 10, "y": 10, "z": 10})) == "合作夥伴"
    assert relation_label(radar_distance({"x": 0, "y": 0, "z": 0}, {"x": 50, "y": 50, "z": 50})) == "互補"
    assert relation_label(radar_distance({"x": 0, "y": 0, "z": 0}, {"x": 100, "y": 100, "z": 100})) == "探索未知"


def test_rag_with_results(client):
    r = client.get("/api/v1/rag/query", params={"q": "蒸發 浴室"})
    assert r.status_code == 200
    data = r.json()
    assert len(data["chunks"]) > 0
    assert len(data["citations"]) == len(data["chunks"])
    assert all("url" in c for c in data["citations"])


def test_rag_no_result_message(client):
    r = client.get("/api/v1/rag/query", params={"q": "量子糾纏黑洞奇點"})
    assert r.status_code == 200
    data = r.json()
    assert data["chunks"] == []
    assert data["message"] == "目前知識湖沒有足夠內容，要不要換個標籤？"
