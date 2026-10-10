"""費曼戰役：學習會話管理。

流程：asking（提問＋寫假設）→ reading（文獻＋自我解釋提示）→ quiz（穿插測驗）
     → feynman（向 AI 解釋＋糾錯）→ done（授勳：技能章＋掌握度更新）

論文依據：
- BKT-lite 掌握度：Corbett & Anderson (1995)——Lv 晉升看 P(掌握)≥0.95
- 提取練習：Roediger & Karpicke (2006)；測驗要有回饋
- 知識建構度：Roscoe & Chi (2007)
"""
from __future__ import annotations

import json
import uuid

from app import db
from app import llm as llm_mod

GRADE_BANDS = ("國小", "國中", "高中", "大學先修")

# BKT-lite 參數
P_INIT = 0.15   # 初始掌握機率
P_LEARN = 0.25  # 每次有效學習的習得機率
P_GUESS = 0.2   # 猜對機率
P_SLIP = 0.1    # 粗心失手機率
MASTERY_THRESHOLD = 0.95


def _bkt_update(prior: float, correct: bool) -> float:
    """BKT 更新：先算後驗，再加學習增量。"""
    if correct:
        post = (prior * (1 - P_SLIP)) / (prior * (1 - P_SLIP) + (1 - prior) * P_GUESS)
    else:
        post = (prior * P_SLIP) / (prior * P_SLIP + (1 - prior) * (1 - P_GUESS))
    return post + (1 - post) * P_LEARN


def _row_to_dict(row) -> dict:
    return dict(row) if row is not None else {}


def start_session(user_id: str, question: str, grade_band: str = "高中",
                  hypothesis: str = "") -> dict:
    """開場：提問＋寫下自己的假設（Pressley 精緻化追問：先預測再給材料）。"""
    question = (question or "").strip()
    if not question:
        raise ValueError("請先提出一個問題。")
    if len(question) > 200:
        raise ValueError("問題太長了，請在 200 字以內。")
    if grade_band not in GRADE_BANDS:
        grade_band = "高中"
    topic = _extract_topic(question)
    depth = _topic_depth(user_id, topic) + 1  # 螺旋深入：同主題次數+1
    sid = "ls_" + uuid.uuid4().hex[:12]
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO learn_sessions (id, user_id, question, grade_band, topic, depth_level, status)"
            " VALUES (?, ?, ?, ?, ?, ?, 'reading')",
            (sid, user_id, question, grade_band, topic, depth),
        )
        if hypothesis.strip():
            conn.execute(
                "INSERT INTO learn_events (session_id, kind, payload) VALUES (?, 'hypothesis', ?)",
                (sid, json.dumps({"text": hypothesis.strip()[:500]}, ensure_ascii=False)),
            )
        conn.commit()
    return {"id": sid, "question": question, "grade_band": grade_band,
            "topic": topic, "depth_level": depth, "status": "reading",
            "teaching_preview": "很好——最後你要把這個問題教會 AI，現在開始閱讀時可以帶著「我要怎麼講給別人聽」的心態。（Fiorella & Mayer, 2014：教學預期）"}


def _extract_topic(question: str) -> str:
    """簡易主題提取：取問題中的關鍵名詞（前 12 字去問句）。"""
    q = question.strip()
    for suffix in ("為什麼", "為何", "怎麼", "如何", "是什麼", "什麼是", "?", "？"):
        q = q.replace(suffix, "")
    return q.strip()[:12] or "未命名主題"


def _topic_depth(user_id: str, topic: str) -> int:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT sessions_count FROM topic_mastery WHERE user_id = ? AND topic = ?",
            (user_id, topic)).fetchone()
        return int(row["sessions_count"]) if row else 0


def get_session(sid: str, user_id: str) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM learn_sessions WHERE id = ? AND user_id = ?",
            (sid, user_id)).fetchone()
        if not row:
            raise KeyError("找不到這個學習會話。")
        events = conn.execute(
            "SELECT kind, payload, created_at FROM learn_events WHERE session_id = ? ORDER BY id",
            (sid,)).fetchall()
    d = _row_to_dict(row)
    d["events"] = [{"kind": e["kind"], "payload": db.jloads(e["payload"], {}),
                    "created_at": e["created_at"]} for e in events]
    return d


