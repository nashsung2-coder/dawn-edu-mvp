"""遊戲化層：島嶼領土、三維雷達、知識對決。"""
from __future__ import annotations

import random
from datetime import date

from app import db
from app.search import resolve_tag

# §10.4 六種資源
RESOURCE_NAMES = {
    "curiosity_seed": "好奇種子",
    "observing_eye": "觀察之眼",
    "variable_gear": "變因齒輪",
    "flow_spring": "心流之泉",
    "connection_web": "連結之網",
    "shadow_key": "陰影之鑰",
}

DEFAULT_RESOURCES = {"curiosity_seed": 3, "observing_eye": 1}

# §10.2 擴張行為 → 領土增量（單位）
EXPAND_ACTIONS = {
    "complete_topic": 1.0,   # 完成一個科學探索主題
    "fix_myth": 1.0,         # 修正一個迷思
    "ask_question": 0.5,      # 提出一個新問題
    "complete_quest": 2.0,    # 完成一個任務市集委託
    "co_study": 1.5,         # 與夥伴完成共修任務
}
DAILY_EXPAND_CAP = 5.0  # §10.2 每日擴張上限

# 每次擴張附贈的資源（鼓勵回饋）：行為 → [(資源鍵, 數量), ...]
ACTION_RESOURCE_REWARD = {
    "complete_topic": (("curiosity_seed", 1),),
    "fix_myth": (("observing_eye", 1),),
    "ask_question": (("curiosity_seed", 1),),
    "complete_quest": (("variable_gear", 1), ("flow_spring", 1)),
    "co_study": (("connection_web", 1),),
}


def _today() -> str:
    return date.today().isoformat()


def ensure_user(conn, user_id: str) -> None:
    row = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        conn.execute(
            "INSERT INTO users (id, name) VALUES (?, ?)", (user_id, f"拓荒者·{user_id}")
        )


def _used_today(conn, user_id: str) -> float:
    row = conn.execute(
        "SELECT COALESCE(SUM(delta), 0) AS s FROM territory_logs WHERE user_id = ? AND log_date = ?",
        (user_id, _today()),
    ).fetchone()
    return float(row["s"] or 0)


