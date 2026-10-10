"""遊戲世界：寵物／島嶼／建築／交易市集／探索／每週精選。

論文依據（見 系統設計-遊戲化學習宇宙.md）：
- 寵物強度=學習投入函數（Chen, P-LCS）；虛擬角色動機效果 g=0.48（Schroeder et al., 2025）
- 稟賦效應（Kahneman et al., 1990）；合作+競爭混合最強（Sailer & Homner, 2020）
- 劇情：學生當主動解決者（Rowe et al., 2011）；seductive details 砍（McQuiggan et al., 2008）
- 每週盤點：SRL 三階段（Zimmerman, 2002）；間隔=留存期×10-20%（Cepeda et al., 2008）
"""
from __future__ import annotations

import datetime
import json
import uuid

from app import db
from app import llm as llm_mod

# ---------------- 寵物 ----------------

SPECIES = ("星靈", "潮汐獸", "書頁龍", "苔蘚龜")


def get_pet(user_id: str) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM pets WHERE user_id = ?",
                           (user_id,)).fetchone()
    return dict(row) if row else None


def hatch_pet(user_id: str, name: str = "", species: str = "") -> dict:
    """第一次戰役完成時孵化。"""
    if get_pet(user_id):
        raise ValueError("你已經有一隻寵物了。")
    # 依常探索主題決定種類（簡化：輪替）
    species = species or SPECIES[0]
    if species not in SPECIES:
        species = SPECIES[0]
    name = (name or "").strip()[:12] or f"{species}寶寶"
    pid = "pet_" + uuid.uuid4().hex[:12]
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO pets (id, user_id, name, species) VALUES (?, ?, ?, ?)",
            (pid, user_id, name, species))
        conn.commit()
    return get_pet(user_id)


def pet_gain_exp(user_id: str, exp: int, reason: str = "") -> dict | None:
    """學習行為給寵物經驗。升級門檻：level*100。"""
    pet = get_pet(user_id)
    if not pet:
        return None
    exp = max(0, int(exp))
    new_exp = pet["exp"] + exp
    level = pet["level"]
    while new_exp >= level * 100:
        new_exp -= level * 100
        level += 1
    mood = min(100, pet["mood"] + (5 if exp > 0 else -2))
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE pets SET exp = ?, level = ?, mood = ? WHERE user_id = ?",
            (new_exp, level, mood, user_id))
        conn.commit()
    p = get_pet(user_id)
    p["leveled_up"] = level > pet["level"]
    p["reason"] = reason
    return p


def rename_pet(user_id: str, name: str) -> dict:
    name = (name or "").strip()[:12]
    if not name:
        raise ValueError("請給寵物取個名字。")
    with db.get_conn() as conn:
        conn.execute("UPDATE pets SET name = ? WHERE user_id = ?", (name, user_id))
        conn.commit()
    return get_pet(user_id)


# ---------------- 島嶼與建築 ----------------

BUILDINGS = {
    "圖書館": {"desc": "加速文獻理解：測驗前可多看一次提示", "max": 5},
    "訓練場": {"desc": "提升武器默契成長速度", "max": 5},
    "瞭望塔": {"desc": "探索加成：劇情選項多一條線索", "max": 5},
}
BUILD_COST = 50  # 建築/升級費用（星砂）


def create_island(user_id: str, session_id: str, name: str, topic: str) -> dict:
    name = (name or "").strip()[:20] or f"{(topic or '未知')[:8]}島"
    iid = "isl_" + uuid.uuid4().hex[:12]
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO learn_islands (id, user_id, session_id, name, topic)"
            " VALUES (?, ?, ?, ?, ?)",
            (iid, user_id, session_id, name, topic))
        conn.commit()
        row = conn.execute("SELECT * FROM learn_islands WHERE id = ?",
                           (iid,)).fetchone()
    return dict(row)


def list_islands(user_id: str) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM learn_islands WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            blds = conn.execute(
                "SELECT btype, level FROM buildings WHERE island_id = ?",
                (r["id"],)).fetchall()
            d["buildings"] = [dict(b) for b in blds]
            out.append(d)
    return out


