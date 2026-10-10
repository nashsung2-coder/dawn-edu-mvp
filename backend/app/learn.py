"""費曼戰役：學習會話管理。

流程：asking（提問＋寫假設）→ reading（文獻＋自我解釋提示）→ quiz（穿插測驗）
     → feynman（向 AI 解釋＋糾錯）→ done（授勳：技能章＋掌握度更新）

論文依據：
- BKT-lite 掌握度：Corbett & Anderson (1995)——Lv 晉升看 P(掌握)≥0.95
- 提取練習：Roediger & Karpicke (2006)；測驗要有回饋
- 知識建構度：Roscoe & Chi (2007)
"""
from __future__ import annotations

import json
import uuid

from app import db
from app import llm as llm_mod

GRADE_BANDS = ("國小", "國中", "高中", "大學先修")

# BKT-lite 參數
P_INIT = 0.15   # 初始掌握機率
P_LEARN = 0.25  # 每次有效學習的習得機率
P_GUESS = 0.2   # 猜對機率
P_SLIP = 0.1    # 粗心失手機率
MASTERY_THRESHOLD = 0.95


def _bkt_update(prior: float, correct: bool) -> float:
    """BKT 更新：先算後驗，再加學習增量。"""
    if correct:
        post = (prior * (1 - P_SLIP)) / (prior * (1 - P_SLIP) + (1 - prior) * P_GUESS)
    else:
        post = (prior * P_SLIP) / (prior * P_SLIP + (1 - prior) * (1 - P_GUESS))
    return post + (1 - post) * P_LEARN


def _row_to_dict(row) -> dict:
    return dict(row) if row is not None else {}


def start_session(user_id: str, question: str, grade_band: str = "高中",
                  hypothesis: str = "") -> dict:
    """開場：提問＋寫下自己的假設（Pressley 精緻化追問：先預測再給材料）。"""
    question = (question or "").strip()
    if not question:
        raise ValueError("請先提出一個問題。")
    if len(question) > 200:
        raise ValueError("問題太長了，請在 200 字以內。")
    if grade_band not in GRADE_BANDS:
        grade_band = "高中"
    topic = _extract_topic(question)
    depth = _topic_depth(user_id, topic) + 1  # 螺旋深入：同主題次數+1
    sid = "ls_" + uuid.uuid4().hex[:12]
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO learn_sessions (id, user_id, question, grade_band, topic, depth_level, status)"
            " VALUES (?, ?, ?, ?, ?, ?, 'reading')",
            (sid, user_id, question, grade_band, topic, depth),
        )
        if hypothesis.strip():
            conn.execute(
                "INSERT INTO learn_events (session_id, kind, payload) VALUES (?, 'hypothesis', ?)",
                (sid, json.dumps({"text": hypothesis.strip()[:500]}, ensure_ascii=False)),
            )
        conn.commit()
    return {"id": sid, "question": question, "grade_band": grade_band,
            "topic": topic, "depth_level": depth, "status": "reading",
            "teaching_preview": "很好——最後你要把這個問題教會 AI，現在開始閱讀時可以帶著「我要怎麼講給別人聽」的心態。（Fiorella & Mayer, 2014：教學預期）"}


def _extract_topic(question: str) -> str:
    """簡易主題提取：取問題中的關鍵名詞（前 12 字去問句）。"""
    q = question.strip()
    for suffix in ("為什麼", "為何", "怎麼", "如何", "是什麼", "什麼是", "?", "？"):
        q = q.replace(suffix, "")
    return q.strip()[:12] or "未命名主題"


def _topic_depth(user_id: str, topic: str) -> int:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT sessions_count FROM topic_mastery WHERE user_id = ? AND topic = ?",
            (user_id, topic)).fetchone()
        return int(row["sessions_count"]) if row else 0


def get_session(sid: str, user_id: str) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM learn_sessions WHERE id = ? AND user_id = ?",
            (sid, user_id)).fetchone()
        if not row:
            raise KeyError("找不到這個學習會話。")
        events = conn.execute(
            "SELECT kind, payload, created_at FROM learn_events WHERE session_id = ? ORDER BY id",
            (sid,)).fetchall()
    d = _row_to_dict(row)
    d["events"] = [{"kind": e["kind"], "payload": db.jloads(e["payload"], {}),
                    "created_at": e["created_at"]} for e in events]
    return d


def list_sessions(user_id: str, limit: int = 20) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id, question, grade_band, topic, depth_level, status, created_at, completed_at"
            " FROM learn_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit)).fetchall()
    return [_row_to_dict(r) for r in rows]


def log_event(sid: str, user_id: str, kind: str, payload: dict) -> None:
    _own_session(sid, user_id)
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO learn_events (session_id, kind, payload) VALUES (?, ?, ?)",
            (sid, kind, json.dumps(payload, ensure_ascii=False)))
        conn.commit()


