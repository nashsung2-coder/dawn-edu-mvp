"""資料庫層：SQLite（本機開發／測試）與 Postgres（Neon 雲端）雙模式。

模式判斷：環境變數 DATABASE_URL 以 "postgres" 開頭（含 postgres:// 與 postgresql://）
→ Postgres（psycopg3）；否則 → SQLite（標準庫 sqlite3，路徑由 DAWN_DB 或預設檔案決定）。

全專案 SQL 撰寫規範（雙模式相容）：
- 佔位符一律寫 `?`；Postgres 模式在執行前自動轉成 `%s`
 （專案內 SQL 字面量不得出現 `?`，僅佔位符可用）。
- 取新建列 id 一律用 db.insert_id(conn, sql, params)（Postgres 內部用 RETURNING id）。
- 「現在時間」運算式用 db.now_expr()；「今天」用 db.today_expr()；
  「某日期欄位＝今天」用 db.date_col_eq_today(col)。
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

_QMARK = re.compile(r"\?")


def database_url() -> str:
    return os.environ.get("DATABASE_URL", "").strip()


def is_postgres() -> bool:
    return database_url().startswith("postgres")


def _to_pg(sql: str) -> str:
    return _QMARK.sub("%s", sql)


def now_expr() -> str:
    """SQL「現在時間」運算式（依模式）。"""
    return "NOW()" if is_postgres() else "datetime('now')"


def today_expr() -> str:
    """SQL「今天日期」運算式（依模式）。"""
    return "CURRENT_DATE" if is_postgres() else "date('now')"


def date_col_eq_today(col: str) -> str:
    """SQL「日期欄位＝今天」條件（依模式）。"""
    if is_postgres():
        return f"{col}::date = CURRENT_DATE"
    return f"date({col}) = date('now')"


class Conn:
    """薄包裝：統一佔位符、dict row、context manager 語意。

    - execute(sql, params) 回傳 cursor，可直接 .fetchone()/.fetchall()，
      row 皆為 dict-like（sqlite3.Row 或 psycopg dict_row）。
    - with 語句：無例外 → commit；有例外 → rollback（兩種驅動一致）。
    """

    def __init__(self, raw, pg: bool):
        self._raw = raw
        self._pg = pg

    def execute(self, sql: str, params=()):
        if self._pg:
            sql = _to_pg(sql)
        return self._raw.execute(sql, params)

    def executemany(self, sql: str, seq):
        if self._pg:
            sql = _to_pg(sql)
            with self._raw.cursor() as cur:  # psycopg3 只有 cursor 有 executemany
                return cur.executemany(sql, seq)
        return self._raw.executemany(sql, seq)

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def __enter__(self) -> "Conn":
        return self

    def __exit__(self, exc_type, exc, tb):
        # 與 sqlite3 一致：乾淨離開 → commit；例外 → rollback
        if exc_type is None:
            self._raw.commit()
        else:
            self._raw.rollback()
        return False


def _db_path() -> Path:
    # 每次連線時讀取，方便測試用 DAWN_DB 指向隔離資料庫
    return Path(os.environ.get("DAWN_DB", BASE_DIR / "data" / "dawn.db"))


def get_conn() -> Conn:
    if is_postgres():
        from psycopg import connect as pg_connect
        from psycopg.rows import dict_row

        raw = pg_connect(database_url(), row_factory=dict_row)
        return Conn(raw, True)
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(path)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys = ON")
    return Conn(raw, False)


def insert_id(conn: Conn, sql: str, params=()) -> int:
    """執行 INSERT 並回傳新建列的 id（雙模式相容）。"""
    if is_postgres():
        cur = conn.execute(sql + " RETURNING id", params)
        return cur.fetchone()["id"]
    cur = conn.execute(sql, params)
    return cur.lastrowid


# ---------------- Schema（雙版本） ----------------
# SQLite 版：沿用原本定義；Postgres 版：SERIAL 主鍵、TIMESTAMPTZ＋NOW()。

SCHEMA_SQLITE = """
CREATE TABLE IF NOT EXISTS tag_dimensions (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dimension_code TEXT NOT NULL REFERENCES tag_dimensions(code),
    name TEXT NOT NULL,
    alias TEXT NOT NULL DEFAULT '',
    UNIQUE (dimension_code, name)
);

