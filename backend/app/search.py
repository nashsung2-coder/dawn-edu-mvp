"""交集搜尋：標籤解析（含別名擴展）、三種模式、排除、可解釋文案。"""
from __future__ import annotations

from app import db


def parse_tag_token(token: str) -> tuple[str, str] | None:
    """解析 'DIM:名稱'；名稱可用別名。回傳 (dim_code, tag_id 查到的標準名稱) 的解析資訊。"""
    token = token.strip()
    if ":" not in token:
        return None
    dim, name = token.split(":", 1)
    return dim.strip().upper(), name.strip()


def resolve_tag(dim: str, name: str, conn) -> dict | None:
    """依維度代碼＋名稱或別名找到標籤。找不到回傳 None。"""
    row = conn.execute(
        "SELECT id, dimension_code, name, alias FROM tags WHERE dimension_code = ? AND name = ?",
        (dim, name),
    ).fetchone()
    if row:
        return dict(row)
    # 別名擴展：alias 欄位以逗號分隔
    for row in conn.execute(
        "SELECT id, dimension_code, name, alias FROM tags WHERE dimension_code = ?", (dim,)
    ).fetchall():
        aliases = [a.strip() for a in (row["alias"] or "").split(",") if a.strip()]
        if name in aliases:
            return dict(row)
    return None


def _content_tags_map(conn) -> dict[int, list[dict]]:
    rows = conn.execute(
        """SELECT ct.content_id, t.id AS tag_id, t.dimension_code, t.name
           FROM content_tags ct JOIN tags t ON t.id = ct.tag_id"""
    ).fetchall()
    m: dict[int, list[dict]] = {}
    for r in rows:
        m.setdefault(r["content_id"], []).append(
            {"id": r["tag_id"], "dim": r["dimension_code"], "name": r["name"]}
        )
    return m


def _contents_index(conn) -> dict[int, dict]:
    rows = conn.execute("SELECT * FROM content_items ORDER BY id").fetchall()
    return {r["id"]: dict(r) for r in rows}


def intersection_search(tags_param: str, mode: str = "weighted", exclude_param: str = "") -> dict:
    mode = (mode or "weighted").lower()
    if mode not in ("strict", "weighted", "fuzzy"):
        return {"error": f"不支援的搜尋模式「{mode}」，請用 strict、weighted 或 fuzzy。", "results": []}

    with db.get_conn() as conn:
        wanted: list[dict] = []
        unknown: list[str] = []
        for token in (tags_param or "").split(","):
            parsed = parse_tag_token(token)
            if not parsed:
                continue
            dim, name = parsed
            tag = resolve_tag(dim, name, conn)
            if tag:
                wanted.append(tag)
            else:
                unknown.append(token.strip())

        excluded_ids: set[int] = set()
        for token in (exclude_param or "").split(","):
            parsed = parse_tag_token(token)
            if not parsed:
                continue
            dim, name = parsed
            tag = resolve_tag(dim, name, conn)
            if tag:
                rows = conn.execute(
                    "SELECT content_id FROM content_tags WHERE tag_id = ?", (tag["id"],)
                ).fetchall()
                excluded_ids.update(r["content_id"] for r in rows)

        if not wanted:
            return {
                "mode": mode,
                "wanted": [],
                "unknown_tags": unknown,
                "results": [],
                "message": "沒有可識別的標籤，請檢查標籤格式（例如 SUBJ:物理）。",
            }

        cmap = _content_tags_map(conn)
        cindex = _contents_index(conn)
        wanted_ids = {t["id"] for t in wanted}
        results = []

        for cid, item in cindex.items():
            if cid in excluded_ids:
                continue
            ctags = cmap.get(cid, [])
            ctag_ids = {t["id"] for t in ctags}
            matched = [t for t in wanted if t["id"] in ctag_ids]
            n_matched = len(matched)
            if n_matched == 0:
                continue
            if mode == "strict" and n_matched < len(wanted):
                continue
            score = round(n_matched / len(wanted), 3)
            matched_names = [t["name"] for t in matched]
            if mode == "strict":
                reason = f"完全命中 {len(wanted)} 個標籤：{'、'.join(matched_names)}"
            elif n_matched == len(wanted):
                reason = f"命中全部 {len(wanted)} 個標籤：{'、'.join(matched_names)}"
            else:
                missing = [t["name"] for t in wanted if t["id"] not in ctag_ids]
                reason = (
                    f"命中 {n_matched} 個標籤：{'、'.join(matched_names)}"
                    f"（未命中：{'、'.join(missing)}，匹配度 {int(score*100)}%）"
                )
            results.append(
                {
                    "id": cid,
                    "title": item["title"],
                    "summary": item["summary"],
                    "source_type": item["source_type"],
                    "duration_min": item["duration_min"],
                    "url": item["url"],
                    "matched_tags": [f"{t['dimension_code']}:{t['name']}" for t in matched],
                    "match_score": score,
                    "reason": reason,
                }
            )

        # weighted：命中越多排越前；fuzzy：依匹配度；strict：依 id
        if mode in ("weighted", "fuzzy"):
            results.sort(key=lambda r: (-r["match_score"], r["id"]))

        return {
            "mode": mode,
            "wanted": [f"{t['dimension_code']}:{t['name']}" for t in wanted],
            "unknown_tags": unknown,
            "excluded": exclude_param,
            "results": results,
        }