def build(user_id: str, island_id: str, btype: str) -> dict:
    """蓋房／升級。用星砂。"""
    if btype not in BUILDINGS:
        raise ValueError(f"沒有這種建築。可選：{', '.join(BUILDINGS)}")
    with db.get_conn() as conn:
        isl = conn.execute(
            "SELECT id FROM learn_islands WHERE id = ? AND user_id = ?",
            (island_id, user_id)).fetchone()
        if not isl:
            raise KeyError("找不到這座島。")
        row = conn.execute(
            "SELECT level FROM buildings WHERE island_id = ? AND btype = ?",
            (island_id, btype)).fetchone()
        cur = int(row["level"]) if row else 0
        if cur >= BUILDINGS[btype]["max"]:
            raise ValueError("已經升到最高級了。")
        cost = BUILD_COST * (cur + 1)
        # 扣星砂
        from app import economy
        economy.spend(user_id, cost, f"建築：{btype} Lv{cur + 1}")
        if row:
            conn.execute(
                "UPDATE buildings SET level = level + 1 WHERE island_id = ? AND btype = ?",
                (island_id, btype))
        else:
            conn.execute(
                "INSERT INTO buildings (id, island_id, btype) VALUES (?, ?, ?)",
                ("bld_" + uuid.uuid4().hex[:12], island_id, btype))
        conn.commit()
    return {"ok": True, "btype": btype, "level": cur + 1, "cost": cost,
            "desc": BUILDINGS[btype]["desc"]}


# ---------------- 交易市集 ----------------

def list_market(status: str = "open", limit: int = 50) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM market_listings WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            (status, limit)).fetchall()
    return [dict(r) for r in rows]


def publish_listing(seller_id: str, item_type: str, item_id: str,
                    price: int = 0, trade_kind: str = "sell",
                    want_text: str = "") -> dict:
    """上架：武器(skill_badges) 或 島嶼(learn_islands)。"""
    if item_type not in ("badge", "island"):
        raise ValueError("只能交易武器或島嶼。")
    if trade_kind not in ("sell", "barter"):
        raise ValueError("交易方式只能是 sell（星砂）或 barter（以物易物）。")
    table = "skill_badges" if item_type == "badge" else "learn_islands"
    with db.get_conn() as conn:
        own = conn.execute(
            f"SELECT id FROM {table} WHERE id = ? AND user_id = ?",
            (item_id, seller_id)).fetchone()
        if not own:
            raise KeyError("這不是你的物品。")
        dup = conn.execute(
            "SELECT id FROM market_listings WHERE item_type = ? AND item_id = ?"
            " AND status = 'open'", (item_type, item_id)).fetchone()
        if dup:
            raise ValueError("已經上架了。")
        lid = "mkt_" + uuid.uuid4().hex[:12]
        conn.execute(
            "INSERT INTO market_listings (id, seller_id, item_type, item_id, price,"
            " trade_kind, want_text) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (lid, seller_id, item_type, item_id, max(0, int(price)),
             trade_kind, (want_text or "").strip()[:100]))
        conn.commit()
    return {"id": lid, "item_type": item_type, "trade_kind": trade_kind,
            "price": max(0, int(price))}


