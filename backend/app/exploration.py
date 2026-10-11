"""
圖書館探索系統：題目是鉤子，學習是本體。
讀頁面＋提問 → 探索度 → 解鎖該庫專屬武器（等級隨探索度提升）。
交易武器時等級降一級。
"""
from __future__ import annotations

import json
import uuid
from typing import List, Dict, Any

from app import db

# 探索里程碑：探索度 → 武器等級
MILESTONES = [
    (30, 1, "初級探索"),
    (60, 2, "中級探索"),
    (90, 3, "高級探索"),
]

# 讀一頁 +8%，問一個問題 +5%
PAGE_PROGRESS = 8.0
QUESTION_PROGRESS = 5.0


def _get_or_create_exploration(conn, user_id: str, library_id: str) -> dict:
    ph = "%s" if db.is_postgres() else "?"
    row = conn.execute(
        f"SELECT * FROM library_exploration WHERE user_id = {ph} AND library_id = {ph}",
        (user_id, library_id)).fetchone()
    if row:
        return dict(row)
    conn.execute(
        f"INSERT INTO library_exploration (user_id, library_id) VALUES ({ph}, {ph})",
        (user_id, library_id))
    conn.commit()
    return {"user_id": user_id, "library_id": library_id, "progress": 0,
            "pages_read": 0, "questions_asked": 0, "weapon_claimed_lv": 0}


def record_page_read(user_id: str, library_id: str) -> dict:
    """記錄讀了一頁。"""
    with db.get_conn() as conn:
        exp = _get_or_create_exploration(conn, user_id, library_id)
        ph = "%s" if db.is_postgres() else "?"
        new_progress = min(100.0, exp["progress"] + PAGE_PROGRESS)
        conn.execute(
            f"""UPDATE library_exploration SET progress = {ph}, pages_read = pages_read + 1,
                updated_at = {ph} WHERE user_id = {ph} AND library_id = {ph}""",
            (new_progress, _now(), user_id, library_id))
        conn.commit()
        return {"ok": True, "progress": new_progress,
                "weapon_available": _check_weapon(conn, user_id, library_id, new_progress)}


def record_question(user_id: str, library_id: str) -> dict:
    """記錄問了一個問題（費曼提問）。"""
    with db.get_conn() as conn:
        exp = _get_or_create_exploration(conn, user_id, library_id)
        ph = "%s" if db.is_postgres() else "?"
        new_progress = min(100.0, exp["progress"] + QUESTION_PROGRESS)
        conn.execute(
            f"""UPDATE library_exploration SET progress = {ph}, questions_asked = questions_asked + 1,
                updated_at = {ph} WHERE user_id = {ph} AND library_id = {ph}""",
            (new_progress, _now(), user_id, library_id))
        conn.commit()
        return {"ok": True, "progress": new_progress,
                "weapon_available": _check_weapon(conn, user_id, library_id, new_progress)}


def _check_weapon(conn, user_id: str, library_id: str, progress: float) -> dict | None:
    """檢查是否有新武器可領取。"""
    ph = "%s" if db.is_postgres() else "?"
    exp = conn.execute(
        f"SELECT weapon_claimed_lv FROM library_exploration WHERE user_id = {ph} AND library_id = {ph}",
        (user_id, library_id)).fetchone()
    claimed = exp["weapon_claimed_lv"] if exp else 0

    for threshold, lv, label in MILESTONES:
        if progress >= threshold and lv > claimed:
            # 有該庫專屬武器嗎？
            w = conn.execute(
                f"SELECT * FROM library_weapons WHERE library_id = {ph}",
                (library_id,)).fetchone()
            if w:
                return {"level": lv, "label": label, "weapon": dict(w)}
            # 沒有就用預設
            return {"level": lv, "label": label, "weapon": {
                "weapon_id": f"lib_{library_id[:8]}",
                "name": "探索者之刃",
                "base_dmg_min": 10, "base_dmg_max": 20,
            }}
    return None


def claim_weapon(user_id: str, library_id: str) -> dict:
    """領取探索武器。"""
    with db.get_conn() as conn:
        ph = "%s" if db.is_postgres() else "?"
        exp_row = conn.execute(
            f"SELECT * FROM library_exploration WHERE user_id = {ph} AND library_id = {ph}",
            (user_id, library_id)).fetchone()
        if not exp_row:
            raise ValueError("還沒有探索記錄。")
        exp = dict(exp_row)
        progress = exp["progress"]
        claimed = exp["weapon_claimed_lv"]

        # 找最高可領等級
        target_lv = 0
        target_label = ""
        for threshold, lv, label in MILESTONES:
            if progress >= threshold and lv > claimed:
                target_lv = lv
                target_label = label

        if target_lv == 0:
            raise ValueError("探索度還不夠，繼續探索吧！")

        # 取武器
        w = conn.execute(
            f"SELECT * FROM library_weapons WHERE library_id = {ph}",
            (library_id,)).fetchone()
        weapon = dict(w) if w else {
            "weapon_id": f"lib_{library_id[:8]}",
            "name": "探索者之刃",
            "base_dmg_min": 10, "base_dmg_max": 20,
        }

        # 發放到用戶武器庫（帶等級）
        _grant_weapon(conn, user_id, weapon, target_lv, library_id)

        conn.execute(
            f"UPDATE library_exploration SET weapon_claimed_lv = {ph} WHERE user_id = {ph} AND library_id = {ph}",
            (target_lv, user_id, library_id))
        conn.commit()

        return {"ok": True, "level": target_lv, "label": target_label,
                "weapon_name": weapon["name"]}


def _grant_weapon(conn, user_id: str, weapon: dict, level: int, library_id: str):
    """發放武器到用戶背包（含等級）。"""
    import json as js
    ph = "%s" if db.is_postgres() else "?"
    # 檢查 user_weapons 表
    try:
        conn.execute(f"""INSERT INTO user_weapons
            (user_id, weapon_id, name, level, library_id, dmg_min, dmg_max)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})""",
            (user_id, weapon["weapon_id"], weapon["name"], level, library_id,
             weapon["base_dmg_min"] + (level - 1) * 5,
             weapon["base_dmg_max"] + (level - 1) * 8))
    except Exception:
        # 表不存在就建
        conn.execute("""CREATE TABLE IF NOT EXISTS user_weapons (
            user_id TEXT NOT NULL, weapon_id TEXT NOT NULL,
            name TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1,
            library_id TEXT DEFAULT '', dmg_min INTEGER DEFAULT 10,
            dmg_max INTEGER DEFAULT 20,
            PRIMARY KEY (user_id, weapon_id, level))""")
        conn.execute(f"""INSERT INTO user_weapons
            (user_id, weapon_id, name, level, library_id, dmg_min, dmg_max)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})""",
            (user_id, weapon["weapon_id"], weapon["name"], level, library_id,
             weapon["base_dmg_min"] + (level - 1) * 5,
             weapon["base_dmg_max"] + (level - 1) * 8))
    conn.commit()


def get_exploration(user_id: str, library_id: str) -> dict:
    """取得探索進度。"""
    with db.get_conn() as conn:
        exp = _get_or_create_exploration(conn, user_id, library_id)
        return {"ok": True, "exploration": {
            "progress": exp["progress"],
            "pages_read": exp["pages_read"],
            "questions_asked": exp["questions_asked"],
            "weapon_claimed_lv": exp["weapon_claimed_lv"],
            "milestones": [{"threshold": t, "level": lv, "label": lb}
                           for t, lv, lb in MILESTONES],
        }}


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