def list_sessions(user_id: str, limit: int = 20) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id, question, grade_band, topic, depth_level, status, created_at, completed_at"
            " FROM learn_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit)).fetchall()
    return [_row_to_dict(r) for r in rows]


def log_event(sid: str, user_id: str, kind: str, payload: dict) -> None:
    _own_session(sid, user_id)
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO learn_events (session_id, kind, payload) VALUES (?, ?, ?)",
            (sid, kind, json.dumps(payload, ensure_ascii=False)))
        conn.commit()


def _own_session(sid: str, user_id: str) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM learn_sessions WHERE id = ? AND user_id = ?",
            (sid, user_id)).fetchone()
    if not row:
        raise KeyError("找不到這個學習會話。")
    return _row_to_dict(row)


def _set_status(sid: str, status: str) -> None:
    with db.get_conn() as conn:
        conn.execute("UPDATE learn_sessions SET status = ? WHERE id = ?", (status, sid))
        conn.commit()


def get_quiz(sid: str, user_id: str, n: int = 3) -> dict:
    """穿插測驗：生成題目（關書作答）。"""
    s = _own_session(sid, user_id)
    if s["status"] not in ("reading", "quiz"):
        raise ValueError("現在不是測驗階段。")
    quizzes = llm_mod.generate_quiz(s["question"], s["topic"], s["grade_band"],
                                    s["depth_level"], n)
    log_event(sid, user_id, "quiz", {"questions": quizzes})
    _set_status(sid, "quiz")
    # 回傳時隱藏答案
    public = [{"question": q["question"], "options": q["options"],
               "concept": q.get("concept", "")} for q in quizzes]
    return {"questions": public, "count": len(public),
            "llm": llm_mod.has_llm(),
            "note": "關書作答——提取練習的效果來自憑記憶提取。（Roediger & Karpicke, 2006）"}


def answer_quiz(sid: str, user_id: str, answers: list[int]) -> dict:
    """批改測驗＋更新掌握度（BKT-lite）。回傳每題對錯＋概念回饋。"""
    s = _own_session(sid, user_id)
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM learn_events WHERE session_id = ? AND kind = 'quiz'"
            " ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
    if not row:
        raise ValueError("還沒產生測驗題目。")
    quizzes = db.jloads(row["payload"], {}).get("questions", [])
    results = []
    correct_count = 0
    for i, q in enumerate(quizzes):
        chosen = answers[i] if i < len(answers) else -1
        ok = (chosen == q.get("answer_index"))
        correct_count += 1 if ok else 0
        results.append({"correct": ok, "answer_index": q.get("answer_index"),
                        "concept": q.get("concept", "") if not ok else ""})
    # BKT-lite：整份測驗視為一次觀測（答對率≥2/3 視為 correct）
    correct = (correct_count / max(1, len(quizzes))) >= 2 / 3
    mastery = _update_mastery(s["user_id"], s["topic"], correct)
    log_event(sid, user_id, "quiz_answer",
              {"answers": answers, "correct_count": correct_count,
               "total": len(quizzes), "mastery": mastery})
    _set_status(sid, "feynman")
    return {"results": results, "correct_count": correct_count,
            "total": len(quizzes), "mastery": round(mastery, 3),
            "mastered": mastery >= MASTERY_THRESHOLD,
            "next": "下一幕：費曼解釋——關書，用自己的話把整個概念講清楚，試圖說服 AI。"}