def buy_listing(buyer_id: str, listing_id: str) -> dict:
    """用星砂購買。武器過戶後默契歸零（需重新學習建立）。"""
    from app import economy
    with db.get_conn() as conn:
        lst = conn.execute(
            "SELECT * FROM market_listings WHERE id = ? AND status = 'open'",
            (listing_id,)).fetchone()
        if not lst:
            raise KeyError("找不到這個上架。")
        lst = dict(lst)
        if lst["seller_id"] == buyer_id:
            raise ValueError("不能買自己的東西。")
        if lst["trade_kind"] != "sell":
            raise ValueError("這是以物易物，只能用換的。")
        # 轉帳
        economy.spend(buyer_id, lst["price"], f"市集購入 {lst['item_type']}")
        economy.earn(lst["seller_id"], lst["price"], f"市集售出 {lst['item_type']}")
        # 過戶
        table = "skill_badges" if lst["item_type"] == "badge" else "learn_islands"
        if lst["item_type"] == "badge":
            conn.execute(
                "UPDATE skill_badges SET user_id = ?, bond = 0 WHERE id = ?",
                (buyer_id, lst["item_id"]))
        else:
            conn.execute(
                "UPDATE learn_islands SET user_id = ? WHERE id = ?",
                (buyer_id, lst["item_id"]))
        conn.execute("UPDATE market_listings SET status = 'sold' WHERE id = ?",
                     (listing_id,))
        conn.commit()
    return {"ok": True, "item_type": lst["item_type"], "price": lst["price"],
            "note": "過戶完成。武器默契已歸零——真正的默契要靠你自己的學習重新建立。"}


def cancel_listing(seller_id: str, listing_id: str) -> dict:
    with db.get_conn() as conn:
        cur = conn.execute(
            "UPDATE market_listings SET status = 'cancelled'"
            " WHERE id = ? AND seller_id = ? AND status = 'open'",
            (listing_id, seller_id))
        conn.commit()
        if cur.rowcount == 0:
            raise KeyError("找不到這個上架，或已經成交/取消。")
    return {"ok": True}


# ---------------- 探索 ----------------

ZONES = {
    "迷霧群島": {"desc": "未標記的海域，傳說有失落的文獻殘頁", "stages": 3},
    "回聲深淵": {"desc": "聲音會被放大的海溝，適合練習論證", "stages": 3},
    "星砂荒漠": {"desc": "資源枯竭的舊戰場，考驗資源分配智慧", "stages": 3},
}

# 規則式劇情（無 LLM 時用；有 LLM 時由 llm 生成）
_STORIES = {
    "迷霧群島": [
        {"title": "漂流瓶",
         "text": "你在岸邊撿到一個漂流瓶，裡面有一張殘缺的地圖，標記著「真理在第三個岔口」。前方有三條小徑，你會？",
         "choices": ["走最寬的那條（多數人走的）", "走最窄的那條（少有人走的）", "先爬上瞭望台觀察地形再決定"],
         "hint": "多數人的選擇不一定是對的——先收集資訊再決定，這是研究者的基本功。"},
        {"title": "殘頁",
         "text": "你在洞穴中找到一頁古文獻，上面寫著一句沒頭沒尾的話：「當所有人都說對的時候，要去找反例。」這讓你想到？",
         "choices": ["這是詭辯，不理它", "試著為這句話找一個支持的例子", "試著為這句話找一個反例"],
         "hint": "證偽比證實更有力量——一個反例就能推翻全稱命題。"},
        {"title": "歸途",
         "text": "霧散了，你帶著殘頁回到船上。船長問你這趟學到了什麼，你會怎麼用一句話總結？",
         "choices": ["我找到了寶藏", "我學會了先觀察再行動，並用反例檢驗說法", "沒什麼收穫"],
         "hint": "能用一句話講清楚，才是真的學到了（費曼精神）。"},
    ],
    "回聲深淵": [
        {"title": "深淵回音",
         "text": "你對著深淵喊出一個你堅信的觀點，回音傳回來時變了調——像是有人在質疑你。你第一反應是？",
         "choices": ["更大聲地重複一遍", "仔細聽回音到底在質疑什麼", "換個觀點再喊一次"],
         "hint": "被質疑時先聽懂對方的點，而不是放大自己的音量。"},
        {"title": "雙重回音",
         "text": "深淵中浮現兩個聲音：一個支持你，一個反對你，用的都是同一組事實。你意識到？",
         "choices": ["事實是中立的，詮釋可以不同", "其中一個一定在說謊", "事實不重要，立場才重要"],
         "hint": "同樣的事實可以支撐不同的結論——關鍵在推理鏈，不在事實本身。"},
        {"title": "靜默",
         "text": "深淵突然安靜了。在寂靜中，你聽到自己內心的聲音：這趟探索，你最大的收穫是知識，還是認識了自己的思考習慣？",
         "choices": ["知識", "認識自己的思考習慣", "兩者都有"],
         "hint": "後設認知——知道自己怎麼想的，比知道什麼更重要。"},
    ],
    "星砂荒漠": [
        {"title": "枯井",
         "text": "荒漠中央有一口枯井，三個部落都宣稱擁有它。水（知識）該怎麼分？",
         "choices": ["誰先到誰得", "按人頭平均分配", "按需求和貢獻協商分配"],
         "hint": "分配正義沒有標準答案，但「說出理由」比「選出答案」重要。"},
        {"title": "商隊",
         "text": "一支商隊願意用糧食換你的星砂，但開價很高。你會？",
         "choices": ["接受，生存優先", "拒絕，自己想辦法", "討價還價，提出以物易物"],
         "hint": "交易不只是價格，更是資訊戰——先搞清楚對方的底線。"},
        {"title": "綠洲",
         "text": "你找到了綠洲。回望荒漠，你明白：資源枯竭的真正原因不是資源少，而是？",
         "choices": ["運氣不好", "分配機制和短視", "人口太多"],
         "hint": "把現象歸因到機制，而不是運氣或單一原因——這是系統思考的起點。"},
    ],
}


