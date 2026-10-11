"""知識庫（貢獻/圖書館）系統 MVP。

設計：
- kb_libraries：庫（標題、簡介、公開/私人、擁有者）
- kb_pages：頁面（標題、Markdown 內容、排序）
- 探索：列出公開庫
- 興趣星辰：依用戶學習歷史（掌握度主題）推薦
- 費曼調用：從庫頁面一鍵開戰役
"""
from __future__ import annotations

import json
import uuid

from app import db


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _nid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ---------------- 建庫 ----------------

def create_library(user_id: str, title: str, description: str = "",
                   visibility: str = "public", tags: list = None) -> dict:
    """建立知識庫。visibility: public/private。"""
    if not title or not title.strip():
        raise ValueError("庫名不能為空。")
    if visibility not in ("public", "private"):
        raise ValueError("visibility 只能是 public 或 private。")
    lib_id = _nid("kblib")
    tags_json = json.dumps(tags or [], ensure_ascii=False)
    with db.get_conn() as conn:
        if db.is_postgres():
            conn.execute(
                """INSERT INTO kb_libraries
                   (id, owner_id, title, description, visibility, tags, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())""",
                (lib_id, user_id, title.strip(), description.strip(),
                 visibility, tags_json))
        else:
            conn.execute(
                """INSERT INTO kb_libraries
                   (id, owner_id, title, description, visibility, tags, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))""",
                (lib_id, user_id, title.strip(), description.strip(),
                 visibility, tags_json))
        conn.commit()
    return get_library(lib_id, user_id)


def get_library(lib_id: str, viewer_id: str = None) -> dict | None:
    """取得庫詳情（含頁面）。私人庫僅擁有者可見。"""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM kb_libraries WHERE id = ?" if not db.is_postgres()
            else "SELECT * FROM kb_libraries WHERE id = %s",
            (lib_id,)).fetchone()
        if not row:
            return None
        lib = dict(row)
        # 權限檢查
        if lib["visibility"] == "private" and lib["owner_id"] != viewer_id:
            return None
        # 頁面
        pages = conn.execute(
            "SELECT * FROM kb_pages WHERE library_id = ? ORDER BY sort_order, created_at"
            if not db.is_postgres()
            else "SELECT * FROM kb_pages WHERE library_id = %s ORDER BY sort_order, created_at",
            (lib_id,)).fetchall()
        lib["pages"] = [dict(p) for p in pages]
        lib["tags"] = db.jloads(lib.get("tags", "[]"), [])
        lib["page_count"] = len(lib["pages"])
        lib["is_owner"] = (lib["owner_id"] == viewer_id)
    return lib


def list_libraries(viewer_id: str = None, limit: int = 50,
                   search: str = "", tag: str = "") -> list[dict]:
    """探索：列出公開庫（＋自己的私人庫）。"""
    with db.get_conn() as conn:
        q = """SELECT l.*, u.name as owner_name,
                      (SELECT COUNT(*) FROM kb_pages WHERE library_id = l.id) as page_count
               FROM kb_libraries l
               LEFT JOIN users u ON u.id = l.owner_id
               WHERE (l.visibility = 'public'"""
        params = []
        if viewer_id:
            q += " OR l.owner_id = ?" if not db.is_postgres() else " OR l.owner_id = %s"
            params.append(viewer_id)
        q += ")"
        if search:
            q += " AND (l.title LIKE ? OR l.description LIKE ?)" if not db.is_postgres() \
                else " AND (l.title LIKE %s OR l.description LIKE %s)"
            params.extend([f"%{search}%", f"%{search}%"])
        q += " ORDER BY l.updated_at DESC LIMIT ?" if not db.is_postgres() \
            else " ORDER BY l.updated_at DESC LIMIT %s"
        params.append(limit)
        rows = conn.execute(q, params).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["tags"] = db.jloads(d.get("tags", "[]"), [])
            if tag and tag not in d["tags"]:
                continue
            out.append(d)
    return out


