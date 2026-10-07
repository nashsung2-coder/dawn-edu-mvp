"""RAG 簡易檢索：關鍵字 tokenize → title/summary/tags 加權計分 → top3 ＋引用。"""
from __future__ import annotations

import re

from app import db

NO_RESULT_MSG = "目前知識湖沒有足夠內容，要不要換個標籤？"

_TOKEN_SPLIT = re.compile(r"[\s，。、；：？！「」『』（）【】《》\"'()\[\],.;!?\-_/]+")


def tokenize(text: str) -> list[str]:
    parts = [p for p in _TOKEN_SPLIT.split(text or "") if p]
    tokens: list[str] = []
    for p in parts:
        # 中文詞：保留原詞；同時把連續中文拆成字，增加召回
        if re.fullmatch(r"[\u4e00-\u9fff]{2,}", p):
            tokens.append(p)
            tokens.extend(list(p))
        elif len(p) >= 2:
            tokens.append(p.lower())
    # 去重保序
    seen, out = set(), []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def rag_query(q: str, top_k: int = 3) -> dict:
    tokens = tokenize(q)
    if not tokens:
        return {"query": q, "chunks": [], "citations": [], "message": NO_RESULT_MSG}

    with db.get_conn() as conn:
        contents = conn.execute("SELECT * FROM content_items ORDER BY id").fetchall()
        tagmap: dict[int, list[str]] = {}
        for r in conn.execute(
            """SELECT ct.content_id, t.name FROM content_tags ct
               JOIN tags t ON t.id = ct.tag_id"""
        ).fetchall():
            tagmap.setdefault(r["content_id"], []).append(r["name"])

        scored = []
        for c in contents:
            title, summary = c["title"], c["summary"]
            tags = tagmap.get(c["id"], [])
            tag_text = " ".join(tags)
            score = 0.0
            hit_terms: list[str] = []
            strong_hit = False  # 至少一個「多字詞」命中，避免單字雜訊
            for tok in tokens:
                w = 0.0
                if tok in title:
                    w += 3.0
                if tok in summary:
                    w += 1.0
                if tok in tag_text:
                    w += 2.0
                if w > 0:
                    score += w
                    hit_terms.append(tok)
                    if len(tok) >= 2:
                        strong_hit = True
            # 整句命中加權
            if q.strip() and q.strip() in title:
                score += 5.0
                strong_hit = True
            if score > 0 and strong_hit:
                scored.append((score, dict(c), tags, hit_terms))

        scored.sort(key=lambda x: (-x[0], x[1]["id"]))
        top = scored[:top_k]

        # 門檻：最高分太低視為無結果
        if not top or top[0][0] < 2.0:
            return {"query": q, "chunks": [], "citations": [], "message": NO_RESULT_MSG}

        chunks, citations = [], []
        for score, c, tags, hit_terms in top:
            excerpt = c["summary"][:120]
            chunk = {
                "content_id": c["id"],
                "title": c["title"],
                "excerpt": excerpt,
                "url": c["url"],
                "source_type": c["source_type"],
                "tags": tags,
                "matched_terms": hit_terms[:8],
                "score": round(score, 2),
            }
            chunks.append(chunk)
            citations.append(
                {"content_id": c["id"], "title": c["title"], "url": c["url"]}
            )
        return {
            "query": q,
            "chunks": chunks,
            "citations": citations,
            "message": f"找到 {len(chunks)} 筆相關內容，引用如下。",
        }