def _own_session(sid: str, user_id: str) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM learn_sessions WHERE id = ? AND user_id = ?",
            (sid, user_id)).fetchone()
    if not row:
        raise KeyError("找不到這個學習會話。")
    return _row_to_dict(row)


def _set_status(sid: str, status: str) -> None:
    with db.get_conn() as conn:
        conn.execute("UPDATE learn_sessions SET status = ? WHERE id = ?", (status, sid))
        conn.commit()


def get_quiz(sid: str, user_id: str, n: int = 3) -> dict:
    """穿插測驗：生成題目（關書作答）。"""
    s = _own_session(sid, user_id)
    if s["status"] not in ("reading", "quiz"):
        raise ValueError("現在不是測驗階段。")
    quizzes = llm_mod.generate_quiz(s["question"], s["topic"], s["grade_band"],
                                    s["depth_level"], n)
    log_event(sid, user_id, "quiz", {"questions": quizzes})
    _set_status(sid, "quiz")
    # 回傳時隱藏答案
    public = [{"question": q["question"], "options": q["options"],
               "concept": q.get("concept", "")} for q in quizzes]
    return {"questions": public, "count": len(public),
            "llm": llm_mod.has_llm(),
            "note": "關書作答——提取練習的效果來自憑記憶提取。（Roediger & Karpicke, 2006）"}


def answer_quiz(sid: str, user_id: str, answers: list[int]) -> dict:
    """批改測驗＋更新掌握度（BKT-lite）。回傳每題對錯＋概念回饋。"""
    s = _own_session(sid, user_id)
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM learn_events WHERE session_id = ? AND kind = 'quiz'"
            " ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
    if not row:
        raise ValueError("還沒產生測驗題目。")
    quizzes = db.jloads(row["payload"], {}).get("questions", [])
    results = []
    correct_count = 0
    for i, q in enumerate(quizzes):
        chosen = answers[i] if i < len(answers) else -1
        ok = (chosen == q.get("answer_index"))
        correct_count += 1 if ok else 0
        results.append({"correct": ok, "answer_index": q.get("answer_index"),
                        "concept": q.get("concept", "") if not ok else ""})
    # BKT-lite：整份測驗視為一次觀測（答對率≥2/3 視為 correct）
    correct = (correct_count / max(1, len(quizzes))) >= 2 / 3
    mastery = _update_mastery(s["user_id"], s["topic"], correct)
    log_event(sid, user_id, "quiz_answer",
              {"answers": answers, "correct_count": correct_count,
               "total": len(quizzes), "mastery": mastery})
    _set_status(sid, "feynman")
    return {"results": results, "correct_count": correct_count,
            "total": len(quizzes), "mastery": round(mastery, 3),
            "mastered": mastery >= MASTERY_THRESHOLD,
            "next": "下一幕：費曼解釋——關書，用自己的話把整個概念講清楚，試圖說服 AI。"}


def _update_mastery(user_id: str, topic: str, correct: bool) -> float:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT mastery FROM topic_mastery WHERE user_id = ? AND topic = ?",
            (user_id, topic)).fetchone()
        prior = float(row["mastery"]) if row else P_INIT
        new = _bkt_update(prior, correct)
        if row:
            conn.execute(
                "UPDATE topic_mastery SET mastery = ?, last_at = "
                + ("NOW()" if db.is_postgres() else "datetime('now')")
                + " WHERE user_id = ? AND topic = ?",
                (new, user_id, topic))
        else:
            conn.execute(
                "INSERT INTO topic_mastery (user_id, topic, mastery, sessions_count)"
                " VALUES (?, ?, ?, 0)", (user_id, topic, new))
        conn.commit()
    return new


def feynman_explain(sid: str, user_id: str, explanation: str) -> dict:
    """費曼環節：學生解釋 → AI 糾錯＋追問。"""
    s = _own_session(sid, user_id)
    if s["status"] not in ("quiz", "feynman"):
        raise ValueError("請先完成穿插測驗。")
    explanation = (explanation or "").strip()
    if len(explanation) < 10:
        raise ValueError("解釋太短了——試著多講一點，講到別人能聽懂為止。")
    analysis = llm_mod.analyze_explanation(explanation)
    # 取歷史追問
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT payload FROM learn_events WHERE session_id = ? AND kind = 'ai_feedback'"
            " ORDER BY id DESC LIMIT 3", (sid,)).fetchall()
    history = []
    for r in rows:
        p = db.jloads(r["payload"], {})
        history.append({"q": p.get("followup", ""), "a": ""})
    fb = llm_mod.feynman_feedback(s["question"], explanation, history)
    log_event(sid, user_id, "explanation",
              {"text": explanation[:2000], "build_score": analysis["build_score"]})
    log_event(sid, user_id, "ai_feedback",
              {"feedback": fb["feedback"], "followup": fb.get("followup", ""),
               "llm": fb.get("llm", False)})
    _set_status(sid, "feynman")
    return {"feedback": fb["feedback"], "followup": fb.get("followup", ""),
            "build_score": analysis["build_score"],
            "llm": fb.get("llm", False),
            "can_finish": True,
            "hint": "覺得講清楚了就可以「完成戰役」授勳；還想再練可以繼續追問。"}


