"""
費曼說服系統：用戶用自己的話說服 AI → AI 評估完整度 →
不完整則反向提問 → 達標後 AI 用戶的話重整＋補數據 → 納入個人課本。
"""
from __future__ import annotations

import json
import uuid
from typing import Dict, Any

from app import db
from app import llm as llm_mod

# 達標分數門檻
PASS_SCORE = 75


def start_persuasion(user_id: str, topic: str, library_id: str = "") -> dict:
    """開始說服挑戰：用戶要說服 AI 他懂了這個主題。"""
    sid = "fp_" + uuid.uuid4().hex[:12]
    with db.get_conn() as conn:
        ph = "%s" if db.is_postgres() else "?"
        conn.execute(
            f"""INSERT INTO feynman_persuasion
            (id, user_id, topic, library_id, status, rounds, best_score)
            VALUES ({ph}, {ph}, {ph}, {ph}, 'active', 0, 0)""",
            (sid, user_id, topic, library_id))
        conn.commit()
    return {"ok": True, "session_id": sid, "topic": topic,
            "prompt": f"用你自己的話解釋「{topic}」，說服我你真的懂了。越具體越好，舉例子更好。"}


def submit_explanation(session_id: str, user_id: str, explanation: str) -> dict:
    """提交解釋，AI 評估。"""
    explanation = (explanation or "").strip()
    if len(explanation) < 20:
        raise ValueError("解釋太短了——試著講得更完整一點，至少能讓一個外行人聽懂。")

    with db.get_conn() as conn:
        ph = "%s" if db.is_postgres() else "?"
        row = conn.execute(
            f"SELECT * FROM feynman_persuasion WHERE id = {ph} AND user_id = {ph}",
            (session_id, user_id)).fetchone()
        if not row:
            raise KeyError("找不到這個說服挑戰。")
        sess = dict(row)
        if sess["status"] != "active":
            raise ValueError("這個挑戰已經結束了。")

        topic = sess["topic"]
        rounds = sess["rounds"] + 1

        # AI 評估
        evaluation = _evaluate(topic, explanation, rounds)

        score = evaluation["score"]
        best = max(sess["best_score"], score)

        conn.execute(
            f"""UPDATE feynman_persuasion SET rounds = {ph}, best_score = {ph}
                WHERE id = {ph}""",
            (rounds, best, session_id))

        # 記錄這輪
        conn.execute(
            f"""INSERT INTO feynman_rounds
            (id, session_id, round_num, explanation, score, ai_response)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})""",
            ("fr_" + uuid.uuid4().hex[:12], session_id, rounds,
             explanation[:2000], score,
             json.dumps(evaluation, ensure_ascii=False)))
        conn.commit()

        result = {
            "ok": True,
            "round": rounds,
            "score": score,
            "best_score": best,
            "passed": score >= PASS_SCORE,
            "ai_says": evaluation["feedback"],
        }

        if score >= PASS_SCORE:
            # 達標！AI 重整＋補數據 → 個人課本
            textbook_entry = _build_textbook_entry(topic, explanation, evaluation)
            _save_to_bookshelf(user_id, topic, textbook_entry, sess.get("library_id", ""))
            conn.execute(
                f"UPDATE feynman_persuasion SET status = 'passed' WHERE id = {ph}",
                (session_id,))
            conn.commit()
            result["textbook_entry"] = textbook_entry
            result["ai_says"] += "\n\n說服成功！我已經把你的解釋整理成課本條目，補上了相關數據，存入你的個人課本了。"
        else:
            # 不完整 → 反向提問
            result["followup_question"] = evaluation["followup"]
            result["ai_says"] += f"\n\n讓我考考你：{evaluation['followup']}"

        # 記錄探索（如果是從圖書館來的）
        if sess.get("library_id"):
            try:
                from app import exploration as exp_mod
                exp_mod.record_question(user_id, sess["library_id"])
            except Exception:
                pass

        return result


def _evaluate(topic: str, explanation: str, rounds: int) -> dict:
    """AI 評估解釋的完整度。"""
    try:
        result = llm_mod.evaluate_explanation(topic, explanation)
        if result and "score" in result:
            return result
    except Exception:
        pass

    # 降級：簡單啟發式
    score = min(90, 30 + len(explanation) // 10)
    return {
        "score": score,
        "feedback": "我大致理解了你的意思，但還想聽你講得更深入一點。",
        "followup": f"你能舉一個「{topic}」在生活中的具體例子嗎？",
        "missing_points": [],
    }


def _build_textbook_entry(topic: str, explanation: str, evaluation: dict) -> dict:
    """AI 用戶的話重整＋補數據，生成課本條目。"""
    try:
        entry = llm_mod.build_textbook_entry(topic, explanation, evaluation)
        if entry:
            return entry
    except Exception:
        pass

    return {
        "title": topic,
        "user_explanation": explanation,
        "ai_supplement": "（AI 補充數據功能暫時不可用，你的原始解釋已完整保存。）",
        "key_points": evaluation.get("missing_points", []),
    }


def _save_to_bookshelf(user_id: str, topic: str, entry: dict, library_id: str = ""):
    """存入個人課本（書架）。"""
    with db.get_conn() as conn:
        ph = "%s" if db.is_postgres() else "?"
        # 檢查 bookshelf 表
        try:
            conn.execute(
                f"""INSERT INTO bookshelf_entries
                (id, user_id, title, content, source, library_id, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, 'feynman', {ph}, {ph})""",
                ("be_" + uuid.uuid4().hex[:12], user_id, topic,
                 json.dumps(entry, ensure_ascii=False), library_id or "",
                 _now()))
        except Exception:
            # 表不存在就建
            conn.execute("""CREATE TABLE IF NOT EXISTS bookshelf_entries (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'feynman',
                library_id TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')))""")
            conn.execute(
                f"""INSERT INTO bookshelf_entries
                (id, user_id, title, content, source, library_id)
                VALUES ({ph}, {ph}, {ph}, {ph}, 'feynman', {ph})""",
                ("be_" + uuid.uuid4().hex[:12], user_id, topic,
                 json.dumps(entry, ensure_ascii=False), library_id or ""))
        conn.commit()


def get_session(session_id: str, user_id: str) -> dict:
    """取得挑戰狀態。"""
    with db.get_conn() as conn:
        ph = "%s" if db.is_postgres() else "?"
        row = conn.execute(
            f"SELECT * FROM feynman_persuasion WHERE id = {ph} AND user_id = {ph}",
            (session_id, user_id)).fetchone()
        if not row:
            raise KeyError("找不到這個挑戰。")
        sess = dict(row)
        rounds = conn.execute(
            f"""SELECT round_num, score, ai_response FROM feynman_rounds
                WHERE session_id = {ph} ORDER BY round_num""",
            (session_id,)).fetchall()
        sess["rounds_detail"] = [dict(r) for r in rounds]
        return {"ok": True, "session": sess}


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