def start_exploration(user_id: str, zone: str) -> dict:
    if zone not in ZONES:
        raise ValueError(f"沒有這個區域。可選：{', '.join(ZONES)}")
    with db.get_conn() as conn:
        ongoing = conn.execute(
            "SELECT id FROM explorations WHERE user_id = ? AND zone = ? AND status = 'ongoing'",
            (user_id, zone)).fetchone()
        if ongoing:
            raise ValueError("這個區域的探索還沒結束，先繼續吧。")
        eid = "exp_" + uuid.uuid4().hex[:12]
        conn.execute(
            "INSERT INTO explorations (id, user_id, zone) VALUES (?, ?, ?)",
            (eid, user_id, zone))
        conn.commit()
    return get_exploration(eid, user_id)


def get_exploration(eid: str, user_id: str) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM explorations WHERE id = ? AND user_id = ?",
            (eid, user_id)).fetchone()
    if not row:
        raise KeyError("找不到這次探索。")
    d = dict(row)
    d["story_state"] = db.jloads(d["story_state"], {})
    d["zone_info"] = ZONES.get(d["zone"], {})
    if d["status"] == "ongoing":
        stories = _STORIES.get(d["zone"], [])
        d["current"] = stories[d["stage"]] if d["stage"] < len(stories) else None
        d["total_stages"] = len(stories)
    return d


def explore_choice(eid: str, user_id: str, choice_index: int) -> dict:
    """推進劇情。選項無對錯，但選擇會記錄進人格側寫。"""
    exp = get_exploration(eid, user_id)
    if exp["status"] != "ongoing":
        raise ValueError("這次探索已經結束了。")
    stories = _STORIES.get(exp["zone"], [])
    stage = exp["stage"]
    if stage >= len(stories):
        raise ValueError("劇情已經走完。")
    story = stories[stage]
    choices = story["choices"]
    if not (0 <= choice_index < len(choices)):
        raise ValueError("選項不存在。")
    state = exp["story_state"]
    trail = state.get("trail", [])
    trail.append({"stage": stage, "title": story["title"],
                  "choice": choices[choice_index]})
    state["trail"] = trail
    new_stage = stage + 1
    done = new_stage >= len(stories)
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE explorations SET stage = ?, story_state = ?, status = ? WHERE id = ?",
            (new_stage, json.dumps(state, ensure_ascii=False),
             "done" if done else "ongoing", eid))
        conn.commit()
    reward = {}
    if done:
        # 完成獎勵：星砂＋寵物經驗
        from app import economy
        economy.earn(user_id, 30, f"探索完成：{exp['zone']}")
        pet = pet_gain_exp(user_id, 40, f"探索{exp['zone']}")
        reward = {"starsand": 30, "pet": bool(pet)}
    nxt = stories[new_stage] if not done else None
    return {"ok": True, "done": done, "hint": story["hint"],
            "choice": choices[choice_index],
            "next": nxt, "reward": reward, "trail": trail}