def _update_mastery(user_id: str, topic: str, correct: bool) -> float:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT mastery FROM topic_mastery WHERE user_id = ? AND topic = ?",
            (user_id, topic)).fetchone()
        prior = float(row["mastery"]) if row else P_INIT
        new = _bkt_update(prior, correct)
        if row:
            conn.execute(
                "UPDATE topic_mastery SET mastery = ?, last_at = "
                + ("NOW()" if db.is_postgres() else "datetime('now')")
                + " WHERE user_id = ? AND topic = ?",
                (new, user_id, topic))
        else:
            conn.execute(
                "INSERT INTO topic_mastery (user_id, topic, mastery, sessions_count)"
                " VALUES (?, ?, ?, 0)", (user_id, topic, new))
        conn.commit()
    return new


def feynman_explain(sid: str, user_id: str, explanation: str) -> dict:
    """費曼環節：學生解釋 → AI 糾錯＋追問。"""
    s = _own_session(sid, user_id)
    if s["status"] not in ("quiz", "feynman"):
        raise ValueError("請先完成穿插測驗。")
    explanation = (explanation or "").strip()
    if len(explanation) < 10:
        raise ValueError("解釋太短了——試著多講一點，講到別人能聽懂為止。")
    analysis = llm_mod.analyze_explanation(explanation)
    # 取歷史追問
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT payload FROM learn_events WHERE session_id = ? AND kind = 'ai_feedback'"
            " ORDER BY id DESC LIMIT 3", (sid,)).fetchall()
    history = []
    for r in rows:
        p = db.jloads(r["payload"], {})
        history.append({"q": p.get("followup", ""), "a": ""})
    fb = llm_mod.feynman_feedback(s["question"], explanation, history)
    log_event(sid, user_id, "explanation",
              {"text": explanation[:2000], "build_score": analysis["build_score"]})
    log_event(sid, user_id, "ai_feedback",
              {"feedback": fb["feedback"], "followup": fb.get("followup", ""),
               "llm": fb.get("llm", False)})
    _set_status(sid, "feynman")
    return {"feedback": fb["feedback"], "followup": fb.get("followup", ""),
            "build_score": analysis["build_score"],
            "llm": fb.get("llm", False),
            "can_finish": True,
            "hint": "覺得講清楚了就可以「完成戰役」授勳；還想再練可以繼續追問。"}


def _rarity_with_debate_bonus(depth: int, debate_score: float | None) -> str:
    """稀有度：基礎看深度；辯論最高懷疑度平均>=0.8 升一階（上限傳說）。"""
    rarities = ["普通", "稀有", "史詩", "傳說"]
    idx = min(3, depth - 1 if depth >= 1 else 0)
    if debate_score is not None and debate_score >= PERFECT_THRESHOLD:
        idx = min(3, idx + 1)
    return rarities[idx]


