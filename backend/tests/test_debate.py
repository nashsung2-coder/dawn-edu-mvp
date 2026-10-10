"""費曼辯論 API＋武器分類測試（v2：動態 1-3 輪、懷疑度、防刷分、分類標籤）。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

os.environ["DAWN_DB"] = "/tmp/test_debate.db"
if os.path.exists("/tmp/test_debate.db"):
    os.remove("/tmp/test_debate.db")

from app import db  # noqa: E402
from app.learn import classify_badge  # noqa: E402
from app.main import app  # noqa: E402

db.init_db()
client = TestClient(app)


def _reg(name):
    r = client.post("/api/v1/auth/register",
                    json={"name": name, "password": "pw1234"})
    assert r.status_code == 201, r.text
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _ready_session(h, question="為何天空是藍色的？"):
    """開場＋測驗＋作答，走完到可辯論狀態。"""
    r = client.post("/api/v1/learn/sessions", headers=h,
                    json={"question": question, "grade_band": "高中"})
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    client.post(f"/api/v1/learn/sessions/{sid}/quiz", headers=h)
    client.post(f"/api/v1/learn/sessions/{sid}/quiz/answers", headers=h,
                json={"answers": [0, 0, 0]})
    return sid


def _quick_finish(h, question="為何天空是藍色的？"):
    """快速走完一場戰役（不辯論），回傳 finish 結果。"""
    sid = _ready_session(h, question)
    f = client.post(f"/api/v1/learn/sessions/{sid}/finish", headers=h, json={})
    assert f.status_code == 200, f.text
    return f.json()


GOOD_EXPLAIN = ("因為陽光中的藍光波長較短，容易被大氣分子散射，"
                "所以我們看到的天空是藍色的，這就是瑞利散射。")
GOOD_REBUTTAL = ("因為反例確實可能存在，所以我的解釋還站得住，原因在於"
                 "大氣散射是穩定的物理機制，例如火星的天空是紅色的，"
                 "這反而證明了機制解釋的普適性。")
FINAL_LINE = "一句話總結：天空的藍色來自瑞利散射，理解機制就能預測其他星球的天空顏色。"


def test_debate_full_flow():
    h = _h(_reg("辯論者"))
    sid = _ready_session(h)
    # R1 開戰
    r = client.post(f"/api/v1/learn/sessions/{sid}/debate/start", headers=h,
                    json={"explanation": GOOD_EXPLAIN})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["round"] == 1
    assert d["challenge"]
    sus = d["suspicion"]
    assert set(("clarity", "examples", "logic", "avg", "state")) <= set(sus)
    assert sus["state"] in ("破綻百出", "逐漸穩固", "完美防禦")
    assert sus["note"] == "即時估計，非考試分數"
    assert d["can_continue"] is True
    # R1 回應：正面堵住漏洞 → 可選 R3
    r2 = client.post(f"/api/v1/learn/sessions/{sid}/debate/respond", headers=h,
                     json={"text": GOOD_REBUTTAL})
    assert r2.status_code == 200, r2.text
    d2 = r2.json()
    assert d2["verdict"] == "blocked", d2
    assert d2["next_round"] == 3 and d2["optional"] is True
    # R3 最終陳述 → 終局授勳
    r3 = client.post(f"/api/v1/learn/sessions/{sid}/debate/respond", headers=h,
                     json={"text": FINAL_LINE})
    assert r3.status_code == 200, r3.text
    d3 = r3.json()
    assert d3["verdict_text"] in ("說服成功", "部分說服", "再練練"), d3
    badge = d3["finish"]["badge"]
    assert badge["archetype"] in ("攻擊型", "防禦型", "輔助型", "經濟型")
    assert isinstance(badge["tags"], list)
    assert d3["finish"]["pet"] is not None  # 寵物孵化／成長
    # 會話已結束
    s = client.get(f"/api/v1/learn/sessions/{sid}", headers=h).json()
    assert s["status"] == "done"
    # 武器庫有分類欄位
    badges = client.get("/api/v1/learn/badges", headers=h).json()["badges"]
    assert badges[0]["archetype"] == badge["archetype"]
    assert isinstance(badges[0]["tags"], list)


def test_debate_anticheat():
    h = _h(_reg("作弊者"))
    # 還沒測驗就開戰 → 400
    r = client.post("/api/v1/learn/sessions", headers=h,
                    json={"question": "為何月亮有陰晴圓缺？", "grade_band": "高中"})
    sid0 = r.json()["id"]
    bad = client.post(f"/api/v1/learn/sessions/{sid0}/debate/start", headers=h,
                      json={"explanation": GOOD_EXPLAIN})
    assert bad.status_code == 400
    # 太短 → 400
    sid = _ready_session(h, "為什麼遠古時期嬰兒啼哭不會引發野獸？")
    short = client.post(f"/api/v1/learn/sessions/{sid}/debate/start", headers=h,
                        json={"explanation": "太短了啦"})
    assert short.status_code == 400
    assert "多講一點" in short.json()["detail"]
    # 複製貼上題目 → 嘲諷，不計分
    q = "為什麼遠古時期嬰兒啼哭不會引發野獸？"
    sid2 = _ready_session(h, q)
    cp = client.post(f"/api/v1/learn/sessions/{sid2}/debate/start", headers=h,
                     json={"explanation": q})
    assert cp.status_code == 200, cp.text
    assert cp.json()["scored"] is False
    assert cp.json()["round"] == 0
    assert "這不是你自己理解的話吧" in cp.json()["taunt"]
    # 被嘲諷後仍可正常開戰（未寫入 debate_round）
    ok = client.post(f"/api/v1/learn/sessions/{sid2}/debate/start", headers=h,
                     json={"explanation": GOOD_EXPLAIN})
    assert ok.status_code == 200, ok.text
    assert ok.json()["round"] == 1


def test_debate_concede():
    h = _h(_reg("暫停者"))
    sid = _ready_session(h)
    client.post(f"/api/v1/learn/sessions/{sid}/debate/start", headers=h,
                json={"explanation": GOOD_EXPLAIN})
    c = client.post(f"/api/v1/learn/sessions/{sid}/debate/concede", headers=h)
    assert c.status_code == 200, c.text
    d = c.json()
    assert d["participation"] is True
    assert d["completed_rounds"] == 1
    assert d["award_starsand"] == 10
    assert d["reward_capped"] is False
    assert d["finish"]["badge"]["id"]
    # 沒開戰就暫停 → 400
    sid2 = _ready_session(h)
    c2 = client.post(f"/api/v1/learn/sessions/{sid2}/debate/concede", headers=h)
    assert c2.status_code == 400


def test_debate_reward_cap():
    """同一 topic 當日完成 2 次後，辯論參與獎封頂（只給回饋不給分）。"""
    h = _h(_reg("封頂者"))
    q = "為什麼海洋是藍色的？"
    _quick_finish(h, q)
    _quick_finish(h, q)
    sid = _ready_session(h, q)
    client.post(f"/api/v1/learn/sessions/{sid}/debate/start", headers=h,
                json={"explanation": GOOD_EXPLAIN})
    c = client.post(f"/api/v1/learn/sessions/{sid}/debate/concede", headers=h)
    assert c.status_code == 200, c.text
    d = c.json()
    assert d["reward_capped"] is True
    assert d["award_starsand"] == 0
    assert d["finish"]["badge"]["id"]  # 授勳照常


def test_classify_badge():
    assert classify_badge(50, 10, 0.2, "普通") == ("攻擊型", ["吸血"])
    assert classify_badge(10, 45, 0.2, "普通") == ("防禦型", ["自動觸發"])
    assert classify_badge(20, 20, 0.9, "普通") == ("輔助型", ["續航"])  # 普通稀有度不到經濟型
    assert classify_badge(20, 10, 0.75, "稀有")[0] == "經濟型"  # 高bond＋稀有以上→經濟型
    assert classify_badge(35, 10, 0.3, "普通")[0] == "攻擊型"  # 普通稀有度按最高維
    arch, tags = classify_badge(25, 25, 0.5, "史詩")
    assert arch == "輔助型" and tags == ["連擊"]


def test_market_category_filter():
    hs = _h(_reg("分類賣家"))
    fin = _quick_finish(hs)
    badge = fin["badge"]
    arch = badge["archetype"]
    assert arch in ("攻擊型", "防禦型", "輔助型", "經濟型")
    pub = client.post("/api/v1/world/market", headers=hs,
                      json={"item_type": "badge", "item_id": badge["id"],
                            "price": 50, "trade_kind": "sell"})
    assert pub.status_code == 201, pub.text
    assert pub.json()["archetype"] == arch  # 上架快照分類
    assert isinstance(pub.json()["tags"], list)
    mk = client.get(f"/api/v1/world/market?category={arch}").json()["listings"]
    assert any(x["id"] == pub.json()["id"] for x in mk)
    others = [a for a in ("攻擊型", "防禦型", "輔助型", "經濟型") if a != arch]
    mk2 = client.get(f"/api/v1/world/market?category={others[0]}").json()["listings"]
    assert all(x["id"] != pub.json()["id"] for x in mk2)
    mk_all = client.get("/api/v1/world/market").json()["listings"]
    assert any(x["id"] == pub.json()["id"] for x in mk_all)
    # 清理：下架，避免污染其他測試檔案的全域市集斷言
    # （pytest 先 import 全部模組，DAWN_DB 以最後 import 者為準，
    #  get_conn 每次重讀 env，全檔案共用同一 DB）
    dc = client.delete(f"/api/v1/world/market/{pub.json()['id']}", headers=hs)
    assert dc.status_code == 200


def test_econ_weekly_bonus():
    """持有經濟型武器 → 每週精選多 1 屬性點。"""
    h = _h(_reg("經濟人"))
    fin = _quick_finish(h)
    bid = fin["badge"]["id"]
    # 目前鍛造公式 attack 下限約 32，經濟型（attack<30）暫時靠回填／調整達成；
    # 此處直接標記以驗證 generate_weekly 的加成接線。
    with db.get_conn() as conn:
        conn.execute("UPDATE skill_badges SET archetype = '經濟型' WHERE id = ?",
                     (bid,))
        conn.commit()
    w = client.post("/api/v1/world/weekly?week=2099-W99", headers=h)
    assert w.status_code == 200, w.text
    # 基礎 3 ＋ 1 場戰役 ＋ 經濟型 1 = 5
    assert w.json()["attr_points"] == 5, w.json()


def test_debate_appeal():
    """申訴：重判一次；第二次申訴被拒。"""
    h = _h(_reg("申訴人"))
    sid = _ready_session(h)
    r = client.post(f"/api/v1/learn/sessions/{sid}/debate/start", headers=h,
                    json={"explanation": GOOD_EXPLAIN})
    assert r.status_code == 200, r.text
    if r.json().get("perfect"):
        return  # 完美通關直接結束，無輪可申訴
    r2 = client.post(f"/api/v1/learn/sessions/{sid}/debate/respond", headers=h,
                     json={"text": GOOD_REBUTTAL})
    assert r2.status_code == 200, r2.text
    a = client.post(f"/api/v1/learn/sessions/{sid}/debate/appeal", headers=h)
    assert a.status_code == 200, a.text
    assert a.json()["appealed"] is True
    assert "verdict" in a.json()
    a2 = client.post(f"/api/v1/learn/sessions/{sid}/debate/appeal", headers=h)
    assert a2.status_code == 400  # 每輪限申訴一次
    # 申訴不應結束戰役（除非完美通關）
    if not a.json().get("finish"):
        c = client.post(f"/api/v1/learn/sessions/{sid}/debate/concede", headers=h)
        assert c.status_code == 200


def test_debate_start_logs_explanation():
    """debate/start 補寫 explanation 事件 → finish 的 build_score 不掉回預設。"""
    h = _h(_reg("解釋紀錄人"))
    sid = _ready_session(h)
    r = client.post(f"/api/v1/learn/sessions/{sid}/debate/start", headers=h,
                    json={"explanation": GOOD_EXPLAIN})
    assert r.status_code == 200, r.text
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM learn_events WHERE session_id = ? AND kind = 'explanation'"
            " ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
    assert row is not None, "debate/start 應補寫 explanation 事件"
    import json
    assert "build_score" in json.loads(row["payload"])


def test_market_snapshot_stats():
    """上架快照武器數值（對比浮窗用）。"""
    h = _h(_reg("快照賣家"))
    fin = _quick_finish(h)
    badge = fin["badge"]
    pub = client.post("/api/v1/world/market", headers=h,
                      json={"item_type": "badge", "item_id": badge["id"],
                            "price": 30, "trade_kind": "sell"})
    assert pub.status_code == 201, pub.text
    pj = pub.json()
    assert pj["snap_attack"] == badge["attack"]
    assert pj["snap_defense"] == badge["defense"]
    mk = client.get("/api/v1/world/market").json()["listings"]
    mine = next(x for x in mk if x["id"] == pj["id"])
    assert mine["snap_attack"] == badge["attack"]
    dc = client.delete(f"/api/v1/world/market/{pj['id']}", headers=h)
    assert dc.status_code == 200