def list_explorations(user_id: str) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id, zone, stage, status, created_at FROM explorations"
            " WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
            (user_id,)).fetchall()
    return [dict(r) for r in rows]


# ---------------- 每週精選與盤點 ----------------

def _week_str(dt: datetime.date | None = None) -> str:
    dt = dt or datetime.date.today()
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


def _rate_content(title: str, summary: str) -> dict:
    """內容評分（規則式）：深度／趣味度 1-5 星。不幫使用者選擇，只呈現分析。"""
    text = (title or "") + (summary or "")
    depth_kw = ("理論", "機制", "研究", "分析", "歷史", "論文", "原理", "制度")
    fun_kw = ("故事", "有趣", "揭秘", "實測", "挑戰", "遊戲", "漫畫", "影片")
    depth = 2 + sum(1 for k in depth_kw if k in text)
    fun = 2 + sum(1 for k in text and fun_kw if k in text)
    return {"depth": min(5, depth), "fun": min(5, fun)}


def generate_weekly(user_id: str, week: str = "") -> dict:
    """產生本週精選＋盤點。冪等：同週重複呼叫回傳同一份。"""
    week = week or _week_str()
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM weekly_digests WHERE user_id = ? AND week = ?",
            (user_id, week)).fetchone()
        if row:
            d = dict(row)
            d["items"] = db.jloads(d["items"], [])
            d["review"] = db.jloads(d["review"], {})
            return d
    # 興趣畫像：從 topic_mastery 取前 3 主題
    with db.get_conn() as conn:
        topics = conn.execute(
            "SELECT topic FROM topic_mastery WHERE user_id = ?"
            " ORDER BY sessions_count DESC LIMIT 3", (user_id,)).fetchall()
        topics = [t["topic"] for t in topics]
        contents = conn.execute(
            "SELECT id, title, summary, url FROM content_items ORDER BY id DESC LIMIT 30"
        ).fetchall()
    # 簡易策展：標題含主題關鍵字的優先，否則取最新
    picked = []
    for c in contents:
        score = sum(2 for t in topics if t and t[:4] in (c["title"] or ""))
        picked.append((score, dict(c)))
    picked.sort(key=lambda x: -x[0])
    items = []
    for score, c in picked[:6]:
        r = _rate_content(c["title"], c["summary"])
        ctype = "文章"
        if c.get("url", "").find("youtube") >= 0 or "影片" in (c["title"] or ""):
            ctype = "影音"
        items.append({"content_id": c["id"], "title": c["title"],
                      "summary": (c["summary"] or "")[:120], "url": c.get("url", ""),
                      "ctype": ctype, "depth": r["depth"], "fun": r["fun"],
                      "why": f"與你的主題「{(topics[0] if topics else '探索')[:8]}」相關"
                             if score > 0 else "本週新內容"})
    review = _build_review(user_id, week)
    attr = 3 + review.get("battles", 0)  # 基礎3點＋每場戰役1點
    wid = "wk_" + uuid.uuid4().hex[:12]
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO weekly_digests (id, user_id, week, items, review, attr_points)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (wid, user_id, week, json.dumps(items, ensure_ascii=False),
             json.dumps(review, ensure_ascii=False), attr))
        # 發放屬性點
        cur = conn.execute("SELECT points FROM attr_points WHERE user_id = ?",
                           (user_id,)).fetchone()
        if cur:
            conn.execute("UPDATE attr_points SET points = points + ? WHERE user_id = ?",
                         (attr, user_id))
        else:
            conn.execute("INSERT INTO attr_points (user_id, points) VALUES (?, ?)",
                         (user_id, attr))
        conn.commit()
    return {"id": wid, "user_id": user_id, "week": week, "items": items,
            "review": review, "attr_points": attr}


