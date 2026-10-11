"""
太空探索：宇宙未知之境。
- 開飛船在 2D 宇宙中飛行
- 遇到星球可選擇降落，降落後進入關卡（遊戲風格不變）
- 可以看到其他玩家，往人多的地方飛
- 可以跟他人對戰
- 伺服器只提供座標、HP、攻擊等最簡資訊，對戰畫面由前端本地渲染
"""
from __future__ import annotations

import math
import random
import time
import uuid

from app import db

# 宇宙大小
UNIVERSE_SIZE = 10000

# 星球類型：每種對應不同的關卡主題
PLANET_TYPES = {
    "knowledge": {"name": "知識星", "color": "#4A90D9", "levels": ["初級", "中級", "高級"]},
    "battle": {"name": "戰鬥星", "color": "#E74C3C", "levels": ["競技場", "擂台賽", "冠軍戰"]},
    "explore": {"name": "探索星", "color": "#27AE60", "levels": ["淺層", "深層", "核心"]},
    "mystery": {"name": "神秘星", "color": "#9B59B6", "levels": ["迷霧", "幻境", "真相"]},
}

# 固定星球位置（用種子隨機生成，保證每次一致）
def _get_planets() -> list[dict]:
    rng = random.Random(42)  # 固定種子
    planets = []
    types = list(PLANET_TYPES.keys())
    for i in range(20):
        t = types[i % len(types)]
        planets.append({
            "id": f"planet_{i}",
            "name": f"{PLANET_TYPES[t]['name']}-{i+1}",
            "type": t,
            "color": PLANET_TYPES[t]["color"],
            "x": rng.randint(500, UNIVERSE_SIZE - 500),
            "y": rng.randint(500, UNIVERSE_SIZE - 500),
            "radius": rng.randint(80, 150),
            "levels": PLANET_TYPES[t]["levels"],
        })
    return planets

_PLANETS = _get_planets()


def get_planets() -> list[dict]:
    return _PLANETS


def get_planet(pid: str) -> dict | None:
    for p in _PLANETS:
        if p["id"] == pid:
            return p
    return None


def _nid(prefix: str = "sp") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def update_position(user_id: str, x: float, y: float) -> dict:
    """更新玩家座標。"""
    x = max(0, min(UNIVERSE_SIZE, float(x)))
    y = max(0, min(UNIVERSE_SIZE, float(y)))
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        # upsert
        if db.is_postgres():
            conn.execute(f"""
                INSERT INTO space_positions (user_id, x, y, updated_at)
                VALUES ({ph}, {ph}, {ph}, NOW())
                ON CONFLICT (user_id) DO UPDATE SET x = {ph}, y = {ph}, updated_at = NOW()
            """, (user_id, x, y, x, y))
        else:
            conn.execute(f"""
                INSERT OR REPLACE INTO space_positions (user_id, x, y, updated_at)
                VALUES ({ph}, {ph}, {ph}, datetime('now'))
            """, (user_id, x, y))
        conn.commit()
    return {"ok": True, "x": x, "y": y}


def get_nearby(user_id: str, x: float, y: float, radius: float = 2000) -> dict:
    """取得附近的玩家和星球。伺服器只給座標，不運算畫面。"""
    ph = "%s" if db.is_postgres() else "?"
    players = []
    with db.get_conn() as conn:
        # 附近玩家（5 分鐘內有活動的）
        if db.is_postgres():
            rows = conn.execute(f"""
                SELECT p.user_id, p.x, p.y, u.name
                FROM space_positions p JOIN users u ON u.id = p.user_id
                WHERE p.user_id != {ph} AND p.updated_at > NOW() - INTERVAL '5 minutes'
            """, (user_id,)).fetchall()
        else:
            rows = conn.execute(f"""
                SELECT p.user_id, p.x, p.y, u.name
                FROM space_positions p JOIN users u ON u.id = p.user_id
                WHERE p.user_id != {ph} AND p.updated_at > datetime('now', '-5 minutes')
            """, (user_id,)).fetchall()
        for r in rows:
            d = dict(r)
            px, py = float(d["x"]), float(d["y"])
            dist = math.hypot(px - x, py - y)
            if dist <= radius:
                players.append({
                    "user_id": d["user_id"],
                    "name": d["name"],
                    "x": px, "y": py,
                    "dist": round(dist),
                })
        # 我的位置
        me = conn.execute(
            f"SELECT x, y FROM space_positions WHERE user_id = {ph}", (user_id,)).fetchone()
        if me:
            mx, my = float(me["x"] if isinstance(me, dict) else me[0]), float(me["y"] if isinstance(me, dict) else me[1])
        else:
            mx, my = UNIVERSE_SIZE / 2, UNIVERSE_SIZE / 2
            update_position(user_id, mx, my)
    # 附近星球
    nearby_planets = []
    for p in _PLANETS:
        dist = math.hypot(p["x"] - x, p["y"] - y)
        if dist <= radius + p["radius"]:
            nearby_planets.append({**p, "dist": round(dist)})
    # 人多的區域（用於「往人多的地方飛」）
    hotspots = _get_hotspots()
    return {
        "ok": True,
        "me": {"x": mx, "y": my},
        "players": sorted(players, key=lambda p: p["dist"])[:20],
        "planets": sorted(nearby_planets, key=lambda p: p["dist"]),
        "hotspots": hotspots,
        "universe_size": UNIVERSE_SIZE,
    }


