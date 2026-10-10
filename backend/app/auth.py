"""帳號系統：註冊／登入／登出／權杖驗證。

設計取捨（MVP 級）：
- 密碼：標準庫 pbkdf2_hmac（sha256、210k 次、16 位元組鹽），零新依賴。
- 權杖：stateful token —— secrets.token_urlsafe(32)，只存 sha256 存進
  users.token_hash。登入時輪換、登出時清空。無需 SECRET_KEY。
- 暱稱唯一：應用層檢查（SQLite 舊表無法輕易加 UNIQUE，以程式保證）。
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid

from app import db

_ITERATIONS = 210_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, _token_hash(token)


def _validate_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise ValueError("請輸入暱稱。")
    if len(name) > 20:
        raise ValueError("暱稱太長了，請在 20 字以內。")
    return name


def _validate_password(password: str) -> str:
    password = password or ""
    if len(password) < 4:
        raise ValueError("密碼至少需要 4 個字元。")
    if len(password) > 128:
        raise ValueError("密碼太長了。")
    return password


def register(name: str, password: str, email: str = "") -> dict:
    """註冊新帳號（Email 選填）。成功回傳 {id, name, email, token}；失敗拋 ValueError。"""
    name = _validate_name(name)
    password = _validate_password(password)
    email = _validate_email(email)
    with db.get_conn() as conn:
        exists = conn.execute("SELECT id FROM users WHERE name = ?", (name,)).fetchone()
        if exists:
            raise ValueError(f"暱稱「{name}」已經被使用了，換一個吧。")
        if _email_taken(conn, email):
            raise ValueError("這個 Email 已經註冊過了。")
        user_id = "u_" + uuid.uuid4().hex[:12]
        token, thash = _new_token()
        conn.execute(
            "INSERT INTO users (id, name, pw_hash, token_hash, email) VALUES (?, ?, ?, ?, ?)",
            (user_id, name, hash_password(password), thash, email),
        )
        conn.commit()
    return {"id": user_id, "name": name, "email": email, "token": token}


def login(name: str, password: str) -> dict:
    """登入。成功回傳 {id, name, token}（權杖輪換）；失敗拋 ValueError。"""
    name = _validate_name(name)
    password = _validate_password(password)
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, pw_hash FROM users WHERE name = ?", (name,)
        ).fetchone()
        if not row or not verify_password(password, row["pw_hash"] or ""):
            raise ValueError("暱稱或密碼錯誤。")
        token, thash = _new_token()
        conn.execute(
            "UPDATE users SET token_hash = ? WHERE id = ?", (thash, row["id"])
        )
    return {"id": row["id"], "name": row["name"], "token": token}


def logout(token: str) -> bool:
    """登出：清空權杖。回傳是否有對應帳號。"""
    if not token:
        return False
    with db.get_conn() as conn:
        cur = conn.execute(
            "UPDATE users SET token_hash = '' WHERE token_hash = ?",
            (_token_hash(token),),
        )
        # sqlite3 cursor 有 rowcount；psycopg 的 execute 回傳 cursor 也有 rowcount
        try:
            return cur.rowcount > 0
        except Exception:
            return True


def get_user_by_token(token: str) -> dict | None:
    """由 Bearer 權杖取使用者。無效回傳 None。"""
    if not token:
        return None
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, email, persona, created_at FROM users "
            "WHERE token_hash = ? AND token_hash != ''",
            (_token_hash(token),),
        ).fetchone()
        if not row:
            return None
        return {"id": row["id"], "name": row["name"], "email": row["email"] or "",
                "persona": db.jloads(row["persona"], {}),
                "created_at": row["created_at"] or ""}


def set_persona(user_id: str, persona: dict) -> dict:
    """儲存引路儀式測得的人格（JSON）。回傳解析後的 persona。"""
    import json

    if not isinstance(persona, dict):
        raise ValueError("persona 須為 JSON 物件。")
    # 只保留已知欄位，避免亂塞
    clean = {
        "role": str(persona.get("role", ""))[:32],
        "role_name": str(persona.get("role_name", ""))[:32],
        "axes": persona.get("axes") if isinstance(persona.get("axes"), dict) else {},
        "choices": persona.get("choices") if isinstance(persona.get("choices"), list) else [],
        "at": str(persona.get("at", ""))[:32],
    }
    if not clean["role"]:
        raise ValueError("persona 缺少 role。")
    with db.get_conn() as conn:
        cur = conn.execute(
            "UPDATE users SET persona = ? WHERE id = ?",
            (json.dumps(clean, ensure_ascii=False), user_id),
        )
        conn.commit()
        try:
            updated = cur.rowcount > 0
        except Exception:
            updated = True
        if not updated:
            raise KeyError("user not found")
    return clean


_EMAIL_RE = None

def _email_re():
    global _EMAIL_RE
    if _EMAIL_RE is None:
        import re
        _EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
    return _EMAIL_RE


def _validate_email(email: str) -> str:
    """Email 為選填；有填則檢查格式。回傳整理後的字串（空字串表示未填）。"""
    email = (email or "").strip().lower()
    if not email:
        return ""
    if len(email) > 120 or not _email_re().match(email):
        raise ValueError("Email 格式不正確。")
    return email


def _email_taken(conn, email: str, exclude_id: str = "") -> bool:
    if not email:
        return False
    row = conn.execute(
        "SELECT id FROM users WHERE email = ? AND id != ?", (email, exclude_id)
    ).fetchone()
    return row is not None


def set_email(user_id: str, email: str) -> str:
    """更新 Email（可清空）。回傳整理後的 email。"""
    email = _validate_email(email)
    with db.get_conn() as conn:
        if _email_taken(conn, email, exclude_id=user_id):
            raise ValueError("這個 Email 已經註冊過了。")
        cur = conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, user_id))
        conn.commit()
        try:
            ok = cur.rowcount > 0
        except Exception:
            ok = True
        if not ok:
            raise KeyError("user not found")
    return email


def change_password(user_id: str, old_password: str, new_password: str) -> None:
    """登入中改密碼：需驗證舊密碼。"""
    new_password = _validate_password(new_password)
    with db.get_conn() as conn:
        row = conn.execute("SELECT pw_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise KeyError("user not found")
        if not verify_password(old_password or "", row["pw_hash"] or ""):
            raise ValueError("舊密碼不正確。")
        conn.execute(
            "UPDATE users SET pw_hash = ?, token_hash = '' WHERE id = ?",
            (hash_password(new_password), user_id),
        )
        conn.commit()


def reset_password_by_email(name: str, email: str, new_password: str) -> None:
    """忘記密碼：暱稱＋註冊 Email 吻合即重設。

    說明：本站無郵件發送服務，故採「知識驗證」而非重設連結。
    請勿將 Email 告訴他人；重要帳號請設高強度密碼。
    """
    name = _validate_name(name)
    email = _validate_email(email)
    if not email:
        raise ValueError("請輸入註冊時填寫的 Email。")
    new_password = _validate_password(new_password)
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE name = ? AND email = ?", (name, email)
        ).fetchone()
        if not row:
            raise ValueError("暱稱與 Email 不符。請確認後再試一次。")
        conn.execute(
            "UPDATE users SET pw_hash = ?, token_hash = '' WHERE id = ?",
            (hash_password(new_password), row["id"]),
        )
        conn.commit()


def delete_user(user_id: str, password: str) -> None:
    """刪除帳號：驗證密碼後，刪除該使用者所有資料（不可復原）。"""
    with db.get_conn() as conn:
        row = conn.execute("SELECT pw_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise KeyError("user not found")
        if not verify_password(password or "", row["pw_hash"] or ""):
            raise ValueError("密碼不正確，無法刪除帳號。")
        for table in ("favorites", "territory_logs", "learning_events", "flow_deposits",
                      "duel_answers", "duel_questions", "duel_sessions", "islands"):
            try:
                conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
            except Exception:
                pass
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()


def export_user_data(user_id: str) -> dict:
    """匯出學習歷程：個人檔案＋島嶼＋日誌＋收藏＋星砂＋人格。"""
    with db.get_conn() as conn:
        user = conn.execute(
            "SELECT id, name, email, persona, points, inventory, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not user:
            raise KeyError("user not found")
        island = conn.execute("SELECT * FROM islands WHERE user_id = ?", (user_id,)).fetchone()
        logs = conn.execute(
            "SELECT action, delta, territory_after, log_date, created_at FROM territory_logs "
            "WHERE user_id = ? ORDER BY created_at", (user_id,)
        ).fetchall()
        favs = conn.execute(
            "SELECT content_id, created_at FROM favorites WHERE user_id = ? ORDER BY created_at",
            (user_id,),
        ).fetchall()
    return {
        "exported_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "user": {
            "id": user["id"], "name": user["name"], "email": user["email"] or "",
            "persona": db.jloads(user["persona"], {}),
            "points": user["points"] or 0,
            "inventory": db.jloads(user["inventory"], {}),
            "created_at": user["created_at"],
        },
        "island": dict(island) if island else None,
        "territory_logs": [dict(r) for r in logs],
        "favorites": [dict(r) for r in favs],
    }