def _build_review(user_id: str, week: str) -> dict:
    """SRL 三階段盤點：反思→監控→預想。"""
    y, w = week.split("-W")
    # 本週的戰役
    with db.get_conn() as conn:
        sessions = conn.execute(
            "SELECT id, question, topic, depth_level, status FROM learn_sessions"
            " WHERE user_id = ? AND status = 'done'", (user_id,)).fetchall()
        mastery = conn.execute(
            "SELECT topic, mastery, sessions_count FROM topic_mastery WHERE user_id = ?",
            (user_id,)).fetchall()
        badges = conn.execute(
            "SELECT COUNT(*) AS c FROM skill_badges WHERE user_id = ?", (user_id,)).fetchone()
    # 自評 vs 系統估計的校準提示（Zimmerman et al., 2011）
    topics = [{"topic": m["topic"], "mastery": round(m["mastery"], 2),
               "sessions": m["sessions_count"]} for m in mastery]
    return {
        "battles": len(sessions),
        "badges": badges["c"] if badges else 0,
        "topics": topics,
        "reflect_prompt": "先自己說說：這週你學到的最重要的一個概念是什麼？（說出來再對照下面）",
        "calibration_prompt": "為每個主題打個分（0-100），再對照系統的掌握度估計——差距越大的地方，越值得下週深入。",
        "plan_prompt": "下週想探索哪個主題？把屬性點分配到對應的武器上吧。",
    }


def get_weekly(user_id: str, week: str = "") -> dict | None:
    week = week or _week_str()
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM weekly_digests WHERE user_id = ? AND week = ?",
            (user_id, week)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["items"] = db.jloads(d["items"], [])
    d["review"] = db.jloads(d["review"], {})
    return d


def get_attr_points(user_id: str) -> int:
    with db.get_conn() as conn:
        row = conn.execute("SELECT points FROM attr_points WHERE user_id = ?",
                           (user_id,)).fetchone()
    return int(row["points"]) if row else 0


def spend_attr_points(user_id: str, badge_id: str, points: int,
                      route: str = "attack") -> dict:
    """屬性點加乘武器：攻擊／防禦／默契三路線（真實分化，非純膨脹）。"""
    if route not in ("attack", "defense", "bond"):
        raise ValueError("路線只能是 attack / defense / bond。")
    points = int(points)
    if points < 1:
        raise ValueError("至少投入 1 點。")
    with db.get_conn() as conn:
        cur = conn.execute("SELECT points FROM attr_points WHERE user_id = ?",
                           (user_id,)).fetchone()
        have = int(cur["points"]) if cur else 0
        if have < points:
            raise ValueError(f"屬性點不足（擁有 {have}）。")
        badge = conn.execute(
            "SELECT * FROM skill_badges WHERE id = ? AND user_id = ?",
            (badge_id, user_id)).fetchone()
        if not badge:
            raise KeyError("找不到這把武器。")
        conn.execute("UPDATE attr_points SET points = points - ? WHERE user_id = ?",
                     (points, user_id))
        if route == "attack":
            conn.execute("UPDATE skill_badges SET attack = attack + ? WHERE id = ?",
                         (points * 3, badge_id))
        elif route == "defense":
            conn.execute("UPDATE skill_badges SET defense = defense + ? WHERE id = ?",
                         (points * 3, badge_id))
        else:
            conn.execute("UPDATE skill_badges SET bond = MIN(1.0, bond + ?) WHERE id = ?",
                         (points * 0.1, badge_id))
        conn.commit()
        nb = conn.execute("SELECT attack, defense, bond FROM skill_badges WHERE id = ?",
                          (badge_id,)).fetchone()
    return {"ok": True, "route": route, "points_left": have - points,
            "attack": nb["attack"], "defense": nb["defense"],
            "bond": round(nb["bond"], 2)}
