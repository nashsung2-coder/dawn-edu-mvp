"""間隔重複複習系統（SM-2）：讓學過的東西不被遺忘。

戰役完成時自動生成複習卡片，用戶按 0-5 自評回憶程度，
系統按 SM-2 算法安排下次複習時間。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from app import db


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def create_cards_from_session(user_id: str, session_id: str, topic: str,
                               question: str, quiz_questions: list[dict] | None = None) -> list[dict]:
    """戰役完成時生成複習卡片：主題卡 + 每道測驗題一張卡。"""
    cards = []
    # 主題總覽卡
    cards.append({
        "topic": topic,
        "question": f"用自己的話解釋：{question}",
        "hint": "試著不看筆記，完整講一遍核心概念。",
    })
    # 每道測驗題一張卡
    for q in (quiz_questions or [])[:5]:
        qq = q.get("question", "") if isinstance(q, dict) else str(q)
        if qq:
            cards.append({
                "topic": topic,
                "question": qq,
                "hint": q.get("concept", "") if isinstance(q, dict) else "",
            })
    out = []
    with db.get_conn() as conn:
        for c in cards:
            cid = "rc_" + uuid.uuid4().hex[:12]
            next_at = (datetime.utcnow() + timedelta(days=1)).isoformat()
            conn.execute(
                """INSERT INTO review_cards
                   (id, user_id, topic, question, hint, session_id, next_review_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (cid, user_id, c["topic"], c["question"], c["hint"], session_id, next_at),
            )
            out.append({"id": cid, **c, "next_review_at": next_at})
        conn.commit()
    return out


def due_cards(user_id: str, limit: int = 20) -> list[dict]:
    """到期的複習卡片（next_review_at <= now）。"""
    now = _now_iso()
    with db.get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM review_cards
               WHERE user_id = ? AND next_review_at <= ?
               ORDER BY next_review_at ASC LIMIT ?""",
            (user_id, now, limit)).fetchall()
    return [dict(r) for r in rows]


def upcoming_cards(user_id: str, limit: int = 20) -> list[dict]:
    """未到期的卡片（預覽）。"""
    now = _now_iso()
    with db.get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM review_cards
               WHERE user_id = ? AND next_review_at > ?
               ORDER BY next_review_at ASC LIMIT ?""",
            (user_id, now, limit)).fetchall()
    return [dict(r) for r in rows]


def grade_card(user_id: str, card_id: str, grade: int) -> dict:
    """SM-2 評分：0-5（0 完全忘記，5 輕鬆回憶）。

    EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
    q < 3 → repetitions 歸零，interval = 1
    q >= 3 → repetitions+1；interval = 1 (r=1) / 6 (r=2) / interval*EF
    """
    if not 0 <= grade <= 5:
        raise ValueError("評分必須是 0-5。")
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM review_cards WHERE id = ? AND user_id = ?",
            (card_id, user_id)).fetchone()
        if not row:
            raise ValueError("找不到這張複習卡。")
        card = dict(row)

        ef = card["easiness"]
        reps = card["repetitions"]
        interval = card["interval_days"]

        # 更新 EF
        ef = ef + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
        ef = max(1.3, ef)

        if grade < 3:
            reps = 0
            interval = 1
        else:
            reps += 1
            if reps == 1:
                interval = 1
            elif reps == 2:
                interval = 6
            else:
                interval = max(1, round(interval * ef))

        next_at = (datetime.utcnow() + timedelta(days=interval)).isoformat()
        now = _now_iso()
        conn.execute(
            """UPDATE review_cards
               SET easiness = ?, interval_days = ?, repetitions = ?,
                   next_review_at = ?, last_reviewed_at = ?
               WHERE id = ?""",
            (ef, interval, reps, next_at, now, card_id))
        conn.commit()

    return {
        "id": card_id,
        "grade": grade,
        "easiness": round(ef, 2),
        "interval_days": interval,
        "repetitions": reps,
        "next_review_at": next_at,
        "message": f"下次複習：{interval} 天後（{next_at[:10]}）",
    }


def review_stats(user_id: str) -> dict:
    """複習統計。"""
    now = _now_iso()
    with db.get_conn() as conn:
        total = conn.execute(
            "SELECT COUNT(*) AS count FROM review_cards WHERE user_id = ?", (user_id,)).fetchone()["count"]
        due = conn.execute(
            "SELECT COUNT(*) AS count FROM review_cards WHERE user_id = ? AND next_review_at <= ?",
            (user_id, now)).fetchone()["count"]
        done = conn.execute(
            "SELECT COUNT(*) AS count FROM review_cards WHERE user_id = ? AND repetitions > 0",
            (user_id,)).fetchone()["count"]
    return {
        "total_cards": total,
        "due_count": due,
        "reviewed_count": done,
        "completion_rate": round(done / total, 2) if total else 0,
    }