def finish_session(sid: str, user_id: str, badge_name: str = "",
                   debate_score: float | None = None) -> dict:
    """授勳：鍛造技能章（=武器）＋更新掌握度＋完成會話。
    debate_score：辯論最高懷疑度平均（0-1），>=0.8 稀有度升一階。"""
    s = _own_session(sid, user_id)
    if s["status"] == "done":
        raise ValueError("這場戰役已經結束了。")
    # 取建構度
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM learn_events WHERE session_id = ? AND kind = 'explanation'"
            " ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
    build_score = db.jloads(row["payload"], {}).get("build_score", 0.3) if row else 0.3
    # 掌握度再推一次（完成整場戰役視為一次有效學習）
    mastery = _update_mastery(user_id, s["topic"], True)
    # 技能章命名
    named = llm_mod.name_skill_badge(s["question"], s["topic"], s["depth_level"],
                                     build_score)
    name = (badge_name or "").strip()[:12] or named["name"]
    # 數值：基礎 10 ＋ 深度×6 ＋ 掌握度×20 ＋ 建構度×15
    attack = int(10 + s["depth_level"] * 6 + mastery * 20 + build_score * 15)
    defense = int(10 + s["depth_level"] * 4 + mastery * 15 + build_score * 10)
    rarity = _rarity_with_debate_bonus(s["depth_level"], debate_score)
    archetype, tags = classify_badge(attack, defense, 0.2, rarity)
    tags_json = json.dumps(tags, ensure_ascii=False)
    bid = "bd_" + uuid.uuid4().hex[:12]
    with db.get_conn() as conn:
        conn.execute(
            "INSERT INTO skill_badges (id, user_id, session_id, name, topic, depth,"
            " attack, defense, rarity, ai_comment, bond, archetype, tags)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.2, ?, ?)",
            (bid, user_id, sid, name, s["topic"], s["depth_level"],
             attack, defense, rarity, named["ai_comment"][:120],
             archetype, tags_json),
        )
        conn.execute(
            "UPDATE topic_mastery SET sessions_count = sessions_count + 1"
            " WHERE user_id = ? AND topic = ?", (user_id, s["topic"]))
        conn.execute(
            "UPDATE learn_sessions SET status = 'done', completed_at = "
            + ("NOW()" if db.is_postgres() else "datetime('now')")
            + " WHERE id = ?", (sid,))
        conn.execute(
            "INSERT INTO learn_events (session_id, kind, payload) VALUES (?, 'badge', ?)",
            (sid, json.dumps({"badge_id": bid, "name": name, "attack": attack,
                              "defense": defense, "rarity": rarity,
                              "archetype": archetype, "tags": tags,
                              "debate_score": debate_score},
                             ensure_ascii=False)))
        conn.commit()
    return {"badge": {"id": bid, "name": name, "topic": s["topic"],
                      "depth": s["depth_level"], "attack": attack, "defense": defense,
                      "rarity": rarity, "ai_comment": named["ai_comment"],
                      "bond": 0.2, "archetype": archetype, "tags": tags},
            "mastery": round(mastery, 3), "mastered": mastery >= MASTERY_THRESHOLD,
            "llm": named.get("llm", False)}


def list_badges(user_id: str) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM skill_badges WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,)).fetchall()
    out = []
    for r in rows:
        d = _row_to_dict(r)
        d["tags"] = db.jloads(d.get("tags", "[]"), [])
        out.append(d)
    return out


def get_mastery(user_id: str) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT topic, mastery, sessions_count, last_at FROM topic_mastery"
            " WHERE user_id = ? ORDER BY mastery DESC", (user_id,)).fetchall()
    return [_row_to_dict(r) for r in rows]


def textbook_chapters(user_id: str) -> list[dict]:
    """課本筆記章節：每次完整戰役 → 一章（他的話為主）。"""
    with db.get_conn() as conn:
        sessions = conn.execute(
            "SELECT * FROM learn_sessions WHERE user_id = ? AND status = 'done'"
            " ORDER BY completed_at DESC", (user_id,)).fetchall()
        out = []
        for s in sessions:
            sd = _row_to_dict(s)
            events = conn.execute(
                "SELECT kind, payload FROM learn_events WHERE session_id = ? ORDER BY id",
                (s["id"],)).fetchall()
            ch = {"session_id": s["id"], "question": s["question"],
                  "topic": s["topic"], "depth": s["depth_level"],
                  "grade_band": s["grade_band"], "completed_at": s["completed_at"],
                  "hypothesis": "", "explanation": "", "ai_feedback": "",
                  "quiz_score": "", "badge": None}
            for e in events:
                p = db.jloads(e["payload"], {})
                if e["kind"] == "hypothesis":
                    ch["hypothesis"] = p.get("text", "")
                elif e["kind"] == "explanation":
                    ch["explanation"] = p.get("text", "")
                elif e["kind"] == "ai_feedback":
                    ch["ai_feedback"] = (p.get("feedback", "") + " " +
                                         p.get("followup", "")).strip()
                elif e["kind"] == "quiz_answer":
                    ch["quiz_score"] = f"{p.get('correct_count', 0)}/{p.get('total', 0)}"
                elif e["kind"] == "badge":
                    ch["badge"] = {"name": p.get("name"), "attack": p.get("attack"),
                                   "defense": p.get("defense"), "rarity": p.get("rarity")}
            out.append(ch)
    return out


# ---------------- 費曼辯論：動態 1-3 輪 ----------------
# v2 設計：R1 解釋→AI 挑戰；R2 反駁→AI 評判；R3（可選）終局陳述。
# 辯論狀態存在 learn_events（kind='debate_round'）。

