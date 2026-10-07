"""曙光教育智能系統 MVP 後端 — FastAPI 入口。"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app import db
from app.game import (
    compare_radar,
    create_duel,
    expand_island,
    get_island,
    occupy_tag,
    radar_position,
)
from app.rag import rag_query
from app.search import intersection_search
from seed import run_seed

from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    if db.table_empty("tag_dimensions"):
        run_seed()
    yield


app = FastAPI(
    title="曙光教育智能系統 MVP",
    description="慢荒宇宙 × 交集資料庫 × 曙光知識湖 —— MVP 後端 API",
    version="0.1.0",
    lifespan=lifespan,
)


def _cors_origins() -> list[str]:
    """允許的前端來源：環境變數 FRONTEND_URL（逗號分隔，如 Cloudflare Pages 網址）。"""
    raw = os.environ.get("FRONTEND_URL", "")
    return [o.strip() for o in raw.split(",") if o.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    # 本機開發：允許任何 localhost / 127.0.0.1 埠
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- 標籤 ----------------
@app.get("/api/v1/tags", summary="依維度分組的標籤樹")
def list_tags():
    with db.get_conn() as conn:
        dims = conn.execute("SELECT code, name FROM tag_dimensions ORDER BY code").fetchall()
        tree = []
        for d in dims:
            tags = conn.execute(
                "SELECT id, name, alias FROM tags WHERE dimension_code = ? ORDER BY id",
                (d["code"],),
            ).fetchall()
            tree.append(
                {
                    "code": d["code"],
                    "name": d["name"],
                    "tags": [
                        {
                            "id": t["id"],
                            "name": t["name"],
                            "aliases": [a for a in (t["alias"] or "").split(",") if a],
                        }
                        for t in tags
                    ],
                }
            )
        return {"dimensions": tree}


# ---------------- 內容 ----------------
@app.get("/api/v1/contents", summary="內容列表")
def list_contents(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
    with db.get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM content_items").fetchone()["n"]
        rows = conn.execute(
            "SELECT id, title, summary, source_type, duration_min, url FROM content_items "
            "ORDER BY id LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return {"total": total, "items": [dict(r) for r in rows]}


@app.get("/api/v1/contents/{content_id}", summary="內容詳情")
def get_content(content_id: int):
    with db.get_conn() as conn:
        row = conn.execute("SELECT * FROM content_items WHERE id = ?", (content_id,)).fetchone()
        if not row:
            raise HTTPException(404, f"找不到編號 {content_id} 的內容。")
        tags = conn.execute(
            """SELECT t.dimension_code, t.name FROM content_tags ct
               JOIN tags t ON t.id = ct.tag_id WHERE ct.content_id = ?""",
            (content_id,),
        ).fetchall()
        item = dict(row)
        item["tags"] = [f"{t['dimension_code']}:{t['name']}" for t in tags]
        return item


# ---------------- 交集搜尋 ----------------
@app.get("/api/v1/search/intersection", summary="交集搜尋")
def search_intersection(
    tags: str = Query("", description="逗號分隔，如 SUBJ:物理,CONC:蒸發"),
    mode: str = Query("weighted", description="strict / weighted / fuzzy"),
    exclude: str = Query("", description="排除標籤，如 DIFF:L4"),
):
    result = intersection_search(tags, mode, exclude)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


# ---------------- 學習事件 / 心流細土 ----------------
class LearningEventIn(BaseModel):
    user_id: str
    content_id: Optional[int] = None
    event_type: str = "view"
    session_id: str = ""
    detail: dict = Field(default_factory=dict)


@app.post("/api/v1/learning-events", summary="寫入學習事件")
def post_learning_event(ev: LearningEventIn):
    import json

    with db.get_conn() as conn:
        new_id = db.insert_id(
            conn,
            """INSERT INTO learning_events (user_id, content_id, event_type, session_id, detail)
               VALUES (?, ?, ?, ?, ?)""",
            (ev.user_id, ev.content_id, ev.event_type, ev.session_id,
             json.dumps(ev.detail, ensure_ascii=False)),
        )
        return {"ok": True, "id": new_id, "reason": "學習事件已記錄，島嶼養分 +1。"}


class FlowDepositIn(BaseModel):
    user_id: str
    session_id: str = ""
    content_id: Optional[int] = None
    resource_type: str = ""
    event_type: str
    dwell_ms: int = 0
    focus_score: Optional[float] = None
    emotion: str = ""
    flow_state: str = ""
    note: str = ""
    context_stage: str = ""


@app.post("/api/v1/flow-deposits", summary="寫入心流細土")
def post_flow_deposit(fd: FlowDepositIn):
    with db.get_conn() as conn:
        new_id = db.insert_id(
            conn,
            """INSERT INTO flow_deposits
               (user_id, session_id, content_id, resource_type, event_type, dwell_ms,
                focus_score, emotion, flow_state, note, context_stage)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (fd.user_id, fd.session_id, fd.content_id, fd.resource_type, fd.event_type,
             fd.dwell_ms, fd.focus_score, fd.emotion, fd.flow_state, fd.note, fd.context_stage),
        )
        return {"ok": True, "id": new_id, "reason": "心流細土已沉積，滋養你的島嶼。"}


