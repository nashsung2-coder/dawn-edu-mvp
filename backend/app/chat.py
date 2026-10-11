"""即時通訊 MVP：好友間文字訊息。"""
from __future__ import annotations

import uuid

from app import db


def _nid() -> str:
    return f"msg_{uuid.uuid4().hex[:12]}"


def send_message(sender_id: str, receiver_name: str, content: str) -> dict:
    """發送訊息給好友（用名字找）。"""
    if not content or not content.strip():
        raise ValueError("訊息不能為空。")
    if len(content) > 2000:
        raise ValueError("訊息太長（最多 2000 字）。")
    receiver_name = (receiver_name or "").strip()
    if not receiver_name:
        raise ValueError("請輸入好友名字。")
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, name FROM users WHERE name = ?" if not db.is_postgres()
            else "SELECT id, name FROM users WHERE name = %s",
            (receiver_name,)).fetchone()
        if not row:
            raise KeyError(f"找不到「{receiver_name}」。")
        rid = row["id"] if isinstance(row, dict) else row[0]
        rname = row["name"] if isinstance(row, dict) else row[1]
        if rid == sender_id:
            raise ValueError("不能傳訊息給自己。")
        mid = _nid()
        if db.is_postgres():
            conn.execute(
                "INSERT INTO chat_messages (id, sender_id, receiver_id, content) VALUES (%s, %s, %s, %s)",
                (mid, sender_id, rid, content.strip()))
        else:
            conn.execute(
                "INSERT INTO chat_messages (id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)",
                (mid, sender_id, rid, content.strip()))
        conn.commit()
    return {"ok": True, "id": mid, "receiver_name": rname}


def get_conversation(user_id: str, other_name: str, limit: int = 50) -> dict:
    """取得與某人的對話紀錄。"""
    other_name = (other_name or "").strip()
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, name FROM users WHERE name = ?" if not db.is_postgres()
            else "SELECT id, name FROM users WHERE name = %s",
            (other_name,)).fetchone()
        if not row:
            raise KeyError(f"找不到「{other_name}」。")
        oid = row["id"] if isinstance(row, dict) else row[0]
        oname = row["name"] if isinstance(row, dict) else row[1]
        ph = "%s" if db.is_postgres() else "?"
        rows = conn.execute(
            f"""SELECT m.*, u.name as sender_name FROM chat_messages m
                JOIN users u ON u.id = m.sender_id
                WHERE ((m.sender_id = {ph} AND m.receiver_id = {ph})
                   OR (m.sender_id = {ph} AND m.receiver_id = {ph}))
                ORDER BY m.created_at ASC LIMIT {ph}""",
            (user_id, oid, oid, user_id, limit)).fetchall()
        msgs = []
        for r in rows:
            d = dict(r)
            d["is_mine"] = (d["sender_id"] == user_id)
            msgs.append(d)
    return {"ok": True, "other_name": oname, "messages": msgs}


def list_conversations(user_id: str) -> list[dict]:
    """列出所有對話（最近聯絡人）。"""
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        rows = conn.execute(
            f"""SELECT DISTINCT
                    CASE WHEN m.sender_id = {ph} THEN m.receiver_id ELSE m.sender_id END as other_id,
                    u.name as other_name,
                    MAX(m.created_at) as last_at
                FROM chat_messages m
                JOIN users u ON u.id = CASE WHEN m.sender_id = {ph} THEN m.receiver_id ELSE m.sender_id END
                WHERE m.sender_id = {ph} OR m.receiver_id = {ph}
                GROUP BY other_id, other_name
                ORDER BY last_at DESC LIMIT 20""",
            (user_id, user_id, user_id, user_id)).fetchall()
        return [dict(r) for r in rows]