def update_library(user_id: str, lib_id: str, title: str = None,
                   description: str = None, visibility: str = None,
                   tags: list = None) -> dict:
    """更新庫（僅擁有者）。"""
    lib = get_library(lib_id, user_id)
    if not lib:
        raise KeyError("找不到這個庫。")
    if not lib["is_owner"]:
        raise PermissionError("只有擁有者可以編輯。")
    sets, params = [], []
    ph = "%s" if db.is_postgres() else "?"
    if title is not None:
        sets.append(f"title = {ph}"); params.append(title.strip())
    if description is not None:
        sets.append(f"description = {ph}"); params.append(description.strip())
    if visibility in ("public", "private"):
        sets.append(f"visibility = {ph}"); params.append(visibility)
    if tags is not None:
        sets.append(f"tags = {ph}"); params.append(json.dumps(tags, ensure_ascii=False))
    if not sets:
        return lib
    ts = "NOW()" if db.is_postgres() else "datetime('now')"
    sets.append(f"updated_at = {ts}")
    params.append(lib_id)
    with db.get_conn() as conn:
        conn.execute(f"UPDATE kb_libraries SET {', '.join(sets)} WHERE id = {ph}",
                     params)
        conn.commit()
    return get_library(lib_id, user_id)


def delete_library(user_id: str, lib_id: str) -> bool:
    """刪除庫（僅擁有者，連同頁面）。"""
    lib = get_library(lib_id, user_id)
    if not lib or not lib["is_owner"]:
        raise PermissionError("只有擁有者可以刪除。")
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        conn.execute(f"DELETE FROM kb_pages WHERE library_id = {ph}", (lib_id,))
        conn.execute(f"DELETE FROM kb_libraries WHERE id = {ph}", (lib_id,))
        conn.commit()
    return True


# ---------------- 頁面（Google Sites 式） ----------------

def add_page(user_id: str, lib_id: str, title: str, content: str = "") -> dict:
    """新增頁面（僅擁有者）。"""
    lib = get_library(lib_id, user_id)
    if not lib or not lib["is_owner"]:
        raise PermissionError("只有擁有者可以新增頁面。")
    page_id = _nid("kbpg")
    # sort_order = 目前最大 + 1
    max_order = max([p.get("sort_order", 0) for p in lib["pages"]], default=-1) + 1
    with db.get_conn() as conn:
        if db.is_postgres():
            conn.execute(
                """INSERT INTO kb_pages
                   (id, library_id, title, content, sort_order, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, NOW(), NOW())""",
                (page_id, lib_id, title.strip(), content, max_order))
        else:
            conn.execute(
                """INSERT INTO kb_pages
                   (id, library_id, title, content, sort_order, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))""",
                (page_id, lib_id, title.strip(), content, max_order))
        conn.execute(
            "UPDATE kb_libraries SET updated_at = {} WHERE id = ?".format(
                "NOW()" if db.is_postgres() else "datetime('now')",
                "%s" if db.is_postgres() else "?"),
            (lib_id,))
        conn.commit()
    return get_page(page_id, user_id)


def get_page(page_id: str, viewer_id: str = None) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM kb_pages WHERE id = ?" if not db.is_postgres()
            else "SELECT * FROM kb_pages WHERE id = %s",
            (page_id,)).fetchone()
        if not row:
            return None
        page = dict(row)
        # 檢查庫權限
        lib = get_library(page["library_id"], viewer_id)
        if not lib:
            return None
        page["is_owner"] = lib["is_owner"]
        return page