DEBATE_MIN_LEN = 15
TAUNT = "這不是你自己理解的話吧？用自己的話再講一次，我等你。"
PERFECT_THRESHOLD = 0.8


def _suspicion_state(avg: float) -> str:
    """懷疑度狀態映射（明示為即時估計，非考試分數）。"""
    if avg < 0.35:
        return "破綻百出"
    if avg < 0.7:
        return "逐漸穩固"
    return "完美防禦"


def _suspicion_avg(s: dict) -> float:
    return round((float(s.get("clarity", 0)) + float(s.get("examples", 0))
                  + float(s.get("logic", 0))) / 3, 3)


def _overlap_ratio(src: str, text: str) -> float:
    a = {c for c in (src or "") if c.strip() and c not in "，。！？、；：「」『』（） \t\n"}
    if not a:
        return 0.0
    b = set(text or "")
    return len(a & b) / len(a)


def _looks_copied(question: str, text: str, extra: str = "") -> bool:
    """複製貼上偵測：題目（或上一輪挑戰）被大段原樣貼上。"""
    t = "".join((text or "").split())
    for src in (question, extra):
        s = "".join((src or "").split())
        if len(s) >= 10 and s[:12] in t:
            return True
        if len(s) >= 10 and len(t) >= 10 and _overlap_ratio(s, t) > 0.75:
            return True
    return False


def _check_debate_input(question: str, text: str, extra: str = "") -> dict | None:
    """防刷分：通過回傳 None；複製貼上回傳嘲諷（不計分）；太短拋 400。"""
    text = (text or "").strip()
    if len(text) < DEBATE_MIN_LEN:
        raise ValueError(f"再多講一點——至少 {DEBATE_MIN_LEN} 個字，讓 AI 看得出你的思路。")
    if _looks_copied(question, text, extra):
        return {"round": 0, "scored": False, "taunt": TAUNT}
    return None


def _debate_history(sid: str) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT payload FROM learn_events WHERE session_id = ? AND kind = 'debate_round'"
            " ORDER BY id DESC LIMIT 6", (sid,)).fetchall()
    return [db.jloads(r["payload"], {}) for r in rows]


def _last_debate_row(sid: str):
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT id, payload FROM learn_events WHERE session_id = ? AND kind = 'debate_round'"
            " ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
    if not row:
        return None, None
    return row["id"], db.jloads(row["payload"], {})


def _update_last_debate_event(sid: str, patch: dict) -> None:
    eid, payload = _last_debate_row(sid)
    if eid is None:
        raise ValueError("找不到辯論紀錄。")
    payload.update(patch)
    with db.get_conn() as conn:
        conn.execute("UPDATE learn_events SET payload = ? WHERE id = ?",
                     (json.dumps(payload, ensure_ascii=False), eid))
        conn.commit()


def _best_debate_avg(sid: str) -> float | None:
    """辯論歷程中的最高懷疑度平均（影響授勳稀有度加成）。"""
    avgs = [h.get("avg") for h in _debate_history(sid)]
    avgs = [a for a in avgs if isinstance(a, (int, float))]
    return max(avgs) if avgs else None


def _public_suspicion(suspicion: dict) -> dict:
    avg = _suspicion_avg(suspicion)
    return {"clarity": suspicion.get("clarity", 0),
            "examples": suspicion.get("examples", 0),
            "logic": suspicion.get("logic", 0),
            "avg": avg, "state": _suspicion_state(avg),
            "note": "即時估計，非考試分數"}


