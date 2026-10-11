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


def create_group(creator_id: str, name: str, member_names: list[str] | None = None) -> dict:
    """建立群聊。member_names 是暱稱列表（不含自己）。"""
    name = (name or "").strip()
    if not name:
        raise ValueError("請輸入群聊名稱。")
    if len(name) > 50:
        raise ValueError("群聊名稱太長（最多 50 字）。")
    gid = f"grp_{uuid.uuid4().hex[:12]}"
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        conn.execute(
            f"INSERT INTO chat_groups (id, name, creator_id) VALUES ({ph}, {ph}, {ph})",
            (gid, name, creator_id))
        # 創建者自動加入
        conn.execute(
            f"INSERT INTO chat_group_members (group_id, user_id) VALUES ({ph}, {ph})",
            (gid, creator_id))
        # 加入其他成員（用暱稱找）
        added = []
        for mn in (member_names or []):
            mn = (mn or "").strip()
            if not mn:
                continue
            row = conn.execute(
                f"SELECT id, name FROM users WHERE name = {ph}", (mn,)).fetchone()
            if not row:
                continue
            uid = row["id"] if isinstance(row, dict) else row[0]
            uname = row["name"] if isinstance(row, dict) else row[1]
            if uid == creator_id:
                continue
            try:
                conn.execute(
                    f"INSERT INTO chat_group_members (group_id, user_id) VALUES ({ph}, {ph})",
                    (gid, uid))
                added.append(uname)
            except Exception:
                pass  # 已在群內
        conn.commit()
    return {"ok": True, "id": gid, "name": name, "added": added}


def list_groups(user_id: str) -> list[dict]:
    """列出我加入的群聊。"""
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        rows = conn.execute(
            f"""SELECT g.id, g.name, g.created_at,
                       (SELECT COUNT(*) FROM chat_group_members m2 WHERE m2.group_id = g.id) as member_count
                FROM chat_groups g
                JOIN chat_group_members m ON m.group_id = g.id
                WHERE m.user_id = {ph}
                ORDER BY g.created_at DESC LIMIT 20""",
            (user_id,)).fetchall()
        return [dict(r) for r in rows]


def send_group_message(sender_id: str, group_id: str, content: str) -> dict:
    """在群聊發訊息。"""
    if not content or not content.strip():
        raise ValueError("訊息不能為空。")
    if len(content) > 2000:
        raise ValueError("訊息太長（最多 2000 字）。")
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        # 確認是成員
        row = conn.execute(
            f"SELECT 1 FROM chat_group_members WHERE group_id = {ph} AND user_id = {ph}",
            (group_id, sender_id)).fetchone()
        if not row:
            raise ValueError("你不在這個群聊中。")
        mid = _nid()
        conn.execute(
            f"INSERT INTO chat_group_messages (id, group_id, sender_id, content) VALUES ({ph}, {ph}, {ph}, {ph})",
            (mid, group_id, sender_id, content.strip()))
        conn.commit()
    return {"ok": True, "id": mid}


def get_group_messages(user_id: str, group_id: str, limit: int = 50) -> dict:
    """取得群聊訊息。"""
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        # 確認是成員
        mem = conn.execute(
            f"SELECT 1 FROM chat_group_members WHERE group_id = {ph} AND user_id = {ph}",
            (group_id, user_id)).fetchone()
        if not mem:
            raise ValueError("你不在這個群聊中。")
        grow = conn.execute(
            f"SELECT id, name FROM chat_groups WHERE id = {ph}", (group_id,)).fetchone()
        if not grow:
            raise KeyError("找不到這個群聊。")
        gname = grow["name"] if isinstance(grow, dict) else grow[1]
        rows = conn.execute(
            f"""SELECT m.*, u.name as sender_name FROM chat_group_messages m
                JOIN users u ON u.id = m.sender_id
                WHERE m.group_id = {ph}
                ORDER BY m.created_at ASC LIMIT {ph}""",
            (group_id, limit)).fetchall()
        msgs = []
        for r in rows:
            d = dict(r)
            d["is_mine"] = (d["sender_id"] == user_id)
            msgs.append(d)
        # 成員列表
        members = conn.execute(
            f"""SELECT u.name FROM chat_group_members m
                JOIN users u ON u.id = m.user_id
                WHERE m.group_id = {ph} ORDER BY u.name""",
            (group_id,)).fetchall()
    return {"ok": True, "group_id": group_id, "group_name": gname,
            "messages": msgs, "members": [m["name"] if isinstance(m, dict) else m[0] for m in members]}


def search_user_by_name(name: str) -> dict | None:
    """用暱稱找用戶（不暴露敏感資訊）。"""
    name = (name or "").strip()
    if not name:
        return None
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        row = conn.execute(
            f"SELECT id, name FROM users WHERE name = {ph}", (name,)).fetchone()
        if not row:
            return None
        return {"id": row["id"] if isinstance(row, dict) else row[0],
                "name": row["name"] if isinstance(row, dict) else row[1]}