def update_page(user_id: str, page_id: str, title: str = None,
                content: str = None, sort_order: int = None) -> dict:
    page = get_page(page_id, user_id)
    if not page or not page["is_owner"]:
        raise PermissionError("只有擁有者可以編輯頁面。")
    sets, params = [], []
    ph = "%s" if db.is_postgres() else "?"
    if title is not None:
        sets.append(f"title = {ph}"); params.append(title.strip())
    if content is not None:
        sets.append(f"content = {ph}"); params.append(content)
    if sort_order is not None:
        sets.append(f"sort_order = {ph}"); params.append(int(sort_order))
    if not sets:
        return page
    ts2 = "NOW()" if db.is_postgres() else "datetime('now')"
    sets.append(f"updated_at = {ts2}")
    params.append(page_id)
    with db.get_conn() as conn:
        conn.execute(f"UPDATE kb_pages SET {', '.join(sets)} WHERE id = {ph}", params)
        conn.commit()
    return get_page(page_id, user_id)


def delete_page(user_id: str, page_id: str) -> bool:
    page = get_page(page_id, user_id)
    if not page or not page["is_owner"]:
        raise PermissionError("只有擁有者可以刪除頁面。")
    ph = "%s" if db.is_postgres() else "?"
    with db.get_conn() as conn:
        conn.execute(f"DELETE FROM kb_pages WHERE id = {ph}", (page_id,))
        conn.commit()
    return True


# ---------------- 興趣星辰（AI 推薦） ----------------

def recommend_libraries(user_id: str, limit: int = 6) -> list[dict]:
    """依用戶學習歷史（掌握度主題＋戰役主題）推薦庫。
    
    策略：
    1. 從 mastery_snapshot 取用戶高掌握主題
    2. 從 learn_sessions 取最近戰役主題
    3. 找標籤匹配的公開庫
    4. 沒有歷史則回熱門庫
    """
    interests = _get_user_interests(user_id)
    all_libs = list_libraries(viewer_id=user_id, limit=100)
    if not interests:
        # 新用戶：回最新庫
        return all_libs[:limit]
    scored = []
    for lib in all_libs:
        if lib["owner_id"] == user_id:
            continue  # 不推薦自己的
        tags = lib.get("tags", [])
        score = 0
        for it in interests:
            it_low = it.lower()
            for t in tags:
                if it_low in t.lower() or t.lower() in it_low:
                    score += 2
            # 標題/簡介匹配
            if it_low in lib.get("title", "").lower():
                score += 3
            if it_low in lib.get("description", "").lower():
                score += 1
        if score > 0:
            lib["match_score"] = score
            lib["matched_on"] = [i for i in interests
                                 if any(i.lower() in t.lower() for t in tags)]
            scored.append(lib)
    scored.sort(key=lambda x: -x["match_score"])
    # 不夠則補熱門
    if len(scored) < limit:
        seen = {l["id"] for l in scored}
        for lib in all_libs:
            if lib["id"] not in seen and lib["owner_id"] != user_id:
                lib["match_score"] = 0
                scored.append(lib)
            if len(scored) >= limit:
                break
    return scored[:limit]


def _get_user_interests(user_id: str) -> list[str]:
    """從掌握度和戰役歷史提取興趣主題。"""
    interests = []
    try:
        with db.get_conn() as conn:
            # 掌握度高的主題
            rows = conn.execute(
                "SELECT topic FROM mastery_snapshots WHERE user_id = ? ORDER BY mastery DESC LIMIT 5"
                if not db.is_postgres()
                else "SELECT topic FROM mastery_snapshots WHERE user_id = %s ORDER BY mastery DESC LIMIT 5",
                (user_id,)).fetchall()
            for r in rows:
                t = r["topic"] if isinstance(r, dict) else r[0]
                if t and t not in interests:
                    interests.append(t)
            # 最近戰役主題
            rows = conn.execute(
                "SELECT DISTINCT topic FROM learn_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5"
                if not db.is_postgres()
                else "SELECT DISTINCT topic FROM learn_sessions WHERE user_id = %s ORDER BY created_at DESC LIMIT 5",
                (user_id,)).fetchall()
            for r in rows:
                t = r["topic"] if isinstance(r, dict) else r[0]
                if t and t not in interests:
                    interests.append(t)
    except Exception:
        pass
    return interests[:10]