def debate_start(sid: str, user_id: str, explanation: str) -> dict:
    """辯論開戰 R1：用戶解釋 → AI 找出最強漏洞挑戰。
    懷疑度平均>=0.8 直接完美通關授勳，不硬拖。"""
    s = _own_session(sid, user_id)
    if s["status"] == "done":
        raise ValueError("這場戰役已經結束了。")
    if s["status"] not in ("quiz", "feynman", "debate"):
        raise ValueError("請先完成穿插測驗，再來挑戰 AI。")
    _, last = _last_debate_row(sid)
    if last:
        raise ValueError("辯論已經開戰了——請繼續回應，或暫停挑戰。")
    taunt = _check_debate_input(s["question"], explanation)
    if taunt:
        return taunt
    explanation = explanation.strip()
    # 補 explanation 事件：finish_session 的 build_score 靠它計算武器數值
    analysis = llm_mod.analyze_explanation(explanation)
    log_event(sid, user_id, "explanation",
              {"text": explanation[:2000],
               "build_score": analysis.get("build_score", 0.3)})
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT payload FROM learn_events WHERE session_id = ? AND kind = 'ai_feedback'"
            " ORDER BY id DESC LIMIT 3", (sid,)).fetchall()
    history = [{"q": db.jloads(r["payload"], {}).get("followup", ""), "a": ""}
               for r in rows]
    fb = llm_mod.feynman_feedback(s["question"], explanation, history)
    ch = llm_mod.debate_challenge(s["question"], explanation, fb)
    avg = _suspicion_avg(ch["suspicion"])
    log_event(sid, user_id, "debate_round",
              {"round": 1, "explanation": explanation[:500],
               "feedback": fb["feedback"][:500],
               "challenge": ch["challenge"], "suspicion": ch["suspicion"],
               "state": _suspicion_state(avg), "avg": avg,
               "verdict": "pending", "llm": ch["llm"]})
    _set_status(sid, "debate")
    base = {"round": 1, "challenge": ch["challenge"],
            "suspicion": _public_suspicion(ch["suspicion"]),
            "llm": ch["llm"], "can_continue": True}
    if avg >= PERFECT_THRESHOLD:
        base["perfect"] = True
        base["verdict_text"] = "完美通關"
        base["finish"] = finish_session(sid, user_id, debate_score=avg)
    else:
        base["perfect"] = False
    return base


def debate_respond(sid: str, user_id: str, text: str) -> dict:
    """回應上一輪挑戰：AI 評判 → 堵住（可選 R3）／追擊（R+1）／終局。"""
    s = _own_session(sid, user_id)
    if s["status"] == "done":
        raise ValueError("這場戰役已經結束了。")
    _, last = _last_debate_row(sid)
    if not last:
        raise ValueError("辯論還沒開戰，請先呼叫 debate/start。")
    n = int(last.get("round", 1))
    verdict_prev = last.get("verdict", "pending")
    text = (text or "").strip()
    taunt = _check_debate_input(s["question"], text, last.get("challenge", ""))
    if taunt:
        return taunt
    if verdict_prev == "blocked" and n < 3:
        # R3（可選）：AI 總結雙方論點 → 用戶最後陳述一句 → 終局判定
        history = _debate_history(sid)
        summary = llm_mod.debate_summary(s["question"], [
            {"round": h.get("round"), "challenge": h.get("challenge", ""),
             "response": h.get("response", ""), "verdict": h.get("verdict", "")}
            for h in reversed(history)])
        judge = llm_mod.debate_judge(s["question"], summary, text)
        log_event(sid, user_id, "debate_round",
                  {"round": 3, "summary": summary[:500],
                   "response": text[:500], "verdict": judge["verdict"],
                   "judge_note": judge["judge_note"],
                   "suspicion": judge["suspicion"],
                   "state": _suspicion_state(_suspicion_avg(judge["suspicion"])),
                   "avg": _suspicion_avg(judge["suspicion"]),
                   "llm": judge["llm"]})
        return _debate_final(sid, user_id, judge, n=3)
    if verdict_prev != "pending":
        raise ValueError("這一輪已經評判過了——可暫停挑戰直接授勳。")
    judge = llm_mod.debate_judge(s["question"], last["challenge"], text)
    verdict = judge["verdict"]
    avg = _suspicion_avg(judge["suspicion"])
    _update_last_debate_event(sid, {
        "response": text[:500], "verdict": verdict,
        "judge_note": judge["judge_note"], "suspicion": judge["suspicion"],
        "state": _suspicion_state(avg), "avg": avg})
    public = {"round": n, "verdict": verdict,
              "suspicion": _public_suspicion(judge["suspicion"]),
              "judge_note": judge["judge_note"], "llm": judge["llm"]}
    if verdict == "blocked" and avg >= PERFECT_THRESHOLD:
        public["perfect"] = True
        public["verdict_text"] = "完美通關"
        public["finish"] = finish_session(sid, user_id,
                                          debate_score=_best_debate_avg(sid))
        return public
    if verdict == "blocked":
        if n >= 3:
            return _debate_final(sid, user_id, judge, n=3)
        public["next_round"] = 3
        public["optional"] = True
        public["can_continue"] = True
        public["hint"] = "漏洞堵住了！可選擇「深入追擊」進 R3 終局，或暫停挑戰直接授勳。"
        return public
    # evaded / partial → AI 追擊
    if n >= 3:
        return _debate_final(sid, user_id, judge, n=3)
    ch = llm_mod.debate_challenge(s["question"], text,
                                  {"feedback": judge["judge_note"]})
    log_event(sid, user_id, "debate_round",
              {"round": n + 1, "challenge": ch["challenge"],
               "verdict": "pending", "llm": ch["llm"]})
    public.update({"round": n + 1, "challenge": ch["challenge"],
                   "can_continue": True,
                   "hint": "AI 追擊——漏洞還沒堵住，再想想。"})
    return public


