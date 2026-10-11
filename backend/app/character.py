"""
角色系統：像 PaGamO 一樣，6 種角色各有不同能力加成。
選擇角色是策略，不只是外觀。
"""
from __future__ import annotations

from app import db

# 6 種角色：名稱、描述、能力加成
CHARACTERS = {
    "scholar": {
        "name": "博學者",
        "desc": "知識就是力量。學習時獲得更多經驗。",
        "img": "char-scholar.webp",
        "bonuses": {
            "exp_gain": 1.2,      # 經驗 +20%
            "review_interval": 1.1,  # 複習間隔 +10%
        },
        "color": "#4A90D9",
    },
    "warrior": {
        "name": "戰士",
        "desc": "無畏的挑戰者。對決時攻擊力提升。",
        "img": "char-warrior.webp",
        "bonuses": {
            "duel_attack": 1.2,   # 對決攻擊 +20%
            "weapon_dmg": 1.1,    # 武器傷害 +10%
        },
        "color": "#E74C3C",
    },
    "explorer": {
        "name": "探索家",
        "desc": "好奇心驅動。圖書館探索進度更快。",
        "img": "char-explorer.webp",
        "bonuses": {
            "explore_gain": 1.2,  # 探索度 +20%
            "page_progress": 1.1,  # 每頁進度 +10%
        },
        "color": "#27AE60",
    },
    "diplomat": {
        "name": "外交家",
        "desc": "人脈就是資源。交易和社交收益提升。",
        "img": "char-diplomat.webp",
        "bonuses": {
            "trade_bonus": 1.15,  # 交易收益 +15%
            "social_exp": 1.2,    # 社交經驗 +20%
        },
        "color": "#9B59B6",
    },
    "craftsman": {
        "name": "工匠",
        "desc": "巧手打造。武器鍛造和升級更強。",
        "img": "char-craftsman.webp",
        "bonuses": {
            "craft_quality": 1.2,  # 鍛造品質 +20%
            "upgrade_cost": 0.9,   # 升級費用 -10%
        },
        "color": "#F39C12",
    },
    "sage": {
        "name": "智者",
        "desc": "深思熟慮。費曼說服更容易達標。",
        "img": "char-sage.webp",
        "bonuses": {
            "feynman_score": 1.15,  # 費曼評分 +15%
            "question_quality": 1.2,  # 提問品質 +20%
        },
        "color": "#1ABC9C",
    },
}


def get_characters() -> dict:
    """回傳所有角色。"""
    return CHARACTERS


def get_user_character(user_id: str) -> dict | None:
    """取得用戶當前角色。"""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT character_id FROM users WHERE id = ?" if not db.is_postgres()
            else "SELECT character_id FROM users WHERE id = %s",
            (user_id,)).fetchone()
        if not row:
            return None
        char_id = row["character_id"] if isinstance(row, dict) else row[0]
        if not char_id or char_id not in CHARACTERS:
            return None
        return {"id": char_id, **CHARACTERS[char_id]}


def set_user_character(user_id: str, character_id: str) -> dict:
    """設定用戶角色。"""
    if character_id not in CHARACTERS:
        raise ValueError(f"未知的角色「{character_id}」。")
    with db.get_conn() as conn:
        # 確保欄位存在
        try:
            ph = "%s" if db.is_postgres() else "?"
            conn.execute(
                f"UPDATE users SET character_id = {ph} WHERE id = {ph}",
                (character_id, user_id))
            conn.commit()
        except Exception:
            # 欄位不存在，先加
            if db.is_postgres():
                conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS character_id TEXT DEFAULT ''")
            else:
                try:
                    conn.execute("ALTER TABLE users ADD COLUMN character_id TEXT DEFAULT ''")
                except Exception:
                    pass
            ph = "%s" if db.is_postgres() else "?"
            conn.execute(
                f"UPDATE users SET character_id = {ph} WHERE id = {ph}",
                (character_id, user_id))
            conn.commit()
    return {"ok": True, "character": {"id": character_id, **CHARACTERS[character_id]}}


def get_bonus(user_id: str, bonus_key: str, default: float = 1.0) -> float:
    """取得用戶角色的某項加成。"""
    char = get_user_character(user_id)
    if not char:
        return default
    return char.get("bonuses", {}).get(bonus_key, default)
