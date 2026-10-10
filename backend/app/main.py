"""曙光教育智能系統 MVP 後端 — FastAPI 入口。"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app import auth as auth_mod
from app import db
from app import economy
from app import learn as learn_mod
from app import llm as llm_mod
from app import world as world_mod
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


# ---------------- 帳號 ----------------
class AuthIn(BaseModel):
    name: str = Field(description="暱稱（1–20 字，唯一）")
    password: str = Field(description="密碼（至少 4 字元）")
    email: str = Field(default="", description="Email（選填）")
    sec_question: str = Field(default="", description="安全問題（選填，忘記密碼時用）")
    sec_answer: str = Field(default="", description="安全問題答案（選填）")


def _bearer_token(request: Request) -> str:
    authz = request.headers.get("authorization", "")
    if authz.lower().startswith("bearer "):
        return authz[7:].strip()
    return ""


def _current_user(request: Request) -> dict:
    """由 Bearer 權杖取當前使用者；無效則 401。"""
    user = auth_mod.get_user_by_token(_bearer_token(request))
    if not user:
        raise HTTPException(401, "請先登入。你的權杖無效或已過期，請重新登入。")
    return user


def _own_island(request: Request, user_id: str) -> dict:
    """島嶼 API 守衛：需登入，且只能存取自己的島嶼。"""
    user = _current_user(request)
    if user["id"] != user_id:
        raise HTTPException(403, "你只能存取自己的島嶼。")
    return user


@app.post("/api/v1/auth/register", summary="註冊帳號", status_code=201)
def auth_register(body: AuthIn):
    try:
        result = auth_mod.register(body.name, body.password, body.email,
                                   body.sec_question, body.sec_answer)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "token": result["token"],
            "user": {"id": result["id"], "name": result["name"], "email": result["email"]},
            "has_sec_qa": result.get("has_sec_qa", False),
            "reason": f"歡迎來到慢荒宇宙，{result['name']}！你的島嶼已經在星海中浮現。"}


@app.post("/api/v1/auth/login", summary="登入")
def auth_login(body: AuthIn):
    try:
        result = auth_mod.login(body.name, body.password)
    except ValueError as e:
        raise HTTPException(401, str(e))
    return {"ok": True, "token": result["token"],
            "user": {"id": result["id"], "name": result["name"]},
            "reason": f"歡迎回來，{result['name']}！你的島嶼還在原處等你。"}


@app.post("/api/v1/auth/logout", summary="登出")
def auth_logout(request: Request):
    auth_mod.logout(_bearer_token(request))
    return {"ok": True, "reason": "已登出。星海會記得你，下次見。"}


@app.get("/api/v1/auth/me", summary="當前使用者")
def auth_me(request: Request):
    user = _current_user(request)
    return {"ok": True, "user": user}


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
def island_state(user_id: str, request: Request):
    _own_island(request, user_id)
    return get_island(user_id)


class ExpandIn(BaseModel):
    action: str = Field(description="complete_topic / fix_myth / ask_question / complete_quest / co_study")


@app.post("/api/v1/islands/{user_id}/expand", summary="開疆拓土")
def island_expand(user_id: str, body: ExpandIn, request: Request):
    _own_island(request, user_id)
    result = expand_island(user_id, body.action)
    if not result.get("ok"):
        raise HTTPException(400, result["reason"])
    # 開疆拓土由伺服器發放星砂（純遊戲）
    result["points"] = economy.award_expand(user_id)
    result["reason"] += "獲得星砂 ×10。"
    return result


# ---------------- 星砂經濟（純遊戲） ----------------
class EarnIn(BaseModel):
    amount: int = Field(description="本次獲得星砂（1–50）")
    reason: str = Field(default="", description="獲得原因")


class BuyIn(BaseModel):
    item_id: str = Field(description="武器 id：dart / wave / shield")


@app.get("/api/v1/game/state", summary="星砂與武器庫")
def game_state(request: Request):
    user = _current_user(request)
    return {"ok": True, **economy.get_state(user["id"])}


@app.post("/api/v1/game/earn", summary="獲得星砂")
def game_earn(body: EarnIn, request: Request):
    user = _current_user(request)
    try:
        return economy.earn(user["id"], body.amount, body.reason)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/v1/game/shop/buy", summary="購買武器")
def game_buy(body: BuyIn, request: Request):
    user = _current_user(request)
    try:
        return economy.buy(user["id"], body.item_id)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))


class UseIn(BaseModel):
    item_id: str = Field(description="消耗一個武器")


@app.post("/api/v1/game/use", summary="消耗武器")
def game_use(body: UseIn, request: Request):
    user = _current_user(request)
    try:
        return economy.use_item(user["id"], body.item_id)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))


# ---------------- 收藏（需登入，跟著帳號走） ----------------
class FavoriteIn(BaseModel):
    content_id: str = Field(description="內容 id")


@app.get("/api/v1/favorites", summary="我的收藏")
def favorites_list(request: Request):
    user = _current_user(request)
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT content_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
    return {"ok": True, "favorites": [r["content_id"] for r in rows]}


@app.post("/api/v1/favorites", summary="加入收藏", status_code=201)
def favorites_add(body: FavoriteIn, request: Request):
    user = _current_user(request)
    cid = body.content_id.strip()
    if not cid:
        raise HTTPException(400, "content_id 不可為空。")
    if db.is_postgres():
        sql = ("INSERT INTO favorites (user_id, content_id) VALUES (?, ?) "
               "ON CONFLICT (user_id, content_id) DO NOTHING")
    else:
        sql = "INSERT OR IGNORE INTO favorites (user_id, content_id) VALUES (?, ?)"
    with db.get_conn() as conn:
        conn.execute(sql, (user["id"], cid))
        conn.commit()
    return {"ok": True, "content_id": cid}


@app.delete("/api/v1/favorites/{content_id}", summary="取消收藏")
def favorites_remove(content_id: str, request: Request):
    user = _current_user(request)
    with db.get_conn() as conn:
        conn.execute(
            "DELETE FROM favorites WHERE user_id = ? AND content_id = ?",
            (user["id"], content_id),
        )
        conn.commit()
    return {"ok": True, "content_id": content_id}


# ---------------- 引路儀式（人格測驗，純問卷） ----------------
class PersonaIn(BaseModel):
    persona: dict = Field(description="引路儀式結果：{role, role_name, axes, choices, at}")


@app.post("/api/v1/auth/persona", summary="儲存人格設定")
def auth_persona(body: PersonaIn, request: Request):
    user = _current_user(request)
    try:
        saved = auth_mod.set_persona(user["id"], body.persona)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "persona": saved}


# ---------------- 帳號管理 ----------------
class EmailIn(BaseModel):
    email: str = Field(description="Email（可清空）")


class ChangePwIn(BaseModel):
    old_password: str = Field(description="舊密碼")
    new_password: str = Field(description="新密碼（至少 4 字元）")


class ForgotIn(BaseModel):
    name: str = Field(description="暱稱")
    answer: str = Field(description="安全問題的答案")
    new_password: str = Field(description="新密碼（至少 4 字元）")


class SecQaIn(BaseModel):
    sec_question: str = Field(description="安全問題")
    sec_answer: str = Field(description="安全問題答案")


class DeleteIn(BaseModel):
    password: str = Field(description="密碼確認")


@app.patch("/api/v1/auth/me", summary="更新 Email")
def auth_update_email(body: EmailIn, request: Request):
    user = _current_user(request)
    try:
        email = auth_mod.set_email(user["id"], body.email)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "email": email}


@app.post("/api/v1/auth/password", summary="修改密碼（需舊密碼）")
def auth_change_password(body: ChangePwIn, request: Request):
    user = _current_user(request)
    try:
        auth_mod.change_password(user["id"], body.old_password, body.new_password)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except KeyError:
        raise HTTPException(401, "請重新登入。")
    return {"ok": True, "reason": "密碼已更新，其他裝置的登入已失效，請用新密碼重新登入。"}


@app.get("/api/v1/auth/security-question", summary="查詢安全問題")
def auth_sec_question(name: str):
    try:
        q = auth_mod.get_security_question(name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not q:
        raise HTTPException(404, "找不到這個暱稱，或此帳號尚未設定安全問題。")
    return {"ok": True, "question": q}


@app.post("/api/v1/auth/forgot", summary="忘記密碼（安全問題重設）")
def auth_forgot(body: ForgotIn):
    try:
        auth_mod.reset_password_by_answer(body.name, body.answer, body.new_password)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "reason": "密碼已重設，請用新密碼登入。"}


@app.put("/api/v1/auth/security-qa", summary="設定安全問題")
def auth_set_secqa(body: SecQaIn, request: Request):
    user = _current_user(request)
    try:
        q = auth_mod.set_security_qa(user["id"], body.sec_question, body.sec_answer)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "question": q, "reason": "安全問題已更新。"}


@app.delete("/api/v1/auth/me", summary="刪除帳號（不可復原）")
def auth_delete_me(body: DeleteIn, request: Request):
    user = _current_user(request)
    try:
        auth_mod.delete_user(user["id"], body.password)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except KeyError:
        raise HTTPException(401, "請重新登入。")
    return {"ok": True, "reason": "帳號與所有學習資料已刪除。星海會記得你曾來過。"}


@app.get("/api/v1/export", summary="匯出學習歷程")
def export_data(request: Request):
    user = _current_user(request)
    try:
        data = auth_mod.export_user_data(user["id"])
    except KeyError:
        raise HTTPException(401, "請重新登入。")
    return {"ok": True, **data}


class OccupyIn(BaseModel):
    tag: str = Field(description="如 SUBJ:物理")


@app.post("/api/v1/islands/{user_id}/occupy", summary="佔領標籤")
def island_occupy(user_id: str, body: OccupyIn, request: Request):
    _own_island(request, user_id)
    occupy_tag(user_id, body.tag)
    return {"ok": True, "island": get_island(user_id),
            "reason": f"已佔領標籤「{body.tag}」，島嶼的知識密度提升了！"}


@app.get("/api/v1/islands/{user_id}/logs", summary="領土日誌")
def island_logs(user_id: str, request: Request, limit: int = Query(30, ge=1, le=100)):
    _own_island(request, user_id)
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT action, delta, territory_after, log_date, created_at "
            "FROM territory_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return {"logs": [dict(r) for r in rows]}


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


# ---------------- 費曼戰役：學習會話 ----------------
class LearnStartIn(BaseModel):
    question: str = Field(description="學習問題")
    grade_band: str = Field(default="高中", description="年級段")
    hypothesis: str = Field(default="", description="自己的假設（選填）")


class LearnEventIn(BaseModel):
    kind: str = Field(description="事件種類")
    payload: dict = Field(default_factory=dict)


class QuizAnswerIn(BaseModel):
    answers: list[int] = Field(description="選擇題答案索引")


class FeynmanIn(BaseModel):
    explanation: str = Field(description="學生的費曼解釋")


class FinishIn(BaseModel):
    badge_name: str = Field(default="", description="自訂技能章名（選填）")


@app.post("/api/v1/learn/sessions", summary="開始一場費曼戰役", status_code=201)
def learn_start(body: LearnStartIn, request: Request):
    user = _current_user(request)
    try:
        return {"ok": True,
                **learn_mod.start_session(user["id"], body.question,
                                          body.grade_band, body.hypothesis)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/v1/learn/sessions", summary="我的學習會話")
def learn_list(request: Request, limit: int = Query(20, ge=1, le=100)):
    user = _current_user(request)
    return {"ok": True, "sessions": learn_mod.list_sessions(user["id"], limit)}


@app.get("/api/v1/learn/sessions/{sid}", summary="學習會話詳情")
def learn_detail(sid: str, request: Request):
    user = _current_user(request)
    try:
        return {"ok": True, **learn_mod.get_session(sid, user["id"])}
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.post("/api/v1/learn/sessions/{sid}/events", summary="記錄學習事件")
def learn_event(sid: str, body: LearnEventIn, request: Request):
    user = _current_user(request)
    try:
        learn_mod.log_event(sid, user["id"], body.kind, body.payload)
    except KeyError as e:
        raise HTTPException(404, str(e))
    return {"ok": True}


@app.post("/api/v1/learn/sessions/{sid}/quiz", summary="產生穿插測驗")
def learn_quiz(sid: str, request: Request, n: int = Query(3, ge=1, le=5)):
    user = _current_user(request)
    try:
        return {"ok": True, **learn_mod.get_quiz(sid, user["id"], n)}
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/v1/learn/sessions/{sid}/quiz/answers", summary="測驗作答")
def learn_quiz_answer(sid: str, body: QuizAnswerIn, request: Request):
    user = _current_user(request)
    try:
        return {"ok": True, **learn_mod.answer_quiz(sid, user["id"], body.answers)}
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/v1/learn/sessions/{sid}/feynman", summary="費曼解釋＋AI糾錯")
def learn_feynman(sid: str, body: FeynmanIn, request: Request):
    user = _current_user(request)
    try:
        return {"ok": True, **learn_mod.feynman_explain(sid, user["id"], body.explanation)}
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/v1/learn/sessions/{sid}/finish", summary="完成戰役：授勳")
def learn_finish(sid: str, body: FinishIn, request: Request):
    user = _current_user(request)
    try:
        result = learn_mod.finish_session(sid, user["id"], body.badge_name)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))
    # 戰役完成 → 寵物孵化／成長（強度=學習投入函數）
    pet_info = None
    try:
        pet = world_mod.get_pet(user["id"])
        if not pet:
            pet_info = {"hatched": True,
                        "pet": world_mod.hatch_pet(user["id"])}
        else:
            pet_info = {"hatched": False,
                        "pet": world_mod.pet_gain_exp(user["id"], 60, "完成費曼戰役")}
    except Exception:
        pass
    result["pet"] = pet_info
    return {"ok": True, **result}


@app.get("/api/v1/learn/badges", summary="我的技能章（武器庫）")
def learn_badges(request: Request):
    user = _current_user(request)
    return {"ok": True, "badges": learn_mod.list_badges(user["id"])}


@app.get("/api/v1/learn/mastery", summary="主題掌握度")
def learn_mastery(request: Request):
    user = _current_user(request)
    return {"ok": True, "topics": learn_mod.get_mastery(user["id"])}


@app.get("/api/v1/learn/llm-status", summary="LLM 診斷（不暴露 key 值）")
def learn_llm_status(request: Request):
    _current_user(request)
    return {"ok": True, "has_llm": llm_mod.has_llm(),
            "keys": llm_mod.diagnose_keys(),
            "model": llm_mod.DEFAULT_MODEL}


@app.get("/api/v1/learn/textbook", summary="課本筆記章節")
def learn_textbook(request: Request):
    user = _current_user(request)
    return {"ok": True, "chapters": learn_mod.textbook_chapters(user["id"]),
            "llm": llm_mod.has_llm()}


# ---------------- 遊戲世界：寵物／島嶼／市集／探索／每週 ----------------
class PetNameIn(BaseModel):
    name: str = Field(description="寵物名字")
    species: str = Field(default="", description="種類（選填）")


@app.get("/api/v1/world/pet", summary="我的寵物")
def world_pet(request: Request):
    user = _current_user(request)
    return {"ok": True, "pet": world_mod.get_pet(user["id"])}


@app.post("/api/v1/world/pet/hatch", summary="孵化寵物", status_code=201)
def world_pet_hatch(body: PetNameIn, request: Request):
    user = _current_user(request)
    try:
        return {"ok": True, "pet": world_mod.hatch_pet(user["id"], body.name, body.species)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/v1/world/pet/rename", summary="寵物改名")
def world_pet_rename(body: PetNameIn, request: Request):
    user = _current_user(request)
    try:
        return {"ok": True, "pet": world_mod.rename_pet(user["id"], body.name)}
    except ValueError as e:
        raise HTTPException(400, str(e))


class IslandIn(BaseModel):
    session_id: str = Field(description="來源戰役")
    name: str = Field(default="", description="島嶼名")
    topic: str = Field(default="", description="主題")


@app.get("/api/v1/world/islands", summary="我的島嶼")
def world_islands(request: Request):
    user = _current_user(request)
    return {"ok": True, "islands": world_mod.list_islands(user["id"])}


@app.post("/api/v1/world/islands", summary="命名新島嶼", status_code=201)
def world_island_create(body: IslandIn, request: Request):
    user = _current_user(request)
    return {"ok": True,
            "island": world_mod.create_island(user["id"], body.session_id,
                                              body.name, body.topic)}


class BuildIn(BaseModel):
    island_id: str = Field(description="島嶼 ID")
    btype: str = Field(description="建築類型：圖書館/訓練場/瞭望塔")


@app.post("/api/v1/world/build", summary="蓋房／升級")
def world_build(body: BuildIn, request: Request):
    user = _current_user(request)
    try:
        return {"ok": True, **world_mod.build(user["id"], body.island_id, body.btype)}
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))


class ListingIn(BaseModel):
    item_type: str = Field(description="badge（武器）/ island（島嶼）")
    item_id: str = Field(description="物品 ID")
    price: int = Field(default=0, description="星砂定價")
    trade_kind: str = Field(default="sell", description="sell / barter")
    want_text: str = Field(default="", description="以物易物想換什麼")


@app.get("/api/v1/world/market", summary="交易市集")
def world_market():
    return {"ok": True, "listings": world_mod.list_market()}


@app.post("/api/v1/world/market", summary="上架物品", status_code=201)
def world_market_publish(body: ListingIn, request: Request):
    user = _current_user(request)
    try:
        return {"ok": True, **world_mod.publish_listing(
            user["id"], body.item_type, body.item_id,
            body.price, body.trade_kind, body.want_text)}
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/v1/world/market/{lid}/buy", summary="購買")
def world_market_buy(lid: str, request: Request):
    user = _current_user(request)
    try:
        return world_mod.buy_listing(user["id"], lid)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))


@app.delete("/api/v1/world/market/{lid}", summary="下架")
def world_market_cancel(lid: str, request: Request):
    user = _current_user(request)
    try:
        return world_mod.cancel_listing(user["id"], lid)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))


class ExploreIn(BaseModel):
    zone: str = Field(description="探索區域")


class ChoiceIn(BaseModel):
    choice_index: int = Field(description="選項索引")


@app.get("/api/v1/world/zones", summary="探索區域")
def world_zones():
    return {"ok": True, "zones": [
        {"name": z, "desc": v["desc"], "stages": v["stages"]}
        for z, v in world_mod.ZONES.items()]}


@app.post("/api/v1/world/explore", summary="開始探索", status_code=201)
def world_explore_start(body: ExploreIn, request: Request):
    user = _current_user(request)
    try:
        return {"ok": True, **world_mod.start_exploration(user["id"], body.zone)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/v1/world/explore", summary="我的探索紀錄")
def world_explore_list(request: Request):
    user = _current_user(request)
    return {"ok": True, "explorations": world_mod.list_explorations(user["id"])}


@app.get("/api/v1/world/explore/{eid}", summary="探索進度")
def world_explore_get(eid: str, request: Request):
    user = _current_user(request)
    try:
        return {"ok": True, **world_mod.get_exploration(eid, user["id"])}
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.post("/api/v1/world/explore/{eid}/choose", summary="劇情選擇")
def world_explore_choose(eid: str, body: ChoiceIn, request: Request):
    user = _current_user(request)
    try:
        return world_mod.explore_choice(eid, user["id"], body.choice_index)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/v1/world/weekly", summary="產生本週精選＋盤點")
def world_weekly(request: Request, week: str = Query("")):
    user = _current_user(request)
    return {"ok": True, **world_mod.generate_weekly(user["id"], week)}


@app.get("/api/v1/world/weekly", summary="本週精選")
def world_weekly_get(request: Request, week: str = Query("")):
    user = _current_user(request)
    d = world_mod.get_weekly(user["id"], week)
    if not d:
        raise HTTPException(404, "本週還沒產生精選，先 POST 產生。")
    return {"ok": True, **d}


class AttrSpendIn(BaseModel):
    badge_id: str = Field(description="武器 ID")
    points: int = Field(description="投入點數")
    route: str = Field(default="attack", description="attack / defense / bond")


@app.get("/api/v1/world/attr-points", summary="我的自由屬性點")
def world_attr_points(request: Request):
    user = _current_user(request)
    return {"ok": True, "points": world_mod.get_attr_points(user["id"])}


@app.post("/api/v1/world/attr-points/spend", summary="屬性點加乘武器")
def world_attr_spend(body: AttrSpendIn, request: Request):
    user = _current_user(request)
    try:
        return world_mod.spend_attr_points(user["id"], body.badge_id,
                                           body.points, body.route)
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))


@app.get("/", summary="健康檢查")
def root():
    return {"service": "dawn-edu-mvp", "status": "ok",
            "reason": "曙光教育智能系統 MVP 後端運行中，歡迎來到慢荒宇宙！"}