def debate_appeal(sid: str, user_id: str) -> dict:
    """申訴：對上一輪已評判結果重判一次（每輪限一次）。v2：判定可申訴一次。"""
    s = _own_session(sid, user_id)
    if s["status"] == "done":
        raise ValueError("這場戰役已經結束了。")
    _, last = _last_debate_row(sid)
    if not last or last.get("verdict") in (None, "pending", "conceded"):
        raise ValueError("還沒有可申訴的判定。")
    n = int(last.get("round", 1))
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT payload FROM learn_events WHERE session_id = ? AND kind = 'debate_appeal'",
            (sid,)).fetchall()
    if any(db.jloads(r["payload"], {}).get("round") == n for r in rows):
        raise ValueError("這一輪已經申訴過了。")
    challenge = last.get("challenge") or last.get("summary", "")
    response = last.get("response") or last.get("explanation", "")
    judge = llm_mod.debate_judge(s["question"], challenge, response)
    verdict = judge["verdict"]
    avg = _suspicion_avg(judge["suspicion"])
    _update_last_debate_event(sid, {
        "verdict": verdict, "appealed": True,
        "judge_note": judge["judge_note"], "suspicion": judge["suspicion"],
        "state": _suspicion_state(avg), "avg": avg})
    log_event(sid, user_id, "debate_appeal", {"round": n})
    public = {"round": n, "verdict": verdict, "appealed": True,
              "suspicion": _public_suspicion(judge["suspicion"]),
              "judge_note": judge["judge_note"], "llm": judge["llm"]}
    if verdict == "blocked" and avg >= PERFECT_THRESHOLD:
        public["perfect"] = True
        public["verdict_text"] = "完美通關"
        public["finish"] = finish_session(sid, user_id,
                                          debate_score=_best_debate_avg(sid))
    elif verdict == "blocked" and n < 3:
        public["next_round"] = 3
        public["optional"] = True
        public["can_continue"] = True
        public["hint"] = "申訴成功——漏洞堵住了！可選擇「深入追擊」進 R3 終局，或暫停挑戰直接授勳。"
    else:
        public["hint"] = "重判維持原判——再想想，或暫停挑戰。"
        public["can_continue"] = True
    return public


def _debate_final(sid: str, user_id: str, judge: dict, n: int) -> dict:
    """終局：授勳結算。verdict → 說服成功／部分說服／再練練。"""
    verdict = judge["verdict"]
    final_text = {"blocked": "說服成功", "partial": "部分說服"}.get(verdict, "再練練")
    fin = finish_session(sid, user_id, debate_score=_best_debate_avg(sid))
    return {"round": n, "verdict": verdict, "verdict_text": final_text,
            "suspicion": _public_suspicion(judge["suspicion"]),
            "judge_note": judge["judge_note"], "llm": judge["llm"],
            "finish": fin}