# ---------------- 島嶼 ----------------
@app.get("/api/v1/islands/{user_id}", summary="島嶼狀態")
def island_state(user_id: str):
    return get_island(user_id)


class ExpandIn(BaseModel):
    action: str = Field(description="complete_topic / fix_myth / ask_question / complete_quest / co_study")


@app.post("/api/v1/islands/{user_id}/expand", summary="開疆拓土")
def island_expand(user_id: str, body: ExpandIn):
    result = expand_island(user_id, body.action)
    if not result.get("ok"):
        raise HTTPException(400, result["reason"])
    return result


class OccupyIn(BaseModel):
    tag: str = Field(description="如 SUBJ:物理")


@app.post("/api/v1/islands/{user_id}/occupy", summary="佔領標籤")
def island_occupy(user_id: str, body: OccupyIn):
    occupy_tag(user_id, body.tag)
    return {"ok": True, "island": get_island(user_id),
            "reason": f"已佔領標籤「{body.tag}」，島嶼的知識密度提升了！"}


# ---------------- 雷達 ----------------
@app.get("/api/v1/radar/compare", summary="雷達距離比較")
def radar_compare(me: str = Query(...), other: str = Query(...)):
    return compare_radar(me, other)


@app.get("/api/v1/radar/{user_id}", summary="三維雷達座標")
def radar(user_id: str):
    return radar_position(user_id)


# ---------------- 知識對決 ----------------
class DuelCreateIn(BaseModel):
    challenger_id: str
    opponent_id: str
    tag: str = Field(description="共同標籤，如 CONC:蒸發")


@app.post("/api/v1/duels", summary="發起知識對決")
def duel_create(body: DuelCreateIn):
    result = create_duel(body.challenger_id, body.opponent_id, body.tag)
    if not result.get("ok"):
        raise HTTPException(400, result["reason"])
    return result


class DuelAnswerIn(BaseModel):
    user_id: str
    answers: list[int] = Field(description="每回合選擇的選項 index")


@app.post("/api/v1/duels/{duel_id}/answers", summary="對決作答")
def duel_answer(duel_id: int, body: DuelAnswerIn):
    from app.game import answer_duel

    result = answer_duel(duel_id, body.user_id, body.answers)
    if not result.get("ok"):
        raise HTTPException(400, result["reason"])
    return result


# ---------------- RAG ----------------
@app.get("/api/v1/rag/query", summary="RAG 檢索")
def rag(q: str = Query("", description="問題或關鍵字")):
    return rag_query(q)


@app.get("/", summary="健康檢查")
def root():
    return {"service": "dawn-edu-mvp", "status": "ok",
            "reason": "曙光教育智能系統 MVP 後端運行中，歡迎來到慢荒宇宙！"}