CREATE TABLE IF NOT EXISTS content_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_type TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 0,
    url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_tags (
    content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (content_id, tag_id)
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    persona TEXT NOT NULL DEFAULT '',
    pw_hash TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL DEFAULT '',
    points INTEGER NOT NULL DEFAULT 0,
    inventory TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS islands (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '初生之島',
    territory REAL NOT NULL DEFAULT 1.0,
    occupied_tags TEXT NOT NULL DEFAULT '[]',
    resources TEXT NOT NULL DEFAULT '{}',
    badges TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS territory_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    delta REAL NOT NULL,
    territory_after REAL NOT NULL,
    log_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    content_id INTEGER,
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flow_deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    content_id INTEGER,
    resource_type TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    dwell_ms INTEGER NOT NULL DEFAULT 0,
    focus_score REAL,
    emotion TEXT NOT NULL DEFAULT '',
    flow_state TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    context_stage TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS duel_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenger_id TEXT NOT NULL,
    opponent_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL REFERENCES tags(id),
    status TEXT NOT NULL DEFAULT 'pending',
    winner_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS duel_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duel_id INTEGER NOT NULL REFERENCES duel_sessions(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    question TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '[]',
    answer_index INTEGER NOT NULL DEFAULT 0,
    concept_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS duel_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duel_id INTEGER NOT NULL REFERENCES duel_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    round INTEGER NOT NULL,
    choice_index INTEGER NOT NULL,
    correct INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

SCHEMA_PG = """
CREATE TABLE IF NOT EXISTS tag_dimensions (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    dimension_code TEXT NOT NULL REFERENCES tag_dimensions(code),
    name TEXT NOT NULL,
    alias TEXT NOT NULL DEFAULT '',
    UNIQUE (dimension_code, name)
);

CREATE TABLE IF NOT EXISTS content_items (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    source_type TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 0,
    url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_tags (
    content_id INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (content_id, tag_id)
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    persona TEXT NOT NULL DEFAULT '',
    pw_hash TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL DEFAULT '',
    points INTEGER NOT NULL DEFAULT 0,
    inventory TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS islands (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '初生之島',
    territory REAL NOT NULL DEFAULT 1.0,
    occupied_tags TEXT NOT NULL DEFAULT '[]',
    resources TEXT NOT NULL DEFAULT '{}',
    badges TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS territory_logs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    delta REAL NOT NULL,
    territory_after REAL NOT NULL,
    log_date TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learning_events (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    content_id INTEGER,
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flow_deposits (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    content_id INTEGER,
    resource_type TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    dwell_ms INTEGER NOT NULL DEFAULT 0,
    focus_score REAL,
    emotion TEXT NOT NULL DEFAULT '',
    flow_state TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    context_stage TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS duel_sessions (
    id SERIAL PRIMARY KEY,
    challenger_id TEXT NOT NULL,
    opponent_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL REFERENCES tags(id),
    status TEXT NOT NULL DEFAULT 'pending',
    winner_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS duel_questions (
    id SERIAL PRIMARY KEY,
    duel_id INTEGER NOT NULL REFERENCES duel_sessions(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    question TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '[]',
    answer_index INTEGER NOT NULL DEFAULT 0,
    concept_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS duel_answers (
    id SERIAL PRIMARY KEY,
    duel_id INTEGER NOT NULL REFERENCES duel_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    round INTEGER NOT NULL,
    choice_index INTEGER NOT NULL,
    correct INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


def init_db() -> None:
    schema = SCHEMA_PG if is_postgres() else SCHEMA_SQLITE
    statements = [s.strip() for s in schema.split(";") if s.strip()]
    with get_conn() as conn:
        for stmt in statements:
            conn.execute(stmt)
    _migrate_users_auth_columns()
    _migrate_users_game_columns()


def _migrate_users_auth_columns() -> None:
    """為已存在的 users 表補上帳號系統欄位（冪等，雙模式相容）。"""
    cols = (("pw_hash", "TEXT NOT NULL DEFAULT ''"),
            ("token_hash", "TEXT NOT NULL DEFAULT ''"))
    with get_conn() as conn:
        if is_postgres():
            for name, ddl in cols:
                conn.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} {ddl}")
        else:
            existing = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
            for name, ddl in cols:
                if name not in existing:
                    conn.execute(f"ALTER TABLE users ADD COLUMN {name} {ddl}")


def _migrate_users_game_columns() -> None:
    """為已存在的 users 表補上星砂經濟欄位（冪等，雙模式相容）。"""
    cols = (("points", "INTEGER NOT NULL DEFAULT 0"),
            ("inventory", "TEXT NOT NULL DEFAULT '{}'"))
    with get_conn() as conn:
        if is_postgres():
            for name, ddl in cols:
                conn.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} {ddl}")
        else:
            existing = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
            for name, ddl in cols:
                if name not in existing:
                    conn.execute(f"ALTER TABLE users ADD COLUMN {name} {ddl}")


def table_empty(table: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()
        return row["n"] == 0


def jloads(s: str, default):
    try:
        return json.loads(s) if s else default
    except Exception:
        return default