def _get_hotspots(n: int = 5) -> list[dict]:
    """人多的區域（玩家聚集點）。"""
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        if db.is_postgres():
            rows = conn.execute("""
                SELECT x, y FROM space_positions
                WHERE updated_at > NOW() - INTERVAL '10 minutes'
                LIMIT 100
            """).fetchall()
        else:
            rows = conn.execute("""
                SELECT x, y FROM space_positions
                WHERE updated_at > datetime('now', '-10 minutes')
                LIMIT 100
            """).fetchall()
        if not rows:
            return []
        # 簡單聚類：網格化
        grid = {}
        cell = 1000
        for r in rows:
            d = dict(r)
            gx, gy = int(float(d["x"]) // cell), int(float(d["y"]) // cell)
            key = (gx, gy)
            grid[key] = grid.get(key, 0) + 1
        hotspots = sorted(grid.items(), key=lambda kv: -kv[1])[:n]
        return [{"x": gx * cell + cell // 2, "y": gy * cell + cell // 2, "count": c}
                for (gx, gy), c in hotspots if c >= 2]


def land_on_planet(user_id: str, planet_id: str) -> dict:
    """降落星球。回傳關卡資訊，前端決定顯示哪個關卡。"""
    p = get_planet(planet_id)
    if not p:
        raise KeyError("找不到這個星球。")
    # 檢查距離（必須在星球範圍內）
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        me = conn.execute(
            f"SELECT x, y FROM space_positions WHERE user_id = {ph}", (user_id,)).fetchone()
        if not me:
            raise ValueError("先更新你的座標。")
        mx = float(me["x"] if isinstance(me, dict) else me[0])
        my = float(me["y"] if isinstance(me, dict) else me[1])
        dist = math.hypot(p["x"] - mx, p["y"] - my)
        if dist > p["radius"] + 100:
            raise ValueError(f"離星球太遠（{int(dist)}），先飛近一點。")
    return {
        "ok": True,
        "planet": p,
        "message": f"降落在 {p['name']}！選擇一個關卡開始挑戰。",
    }


# ---------------- 對戰（伺服器只存狀態，前端渲染） ----------------

def challenge_player(challenger_id: str, target_name: str) -> dict:
    """向另一位玩家發起對戰。"""
    target_name = (target_name or "").strip()
    if not target_name:
        raise ValueError("請輸入對方暱稱。")
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        row = conn.execute(
            f"SELECT id, name FROM users WHERE name = {ph}", (target_name,)).fetchone()
        if not row:
            raise KeyError(f"找不到「{target_name}」。")
        tid = row["id"] if isinstance(row, dict) else row[0]
        tname = row["name"] if isinstance(row, dict) else row[1]
        if tid == challenger_id:
            raise ValueError("不能跟自己對戰。")
        # 檢查對方是否在線上（5 分鐘內有座標）
        if db.is_postgres():
            pos = conn.execute(
                f"SELECT x, y FROM space_positions WHERE user_id = {ph} AND updated_at > NOW() - INTERVAL '5 minutes'",
                (tid,)).fetchone()
        else:
            pos = conn.execute(
                f"SELECT x, y FROM space_positions WHERE user_id = {ph} AND updated_at > datetime('now', '-5 minutes')",
                (tid,)).fetchone()
        # 建立對戰（雙方初始 HP 100）
        bid = _nid("battle")
        if db.is_postgres():
            conn.execute(
                f"INSERT INTO space_battles (id, p1_id, p2_id, p1_hp, p2_hp, status) VALUES ({ph}, {ph}, {ph}, 100, 100, 'waiting')",
                (bid, challenger_id, tid))
        else:
            conn.execute(
                f"INSERT INTO space_battles (id, p1_id, p2_id, p1_hp, p2_hp, status) VALUES ({ph}, {ph}, {ph}, 100, 100, 'waiting')",
                (bid, challenger_id, tid))
        conn.commit()
    return {"ok": True, "battle_id": bid, "opponent": tname,
            "message": f"已向 {tname} 發起挑戰！等待對方接受。"}


def accept_battle(user_id: str, battle_id: str) -> dict:
    """接受對戰。"""
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        row = conn.execute(
            f"SELECT * FROM space_battles WHERE id = {ph}", (battle_id,)).fetchone()
        if not row:
            raise KeyError("找不到這場對戰。")
        d = dict(row)
        if d["p2_id"] != user_id:
            raise ValueError("這不是你的對戰。")
        if d["status"] != "waiting":
            raise ValueError("對戰已經開始或結束。")
        conn.execute(
            f"UPDATE space_battles SET status = 'active' WHERE id = {ph}", (battle_id,))
        conn.commit()
    return {"ok": True, "battle_id": battle_id, "status": "active"}


def battle_attack(user_id: str, battle_id: str, damage: int) -> dict:
    """
    攻擊。伺服器只記錄 HP 變化，不運算動畫。
    damage 由前端根據武器/答題結果計算，伺服器只做範圍檢查。
    """
    damage = max(0, min(50, int(damage)))  # 每擊最多 50
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        row = conn.execute(
            f"SELECT * FROM space_battles WHERE id = {ph}", (battle_id,)).fetchone()
        if not row:
            raise KeyError("找不到這場對戰。")
        d = dict(row)
        if d["status"] != "active":
            raise ValueError("對戰尚未開始或已結束。")
        # 判斷打誰
        if d["p1_id"] == user_id:
            target_hp = "p2_hp"
            target_id = d["p2_id"]
        elif d["p2_id"] == user_id:
            target_hp = "p1_hp"
            target_id = d["p1_id"]
        else:
            raise ValueError("你不在這場對戰中。")
        new_hp = max(0, (d[target_hp] or 0) - damage)
        # 記錄攻擊動作（前端用來渲染）
        aid = _nid("atk")
        if db.is_postgres():
            conn.execute(
                f"INSERT INTO space_battle_actions (id, battle_id, attacker_id, target_id, damage, created_at) VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, NOW())",
                (aid, battle_id, user_id, target_id, damage))
        else:
            conn.execute(
                f"INSERT INTO space_battle_actions (id, battle_id, attacker_id, target_id, damage) VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
                (aid, battle_id, user_id, target_id, damage))
        status = "finished" if new_hp <= 0 else "active"
        winner = user_id if new_hp <= 0 else None
        conn.execute(
            f"UPDATE space_battles SET {target_hp} = {ph}, status = {ph}, winner_id = {ph} WHERE id = {ph}",
            (new_hp, status, winner, battle_id))
        conn.commit()
    return {"ok": True, "damage": damage, "target_hp": new_hp,
            "finished": new_hp <= 0, "winner_id": winner}


def get_battle(battle_id: str) -> dict:
    """取得對戰狀態（座標、HP、最近動作）。前端用這些本地渲染。"""
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        row = conn.execute(
            f"""SELECT b.*, u1.name as p1_name, u2.name as p2_name
                FROM space_battles b
                JOIN users u1 ON u1.id = b.p1_id
                JOIN users u2 ON u2.id = b.p2_id
                WHERE b.id = {ph}""", (battle_id,)).fetchone()
        if not row:
            raise KeyError("找不到這場對戰。")
        d = dict(row)
        # 最近 10 個動作
        actions = conn.execute(
            f"""SELECT a.*, u.name as attacker_name FROM space_battle_actions a
                JOIN users u ON u.id = a.attacker_id
                WHERE a.battle_id = {ph} ORDER BY a.created_at DESC LIMIT 10""",
            (battle_id,)).fetchall()
    return {
        "ok": True,
        "battle": {
            "id": d["id"],
            "p1": {"id": d["p1_id"], "name": d["p1_name"], "hp": d["p1_hp"]},
            "p2": {"id": d["p2_id"], "name": d["p2_name"], "hp": d["p2_hp"]},
            "status": d["status"],
            "winner_id": d.get("winner_id"),
        },
        "recent_actions": [dict(a) for a in actions],
    }


def list_my_battles(user_id: str) -> list[dict]:
    """我的對戰列表（等待中的挑戰）。"""
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        rows = conn.execute(
            f"""SELECT b.id, b.status, b.created_at, u.name as opponent_name,
                       CASE WHEN b.p1_id = {ph} THEN 'challenger' ELSE 'challenged' END as role
                FROM space_battles b
                JOIN users u ON u.id = CASE WHEN b.p1_id = {ph} THEN b.p2_id ELSE b.p1_id END
                WHERE (b.p1_id = {ph} OR b.p2_id = {ph}) AND b.status IN ('waiting', 'active')
                ORDER BY b.created_at DESC LIMIT 10""",
            (user_id, user_id, user_id, user_id)).fetchall()
        return [dict(r) for r in rows]
