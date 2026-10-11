"""
知識節點倉庫：從一道題目長出知識連結，可共享成學習網絡。
"""
from __future__ import annotations

import json
import uuid
from typing import List, Dict, Any, Optional

from app import db


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def create_node(owner_id: str, question: str, answer: str = "",
                explanation: str = "", concepts: List[str] | None = None,
                source: str = "review", is_public: bool = True) -> dict:
    """從題目建立知識節點。"""
    node_id = "kn_" + uuid.uuid4().hex[:12]
    concepts = concepts or []
    with db.get_conn() as conn:
        ph = "%s" if db.is_postgres() else "?"
        cols = "id, owner_id, question, answer, explanation, concepts, source, is_public, created_at"
        placeholders = ", ".join([ph] * 9)
        conn.execute(
            f"INSERT INTO knowledge_nodes ({cols}) VALUES ({placeholders})",
            (node_id, owner_id, question, answer, explanation,
             json.dumps(concepts, ensure_ascii=False), source,
             1 if is_public else 0, _now_iso()))
        conn.commit()
    return {"ok": True, "id": node_id}


def list_public(limit: int = 30, concept: str = "") -> List[Dict[str, Any]]:
    """瀏覽公開的知識節點（學習網絡）。"""
    with db.get_conn() as conn:
        ph = "%s" if db.is_postgres() else "?"
        if concept:
            # 簡單的 JSON 包含查詢
            like = f'%"{concept}"%'
            rows = conn.execute(
                f"""SELECT kn.*, u.name as owner_name FROM knowledge_nodes kn
                    LEFT JOIN users u ON u.id = kn.owner_id
                    WHERE kn.is_public = 1 AND kn.concepts LIKE {ph}
                    ORDER BY kn.upvotes DESC, kn.created_at DESC LIMIT {int(limit)}""",
                (like,)).fetchall()
        else:
            rows = conn.execute(
                f"""SELECT kn.*, u.name as owner_name FROM knowledge_nodes kn
                    LEFT JOIN users u ON u.id = kn.owner_id
                    WHERE kn.is_public = 1
                    ORDER BY kn.upvotes DESC, kn.created_at DESC LIMIT {int(limit)}"""
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["concepts"] = json.loads(d.get("concepts") or "[]")
            except Exception:
                d["concepts"] = []
            d.pop("owner_id", None)
            result.append(d)
        return result


def list_mine(owner_id: str) -> List[Dict[str, Any]]:
    """我的知識節點。"""
    with db.get_conn() as conn:
        ph = "%s" if db.is_postgres() else "?"
        rows = conn.execute(
            f"SELECT * FROM knowledge_nodes WHERE owner_id = {ph} ORDER BY created_at DESC",
            (owner_id,)).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["concepts"] = json.loads(d.get("concepts") or "[]")
            except Exception:
                d["concepts"] = []
            result.append(d)
        return result


def upvote(node_id: str) -> dict:
    """按讚知識節點。"""
    with db.get_conn() as conn:
        ph = "%s" if db.is_postgres() else "?"
        conn.execute(
            f"UPDATE knowledge_nodes SET upvotes = upvotes + 1 WHERE id = {ph}",
            (node_id,))
        conn.commit()
    return {"ok": True}
