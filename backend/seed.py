"""種子腳本：清空並重建標籤字典與 30 筆內容。可重複執行。

雙模式：SQLite（本機）或 Postgres（DATABASE_URL 以 postgres 開頭，如 Neon）。
Postgres 模式用 TRUNCATE ... RESTART IDENTITY CASCADE 一次清空並重置序列。
"""
from __future__ import annotations

from app import db
from app.seed_data import CONTENTS, DIMENSIONS, TAGS

_SEED_TABLES = (
    "duel_answers", "duel_questions", "duel_sessions",
    "territory_logs", "flow_deposits", "learning_events",
    "content_tags", "content_items", "tags", "tag_dimensions",
    "islands", "users",
)


def run_seed() -> dict:
    db.init_db()
    with db.get_conn() as conn:
        # 先清後種
        if db.is_postgres():
            conn.execute(
                f"TRUNCATE {', '.join(_SEED_TABLES)} RESTART IDENTITY CASCADE"
            )
        else:
            for table in _SEED_TABLES:  # 注意外鍵順序
                conn.execute(f"DELETE FROM {table}")
            conn.execute("DELETE FROM sqlite_sequence")

        conn.executemany(
            "INSERT INTO tag_dimensions (code, name) VALUES (?, ?)", DIMENSIONS
        )

        tag_id_map: dict[tuple[str, str], int] = {}
        for dim, name, aliases in TAGS:
            tid = db.insert_id(
                conn,
                "INSERT INTO tags (dimension_code, name, alias) VALUES (?, ?, ?)",
                (dim, name, ",".join(aliases)),
            )
            tag_id_map[(dim, name)] = tid

        for title, summary, source_type, duration, url, tag_pairs in CONTENTS:
            cid = db.insert_id(
                conn,
                """INSERT INTO content_items (title, summary, source_type, duration_min, url)
                   VALUES (?, ?, ?, ?, ?)""",
                (title, summary, source_type, duration, url),
            )
            for dim, name in tag_pairs:
                tid = tag_id_map.get((dim, name))
                if tid is None:
                    raise ValueError(f"標籤不存在：{dim}:{name}（內容：{title}）")
                if db.is_postgres():
                    conn.execute(
                        """INSERT INTO content_tags (content_id, tag_id) VALUES (?, ?)
                           ON CONFLICT DO NOTHING""",
                        (cid, tid),
                    )
                else:
                    conn.execute(
                        "INSERT OR IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)",
                        (cid, tid),
                    )

        n_contents = conn.execute("SELECT COUNT(*) AS n FROM content_items").fetchone()["n"]
        n_tags = conn.execute("SELECT COUNT(*) AS n FROM tags").fetchone()["n"]
        n_dims = conn.execute("SELECT COUNT(*) AS n FROM tag_dimensions").fetchone()["n"]
    return {"dimensions": n_dims, "tags": n_tags, "contents": n_contents}


if __name__ == "__main__":
    result = run_seed()
    print(f"種子完成：{result['dimensions']} 維度、{result['tags']} 標籤、{result['contents']} 筆內容")