def finish_session(sid: str, user_id: str, badge_name: str = "") -> dict:
    """授勳：鍛造技能章（=武器）＋更新掌握度＋完成會話。"""
    s = _own_session(sid, user_id)
    if s["status"] == "done":
        raise ValueError("這場戰役已經結束了。")
    # 取建構度
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM learn_events WHERE session_id = ? AND kind = 'explanation'"
            " ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
    build_score = db.jloads(row["payload"], {}).get("build_score", 0.3) if row else 0.3
    # 掌握度再推一次（完成整場戰役視為一次有效學習）
    mastery = _update_mastery(user_id, s["topic"], True)
    # 技能章命名
    named = llm_mod.name_skill_badge(s["question"], s["topic"], s["depth_level"],
                                     build_score)
    name = (badge_name or "").strip()[:12] or named["name"]
    # 數值：基礎 10 ＋ 深度×6 ＋ 掌握度×20 ＋ 建構度×15
    attack = int(10 + s["depth_level"] * 6 + mastery * 20 + build_score * 15)
    defense = int(10 + s["depth_level"] * 4 + mastery * 15 + build_score * 10)
    bid = "bd_" + uuid.uuid4().hex[:12]
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO skill_badges (id, user_id, session_id, name, topic, depth,"
            " attack, defense, rarity, ai_comment, bond)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.2)",
            (bid, user_id, sid, name, s["topic"], s["depth_level"],
             attack, defense, named["rarity"], named["ai_comment"][:120]),
        )
        conn.execute(
            "UPDATE topic_mastery SET sessions_count = sessions_count + 1"
            " WHERE user_id = ? AND topic = ?", (user_id, s["topic"]))
        conn.execute(
            "UPDATE learn_sessions SET status = 'done', completed_at = "
            + ("NOW()" if db.is_postgres() else "datetime('now')")
            + " WHERE id = ?", (sid,))
        conn.execute(
            "INSERT INTO learn_events (session_id, kind, payload) VALUES (?, 'badge', ?)",
            (sid, json.dumps({"badge_id": bid, "name": name, "attack": attack,
                              "defense": defense, "rarity": named["rarity"]},
                             ensure_ascii=False)))
        conn.commit()
    return {"badge": {"id": bid, "name": name, "topic": s["topic"],
                      "depth": s["depth_level"], "attack": attack, "defense": defense,
                      "rarity": named["rarity"], "ai_comment": named["ai_comment"],
                      "bond": 0.2},
            "mastery": round(mastery, 3), "mastered": mastery >= MASTERY_THRESHOLD,
            "llm": named.get("llm", False)}


def list_badges(user_id: str) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM skill_badges WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,)).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_mastery(user_id: str) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT topic, mastery, sessions_count, last_at FROM topic_mastery"
            " WHERE user_id = ? ORDER BY mastery DESC", (user_id,)).fetchall()
    return [_row_to_dict(r) for r in rows]


def textbook_chapters(user_id: str) -> list[dict]:
    """課本筆記章節：每次完整戰役 → 一章（他的話為主）。"""
    with db.get_conn() as conn:
        sessions = conn.execute(
            "SELECT * FROM learn_sessions WHERE user_id = ? AND status = 'done'"
            " ORDER BY completed_at DESC", (user_id,)).fetchall()
        out = []
        for s in sessions:
            sd = _row_to_dict(s)
            events = conn.execute(
                "SELECT kind, payload FROM learn_events WHERE session_id = ? ORDER BY id",
                (s["id"],)).fetchall()
            ch = {"session_id": s["id"], "question": s["question"],
                  "topic": s["topic"], "depth": s["depth_level"],
                  "grade_band": s["grade_band"], "completed_at": s["completed_at"],
                  "hypothesis": "", "explanation": "", "ai_feedback": "",
                  "quiz_score": "", "badge": None}
            for e in events:
                p = db.jloads(e["payload"], {})
                if e["kind"] == "hypothesis":
                    ch["hypothesis"] = p.get("text", "")
                elif e["kind"] == "explanation":
                    ch["explanation"] = p.get("text", "")
                elif e["kind"] == "ai_feedback":
                    ch["ai_feedback"] = (p.get("feedback", "") + " " +
                                         p.get("followup", "")).strip()
                elif e["kind"] == "quiz_answer":
                    ch["quiz_score"] = f"{p.get('correct_count', 0)}/{p.get('total', 0)}"
                elif e["kind"] == "badge":
                    ch["badge"] = {"name": p.get("name"), "attack": p.get("attack"),
                                   "defense": p.get("defense"), "rarity": p.get("rarity")}
            out.append(ch)
    return out