def _daily_debate_capped(user_id: str, topic: str) -> bool:
    """同一 topic 當日完成數 ≥2 → 獎勵封頂（只給回饋不給分）。"""
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM learn_sessions WHERE user_id = ? AND topic = ?"
            f" AND status = 'done' AND {db.date_col_eq_today('completed_at')}",
            (user_id, topic)).fetchone()
    return (row["n"] if row else 0) >= 2


def debate_concede(sid: str, user_id: str) -> dict:
    """暫停挑戰：按已完成輪數給參與獎（每日同 topic 上限 2 次），授勳結算。"""
    s = _own_session(sid, user_id)
    if s["status"] == "done":
        raise ValueError("這場戰役已經結束了。")
    rounds = _debate_history(sid)
    if not rounds:
        raise ValueError("辯論還沒開戰，沒有什麼好暫停的。")
    # 已完成輪數：用戶有提交內容的輪（R1 解釋即算參與；v2：完成 R1 即給參與獎）
    completed = sum(1 for r in rounds
                    if isinstance(r.get("round"), int)
                    and (r.get("explanation") or r.get("response")))
    best = _best_debate_avg(sid)
    capped = _daily_debate_capped(user_id, s["topic"])
    award = 0
    if not capped and completed > 0:
        from app import economy
        award = completed * 10
        economy.earn(user_id, award, f"辯論參與獎（{completed} 輪）")
    fin = finish_session(sid, user_id, debate_score=best)
    log_event(sid, user_id, "debate_round",
              {"round": "concede", "verdict": "conceded",
               "completed_rounds": completed, "participation_award": award,
               "reward_capped": capped})
    return {"participation": True, "completed_rounds": completed,
            "award_starsand": award, "reward_capped": capped,
            "best_suspicion_avg": best, "finish": fin,
            "note": "暫停挑戰——費曼的核心是發現盲點，不是輸贏。"}


# ---------------- 武器分類＋標籤 ----------------

ARCHETYPES = ("攻擊型", "防禦型", "輔助型", "經濟型")


def classify_badge(attack: int, defense: int, bond: float,
                   rarity: str = "普通") -> tuple[str, list[str]]:
    """武器主分類＋標籤。
    主分類：bond>=0.7 且稀有度>=稀有 → 經濟型；否則 attack／defense／bond*100 取最高。
    標籤（可多個）：史詩以上→連擊；bond>=0.6→續航；attack>=40→吸血；defense>=40→自動觸發。"""
    attack, defense = int(attack), int(defense)
    bond = float(bond or 0)
    if bond >= 0.7 and rarity in ("稀有", "史詩", "傳說"):
        arch = "經濟型"
    else:
        dims = {"攻擊型": attack, "防禦型": defense, "輔助型": bond * 100}
        arch = max(dims, key=lambda k: dims[k])
    tags = []
    if rarity in ("史詩", "傳說"):
        tags.append("連擊")
    if bond >= 0.6:
        tags.append("續航")
    if attack >= 40:
        tags.append("吸血")
    if defense >= 40:
        tags.append("自動觸發")
    return arch, tags


def backfill_badge_taxonomy() -> int:
    """回填舊武器的 archetype/tags（冪等）。回傳回填數。"""
    n = 0
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT id, attack, defense, bond, rarity FROM skill_badges"
            " WHERE archetype = '' OR archetype IS NULL").fetchall()
        for r in rows:
            arch, tags = classify_badge(r["attack"], r["defense"],
                                        r["bond"], r["rarity"])
            conn.execute("UPDATE skill_badges SET archetype = ?, tags = ? WHERE id = ?",
                         (arch, json.dumps(tags, ensure_ascii=False), r["id"]))
            n += 1
        conn.commit()
    return n
