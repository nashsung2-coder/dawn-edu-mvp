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


def register(name: str, password: str) -> dict:
    """註冊新帳號。成功回傳 {id, name, token}；失敗拋 ValueError（繁中訊息）。"""
    name = _validate_name(name)
    password = _validate_password(password)
    with db.get_conn() as conn:
        exists = conn.execute("SELECT id FROM users WHERE name = ?", (name,)).fetchone()
        if exists:
            raise ValueError(f"暱稱「{name}」已經被使用了，換一個吧。")
        user_id = "u_" + uuid.uuid4().hex[:12]
        token, thash = _new_token()
        conn.execute(
            "INSERT INTO users (id, name, pw_hash, token_hash) VALUES (?, ?, ?, ?)",
            (user_id, name, hash_password(password), thash),
        )
    return {"id": user_id, "name": name, "token": token}


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
            "SELECT id, name FROM users WHERE token_hash = ? AND token_hash != ''",
            (_token_hash(token),),
        ).fetchone()
        if not row:
            return None
        return {"id": row["id"], "name": row["name"]}
