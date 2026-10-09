"""星砂經濟：學習積分、武器商店（純遊戲模組）。

設計說明：
- 星砂是學習行為的獎勵貨幣：開疆拓土由伺服器發放（+10/次），
  對決勝利等由前端回報（單次上限 50，純遊戲、寬鬆防濫刷）。
- 武器只能用來挑戰雷達上的模擬拓荒者（假資料），不影響真實使用者。
"""
from __future__ import annotations

import json

from app import db

# 武器圖鑑（商店目錄；購買驗證用）
WEAPONS = {
    "dart": {
        "name": "星塵飛鏢", "cost": 20, "type": "attack",
        "desc": "輕巧迅捷的星砂飛鏢，對拓荒者造成 10–20 傷害。",
        "dmg": [10, 20],
    },
    "wave": {
        "name": "潮汐巨浪", "cost": 50, "type": "attack",
        "desc": "引動知識之海的巨浪，造成 25–40 傷害。",
        "dmg": [25, 40],
    },
    "shield": {
        "name": "曙光護盾", "cost": 30, "type": "defense",
        "desc": "抵擋下一次反擊，守護你的島嶼。",
    },
}

EARN_CAP_PER_CALL = 50


def _user_row(conn, user_id):
    return conn.execute(
        "SELECT id, points, inventory FROM users WHERE id = ?", (user_id,)
    ).fetchone()


def get_state(user_id: str) -> dict:
    with db.get_conn() as conn:
        row = _user_row(conn, user_id)
        if not row:
            raise KeyError("user not found")
        return {
            "points": row["points"] or 0,
            "inventory": db.jloads(row["inventory"], {}),
        }


def earn(user_id: str, amount: int, reason: str = "") -> dict:
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        raise ValueError("amount 須為整數。")
    amount = max(0, min(amount, EARN_CAP_PER_CALL))
    if amount <= 0:
        raise ValueError("amount 須為正整數。")
    with db.get_conn() as conn:
        row = _user_row(conn, user_id)
        if not row:
            raise KeyError("user not found")
        conn.execute("UPDATE users SET points = points + ? WHERE id = ?", (amount, user_id))
        conn.commit()
        new_points = (row["points"] or 0) + amount
    return {"ok": True, "earned": amount, "points": new_points, "reason": reason}


def buy(user_id: str, item_id: str) -> dict:
    item = WEAPONS.get(item_id)
    if not item:
        raise ValueError(f"沒有這個武器「{item_id}」。")
    with db.get_conn() as conn:
        row = _user_row(conn, user_id)
        if not row:
            raise KeyError("user not found")
        points = row["points"] or 0
        if points < item["cost"]:
            raise ValueError(f"星砂不足（需要 {item['cost']}，目前 {points}）。")
        inv = db.jloads(row["inventory"], {})
        inv[item_id] = inv.get(item_id, 0) + 1
        conn.execute(
            "UPDATE users SET points = points - ?, inventory = ? WHERE id = ?",
            (item["cost"], json.dumps(inv, ensure_ascii=False), user_id),
        )
        conn.commit()
    return {
        "ok": True, "item": item_id, "name": item["name"],
        "points": points - item["cost"], "inventory": inv,
    }


def award_expand(user_id: str) -> int:
    """開疆拓土成功時由伺服器發放星砂（+10）。"""
    return earn(user_id, 10, "開疆拓土")["points"]


def use_item(user_id: str, item_id: str) -> dict:
    """消耗一個武器（戰鬥中使用）。"""
    with db.get_conn() as conn:
        row = _user_row(conn, user_id)
        if not row:
            raise KeyError("user not found")
        inv = db.jloads(row["inventory"], {})
        if inv.get(item_id, 0) <= 0:
            raise ValueError(f"你沒有「{item_id}」。")
        inv[item_id] -= 1
        if inv[item_id] <= 0:
            del inv[item_id]
        conn.execute(
            "UPDATE users SET inventory = ? WHERE id = ?",
            (json.dumps(inv, ensure_ascii=False), user_id),
        )
        conn.commit()
    return {"ok": True, "inventory": inv}