def get_island(user_id: str) -> dict:
    """§10.1 初始島嶼：不存在則建立（領土 1 單位、好奇種子×3、觀察之眼×1）。"""
    with db.get_conn() as conn:
        ensure_user(conn, user_id)
        row = conn.execute("SELECT * FROM islands WHERE user_id = ?", (user_id,)).fetchone()
        if not row:
            conn.execute(
                """INSERT INTO islands (user_id, name, territory, occupied_tags, resources, badges)
                   VALUES (?, '初生之島', 1.0, '[]', ?, '[]')""",
                (user_id, __import__("json").dumps(DEFAULT_RESOURCES, ensure_ascii=False)),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM islands WHERE user_id = ?", (user_id,)).fetchone()
        d = _island_dict(row)
        d["used_today"] = _used_today(conn, user_id)
        d["daily_cap"] = DAILY_EXPAND_CAP
        return d


def _island_dict(row) -> dict:
    import json

    resources = json.loads(row["resources"] or "{}")
    occupied = json.loads(row["occupied_tags"] or "[]")
    badges = json.loads(row["badges"] or "[]")
    return {
        "user_id": row["user_id"],
        "name": row["name"],
        "territory": row["territory"],
        "occupied_tags": occupied,
        "resources": {RESOURCE_NAMES.get(k, k): v for k, v in resources.items()},
        "resources_raw": resources,
        "badges": badges,
    }


def occupy_tag(user_id: str, tag_label: str) -> None:
    """佔領標籤（非零和：多人可佔同一標籤）。"""
    with db.get_conn() as conn:
        ensure_user(conn, user_id)
        row = conn.execute(
            "SELECT occupied_tags FROM islands WHERE user_id = ?", (user_id,)
        ).fetchone()
        import json

        occupied = json.loads(row["occupied_tags"]) if row else []
        if tag_label not in occupied:
            occupied.append(tag_label)
        if row:
            conn.execute(
                f"UPDATE islands SET occupied_tags = ?, updated_at = {db.now_expr()} WHERE user_id = ?",
                (json.dumps(occupied, ensure_ascii=False), user_id),
            )
        else:
            conn.execute(
                """INSERT INTO islands (user_id, occupied_tags, resources)
                   VALUES (?, ?, ?)""",
                (user_id, json.dumps(occupied, ensure_ascii=False),
                 json.dumps(DEFAULT_RESOURCES, ensure_ascii=False)),
            )
        conn.commit()


def expand_island(user_id: str, action: str) -> dict:
    if action not in EXPAND_ACTIONS:
        return {
            "ok": False,
            "reason": f"未知的擴張行為「{action}」，可用：{', '.join(EXPAND_ACTIONS)}。",
        }
    delta = EXPAND_ACTIONS[action]
    with db.get_conn() as conn:
        ensure_user(conn, user_id)
        island = conn.execute("SELECT * FROM islands WHERE user_id = ?", (user_id,)).fetchone()
        if not island:
            conn.commit()
        # 今日已擴張
        used = conn.execute(
            "SELECT COALESCE(SUM(delta), 0) AS s FROM territory_logs WHERE user_id = ? AND log_date = ?",
            (user_id, _today()),
        ).fetchone()["s"]
        if used + delta > DAILY_EXPAND_CAP + 1e-9:
            return {
                "ok": False,
                "reason": (
                    f"今日擴張額度已用 {used}／{DAILY_EXPAND_CAP} 單位，"
                    f"本次「{action}」需要 {delta} 單位，已達每日上限。慢荒宇宙鼓勵穩定學習，明天再來開疆拓土吧！"
                ),
                "used_today": used,
                "daily_cap": DAILY_EXPAND_CAP,
            }
        import json

        resources = json.loads(island["resources"]) if island else dict(DEFAULT_RESOURCES)
        rewards = ACTION_RESOURCE_REWARD[action]
        for rkey, rval in rewards:
            resources[rkey] = resources.get(rkey, 0) + rval
        new_territory = round((island["territory"] if island else 1.0) + delta, 2)
        if island:
            conn.execute(
                f"""UPDATE islands SET territory = ?, resources = ?, updated_at = {db.now_expr()}
                   WHERE user_id = ?""",
                (new_territory, json.dumps(resources, ensure_ascii=False), user_id),
            )
        else:
            conn.execute(
                "INSERT INTO islands (user_id, territory, resources) VALUES (?, ?, ?)",
                (user_id, new_territory, json.dumps(resources, ensure_ascii=False)),
            )
        conn.execute(
            """INSERT INTO territory_logs (user_id, action, delta, territory_after, log_date)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, action, delta, new_territory, _today()),
        )
        conn.commit()
    reward_text = "、".join(f"{RESOURCE_NAMES[k]} ×{v}" for k, v in rewards)
    return {
        "ok": True,
        "action": action,
        "delta": delta,
        "used_today": round(used + delta, 2),
        "daily_cap": DAILY_EXPAND_CAP,
        "reward": reward_text,
        "island": get_island(user_id),
        "reason": f"開疆拓土成功！領土 +{delta} 單位，獲得{reward_text}。",
    }


# ---------------- 三維雷達 ----------------
def radar_position(user_id: str) -> dict:
    """X 跨學科數、Y 高難度完成數、Z 共修數，皆換算為 0–100。
    公式：
      X = min(100, 去重後的 SUBJ 標籤數 × 25)
      Y = min(100, 完成過 DIFF:L3/L4 內容的學習事件數 × 10)
      Z = min(100, 共修相關事件數（expand co_study＋learning_events 共修） × 20)
    """
    with db.get_conn() as conn:
        ensure_user(conn, user_id)
        row = conn.execute(
            "SELECT occupied_tags FROM islands WHERE user_id = ?", (user_id,)
        ).fetchone()
        import json

        occupied = json.loads(row["occupied_tags"]) if row else []
        subjects = {t.split(":", 1)[1] for t in occupied if t.startswith("SUBJ:")}
        x = min(100, len(subjects) * 25)

        high_diff_contents = {
            r["content_id"]
            for r in conn.execute(
                """SELECT ct.content_id FROM content_tags ct
                   JOIN tags t ON t.id = ct.tag_id
                   WHERE t.dimension_code = 'DIFF' AND t.name IN ('L3 進階', 'L4 挑戰')"""
            ).fetchall()
        }
        y_count = 0
        if high_diff_contents:
            placeholders = ",".join("?" * len(high_diff_contents))
            y_count = conn.execute(
                f"""SELECT COUNT(DISTINCT content_id) AS n FROM learning_events
                    WHERE user_id = ? AND content_id IN ({placeholders})""",
                (user_id, *high_diff_contents),
            ).fetchone()["n"]
        y = min(100, y_count * 10)

        z_co_study = conn.execute(
            "SELECT COUNT(*) AS n FROM territory_logs WHERE user_id = ? AND action = 'co_study'",
            (user_id,),
        ).fetchone()["n"]
        z_events = conn.execute(
            "SELECT COUNT(*) AS n FROM learning_events WHERE user_id = ? AND event_type = 'co_study'",
            (user_id,),
        ).fetchone()["n"]
        z = min(100, (z_co_study + z_events) * 20)

        return {
            "user_id": user_id,
            "x": x, "y": y, "z": z,
            "formula": {
                "x": "min(100, 跨學科標籤數 × 25) —— 知識廣度",
                "y": "min(100, 完成的高難度(L3/L4)內容數 × 10) —— 認知深度",
                "z": "min(100, 共修次數 × 20) —— 社會連結",
            },
            "detail": {
                "subjects": sorted(subjects),
                "high_diff_completed": y_count,
                "co_study_count": z_co_study + z_events,
            },
        }


def radar_distance(p1: dict, p2: dict) -> float:
    """§11.3：distance = √((ΔX)²+(ΔY)²+(ΔZ)²) / √3 × 100%，Δ 為 0–1 歸一差。"""
    import math

    dx = abs(p1["x"] - p2["x"]) / 100
    dy = abs(p1["y"] - p2["y"]) / 100
    dz = abs(p1["z"] - p2["z"]) / 100
    return round(math.sqrt(dx * dx + dy * dy + dz * dz) / math.sqrt(3) * 100, 2)


def relation_label(distance: float) -> str:
    if distance < 20:
        return "合作夥伴"
    if distance <= 60:
        return "互補"
    return "探索未知"


def compare_radar(me: str, other: str) -> dict:
    p1, p2 = radar_position(me), radar_position(other)
    d = radar_distance(p1, p2)
    label = relation_label(d)
    explain = {
        "合作夥伴": "你們的知識領域高度重疊，適合結伴共修、互相切磋。",
        "互補": "你們部分重疊、部分互補，適合跨域交流、交換視角。",
        "探索未知": "你們的知識領域差異很大，正是拓展視野的好機會。",
    }[label]
    return {
        "me": {"user_id": me, "x": p1["x"], "y": p1["y"], "z": p1["z"]},
        "other": {"user_id": other, "x": p2["x"], "y": p2["y"], "z": p2["z"]},
        "distance_percent": d,
        "relation": label,
        "reason": f"雷達距離 {d}%（<20% 合作夥伴／20–60% 互補／>60% 探索未知）：{explain}",
    }


# ---------------- 知識對決 ----------------
def _duel_tag_contents(conn, tag_id: int, limit: int = 5) -> list[dict]:
    rows = conn.execute(
        """SELECT ci.* FROM content_items ci
           JOIN content_tags ct ON ct.content_id = ci.id
           WHERE ct.tag_id = ? ORDER BY ci.id LIMIT ?""",
        (tag_id, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def _distractors(conn, dim: str, exclude_id: int, n: int = 3) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM tags WHERE dimension_code = ? AND id != ? ORDER BY RANDOM() LIMIT ?",
        (dim, exclude_id, n),
    ).fetchall()
    return [r["name"] for r in rows]


def generate_duel_questions(conn, duel_id: int, tag: dict) -> list[dict]:
    """從該標籤的內容生成 5 回合簡易選擇題（MVP：模板式出題）。"""
    import json

    contents = _duel_tag_contents(conn, tag["id"], 20)
    questions = []
    for i in range(5):
        c = contents[i % len(contents)]
        ctags = conn.execute(
            """SELECT t.dimension_code, t.name, t.id FROM content_tags ct
               JOIN tags t ON t.id = ct.tag_id WHERE ct.content_id = ?""",
            (c["id"],),
        ).fetchall()
        by_dim: dict[str, list] = {}
        for t in ctags:
            by_dim.setdefault(t["dimension_code"], []).append(dict(t))

        variant = i % 3
        if variant == 0 and by_dim.get("CONC"):
            correct = by_dim["CONC"][0]
            opts = [correct["name"]] + _distractors(conn, "CONC", correct["id"])
            random.shuffle(opts)
            q = {
                "round": i + 1,
                "question": f"《{c['title']}》主要探討的核心概念是什麼？",
                "options": opts,
                "answer_index": opts.index(correct["name"]),
                "concept_note": (
                    f"觀念提醒：這篇內容的核心是「{correct['name']}」。若答錯，"
                    "可能是把相關概念搞混了，建議重讀內容摘要，再想想它和日常現象的連結。"
                ),
            }
        elif variant == 1 and by_dim.get("LIFE"):
            correct = by_dim["LIFE"][0]
            opts = [correct["name"]] + _distractors(conn, "LIFE", correct["id"])
            random.shuffle(opts)
            q = {
                "round": i + 1,
                "question": f"以下哪個生活情境，最適合觀察《{c['title']}》談到的現象？",
                "options": opts,
                "answer_index": opts.index(correct["name"]),
                "concept_note": (
                    f"觀念提醒：把知識放回「{correct['name']}」的生活場景想一想，"
                    "概念會記得更牢。若答錯，試著回想內容裡提到的日常例子。"
                ),
            }
        else:
            diff = (by_dim.get("DIFF") or [{"name": "L2 基礎"}])[0]
            opts = ["L1 入門", "L2 基礎", "L3 進階", "L4 挑戰"]
            q = {
                "round": i + 1,
                "question": f"《{c['title']}》在系統中的難度等級是？",
                "options": opts,
                "answer_index": opts.index(diff["name"]),
                "concept_note": (
                    f"觀念提醒：這篇內容標記為「{diff['name']}」。難度標籤代表先備知識需求，"
                    "答錯沒關係，代表你對內容定位的敏感度還在培養中。"
                ),
            }
        questions.append(q)
        conn.execute(
            """INSERT INTO duel_questions (duel_id, round, question, options, answer_index, concept_note)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (duel_id, q["round"], q["question"], json.dumps(q["options"], ensure_ascii=False),
             q["answer_index"], q["concept_note"]),
        )
    return questions


def create_duel(challenger_id: str, opponent_id: str, tag_token: str) -> dict:
    """§12.3 檢查：領土差距 ≤50%、共同標籤、同一對手每日一次。"""
    import json

    if challenger_id == opponent_id:
        return {"ok": False, "reason": "不能向自己發起對決，先找一位拓荒者夥伴吧！"}

    parsed = tag_token.split(":", 1) if ":" in tag_token else (None, None)
    with db.get_conn() as conn:
        ensure_user(conn, challenger_id)
        ensure_user(conn, opponent_id)
        tag = None
        if parsed[0]:
            tag = resolve_tag(parsed[0].strip().upper(), parsed[1].strip(), conn)
        if not tag:
            # 也允許直接用標籤名搜尋
            row = conn.execute("SELECT * FROM tags WHERE name = ?", (tag_token.strip(),)).fetchone()
            tag = dict(row) if row else None
        if not tag:
            return {"ok": False, "reason": f"找不到標籤「{tag_token}」，請確認標籤名稱或維度代碼。"}

        tag_label = f"{tag['dimension_code']}:{tag['name']}"
        occ = {}
        for uid in (challenger_id, opponent_id):
            r = conn.execute("SELECT occupied_tags FROM islands WHERE user_id = ?", (uid,)).fetchone()
            occ[uid] = json.loads(r["occupied_tags"]) if r else []
        if tag_label not in occ[challenger_id] or tag_label not in occ[opponent_id]:
            return {
                "ok": False,
                "reason": f"對決領域必須是雙方共同擁有的標籤。「{tag_label}」目前不是雙方的共同標籤，先各自去佔領它吧！",
            }

        t1 = conn.execute("SELECT territory FROM islands WHERE user_id = ?", (challenger_id,)).fetchone()
        t2 = conn.execute("SELECT territory FROM islands WHERE user_id = ?", (opponent_id,)).fetchone()
        terr1, terr2 = (t1["territory"] if t1 else 1.0), (t2["territory"] if t2 else 1.0)
        gap = abs(terr1 - terr2) / max(terr1, terr2) if max(terr1, terr2) > 0 else 0
        if gap > 0.5:
            return {
                "ok": False,
                "reason": (
                    f"雙方領土差距 {round(gap*100)}%（{terr1} vs {terr2} 單位），超過 50% 上限。"
                    "為了避免強弱懸殊的對決，請先各自修行、縮小差距再來挑戰！"
                ),
                "gap_percent": round(gap * 100, 1),
            }

        today_duel = conn.execute(
            f"""SELECT id FROM duel_sessions
               WHERE {db.date_col_eq_today('created_at')}
                 AND ((challenger_id = ? AND opponent_id = ?) OR (challenger_id = ? AND opponent_id = ?))""",
            (challenger_id, opponent_id, opponent_id, challenger_id),
        ).fetchone()
        if today_duel:
            return {
                "ok": False,
                "reason": "你們今天已經對決過一次了（同一對手每日限一次）。休息一下，明天再戰！",
            }

        duel_id = db.insert_id(
            conn,
            "INSERT INTO duel_sessions (challenger_id, opponent_id, tag_id) VALUES (?, ?, ?)",
            (challenger_id, opponent_id, tag["id"]),
        )
        n_contents = conn.execute(
            "SELECT COUNT(*) AS n FROM content_tags WHERE tag_id = ?", (tag["id"],)
        ).fetchone()["n"]
        if n_contents == 0:
            conn.rollback()
            return {
                "ok": False,
                "reason": f"標籤「{tag_label}」目前還沒有關聯內容，無法出題。先去探索這個領域吧！",
            }
        questions = generate_duel_questions(conn, duel_id, tag)
        conn.commit()

    public_qs = [
        {"round": q["round"], "question": q["question"], "options": q["options"]}
        for q in questions
    ]
    return {
        "ok": True,
        "duel_id": duel_id,
        "challenger_id": challenger_id,
        "opponent_id": opponent_id,
        "tag": tag_label,
        "status": "pending",
        "questions": public_qs,
        "reason": f"對決成立！領域「{tag_label}」，共 5 回合，雙方輪流作答吧。",
    }


def answer_duel(duel_id: int, user_id: str, answers: list[int]) -> dict:
    import json

    with db.get_conn() as conn:
        duel = conn.execute("SELECT * FROM duel_sessions WHERE id = ?", (duel_id,)).fetchone()
        if not duel:
            return {"ok": False, "reason": f"找不到編號 {duel_id} 的對決。"}
        if user_id not in (duel["challenger_id"], duel["opponent_id"]):
            return {"ok": False, "reason": "你不是這場對決的參加者。"}
        if duel["status"] == "finished":
            return {"ok": False, "reason": "這場對決已經結算了。"}

        already = conn.execute(
            "SELECT COUNT(*) AS n FROM duel_answers WHERE duel_id = ? AND user_id = ?",
            (duel_id, user_id),
        ).fetchone()["n"]
        if already > 0:
            return {"ok": False, "reason": "你已經提交過答案了，等對手作答吧！"}

        questions = conn.execute(
            "SELECT * FROM duel_questions WHERE duel_id = ? ORDER BY round", (duel_id,)
        ).fetchall()
        if len(answers) != len(questions):
            return {
                "ok": False,
                "reason": f"答案數量不符：本場共 {len(questions)} 題，你提交了 {len(answers)} 題。",
            }

        feedback = []
        score = 0
        for q, choice in zip(questions, answers):
            correct = int(choice == q["answer_index"])
            score += correct
            conn.execute(
                """INSERT INTO duel_answers (duel_id, user_id, round, choice_index, correct)
                   VALUES (?, ?, ?, ?, ?)""",
                (duel_id, user_id, q["round"], choice, correct),
            )
            options = json.loads(q["options"])
            feedback.append(
                {
                    "round": q["round"],
                    "correct": bool(correct),
                    "your_choice": options[choice] if 0 <= choice < len(options) else "未作答",
                    "correct_answer": options[q["answer_index"]],
                    "concept_note": q["concept_note"],
                }
            )

        # 雙方都答完 → 結算
        participants = {duel["challenger_id"], duel["opponent_id"]}
        answered_users = {
            r["user_id"]
            for r in conn.execute(
                "SELECT DISTINCT user_id FROM duel_answers WHERE duel_id = ?", (duel_id,)
            ).fetchall()
        }
        result = {"ok": True, "your_score": score, "total": len(questions),
                  "feedback": feedback, "settled": False}
        if answered_users == participants:
            result.update(_settle_duel(conn, duel, questions))
        conn.commit()
        return result


def _settle_duel(conn, duel, questions) -> dict:
    """§12.4 結算：資源 10%、領土 ±1、徽章。"""
    import json

    duel_id = duel["id"]
    scores = {}
    for uid in (duel["challenger_id"], duel["opponent_id"]):
        row = conn.execute(
            "SELECT COALESCE(SUM(correct),0) AS s FROM duel_answers WHERE duel_id = ? AND user_id = ?",
            (duel_id, uid),
        ).fetchone()
        scores[uid] = row["s"]

    c_id, o_id = duel["challenger_id"], duel["opponent_id"]
    if scores[c_id] == scores[o_id]:
        winner_id, loser_id, drawn = None, None, True
    elif scores[c_id] > scores[o_id]:
        winner_id, loser_id, drawn = c_id, o_id, False
    else:
        winner_id, loser_id, drawn = o_id, c_id, False

    def load_island(uid):
        r = conn.execute("SELECT * FROM islands WHERE user_id = ?", (uid,)).fetchone()
        return r, json.loads(r["resources"]), json.loads(r["badges"]), r["territory"]

    if drawn:
        for uid in (c_id, o_id):
            r, res, badges, terr = load_island(uid)
            if "平局之誼" not in badges:
                badges.append("平局之誼")
            conn.execute(
                "UPDATE islands SET badges = ? WHERE user_id = ?",
                (json.dumps(badges, ensure_ascii=False), uid),
            )
        conn.execute(
            "UPDATE duel_sessions SET status = 'finished' WHERE id = ?", (duel_id,)
        )
        return {
            "settled": True, "drawn": True, "winner_id": None,
            "scores": scores,
            "reason": f"平局！雙方各答對 {scores[c_id]} 題，獲得「平局之誼」徽章。切磋本身就是收穫！",
        }

    # 資源：勝利者獲得失敗者 10%（每種至少轉移 1 單位，若對方有存量）
    wr, wres, wbadges, wterr = load_island(winner_id)
    lr, lres, lbadges, lterr = load_island(loser_id)
    transferred = {}
    for k, v in lres.items():
        take = max(1, int(v * 0.1)) if v > 0 else 0
        take = min(take, v)
        if take:
            lres[k] -= take
            wres[k] = wres.get(k, 0) + take
            transferred[RESOURCE_NAMES.get(k, k)] = take
    # 領土：勝利者 +1、失敗者 -1（不低於 1）
    wterr_new = round(wterr + 1, 2)
    lterr_new = round(max(1.0, lterr - 1), 2)
    if "對決勝利" not in wbadges:
        wbadges.append("對決勝利")
    if "觀念修正" not in lbadges:
        lbadges.append("觀念修正")
    conn.execute(
        "UPDATE islands SET resources = ?, badges = ?, territory = ? WHERE user_id = ?",
        (json.dumps(wres, ensure_ascii=False), json.dumps(wbadges, ensure_ascii=False), wterr_new, winner_id),
    )
    conn.execute(
        "UPDATE islands SET resources = ?, badges = ?, territory = ? WHERE user_id = ?",
        (json.dumps(lres, ensure_ascii=False), json.dumps(lbadges, ensure_ascii=False), lterr_new, loser_id),
    )
    conn.execute(
        "UPDATE duel_sessions SET status = 'finished', winner_id = ? WHERE id = ?",
        (winner_id, duel_id),
    )
    # 推薦：失敗者獲得弱點內容推薦（取對決標籤內容前 2 筆）
    tag = conn.execute("SELECT * FROM tags WHERE id = ?", (duel["tag_id"],)).fetchone()
    recs = conn.execute(
        """SELECT ci.id, ci.title FROM content_items ci
           JOIN content_tags ct ON ct.content_id = ci.id
           WHERE ct.tag_id = ? LIMIT 2""",
        (duel["tag_id"],),
    ).fetchall()
    return {
        "settled": True,
        "drawn": False,
        "winner_id": winner_id,
        "loser_id": loser_id,
        "scores": scores,
        "transferred_resources": transferred,
        "territory_change": {winner_id: "+1", loser_id: "-1"},
        "badges": {winner_id: "對決勝利", loser_id: "觀念修正"},
        "loser_recommendations": [{"id": r["id"], "title": r["title"]} for r in recs],
        "reason": (
            f"對決結束！{winner_id} 以 {scores[winner_id]}:{scores[loser_id]} 獲勝，"
            f"獲得對方 10% 資源與 1 單位領土，並得到「對決勝利」徽章；"
            f"{loser_id} 獲得「觀念修正」徽章與弱點推薦內容。勝負之外，雙方都更理解「{tag['name']}」了。"
        ),
    }
