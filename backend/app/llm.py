"""LLM 可插拔層：費曼糾錯、測驗生成、劇情生成、技能章命名。

Provider 選擇：
- 有 NVIDIA Build API key（環境變數 NVIDIA_API_KEY）→ 呼叫 NIM（OpenAI 相容）
- 無 key → 規則式降級（引導式模板＋關鍵字檢查），功能照跑、聰明度打折

設計約束（論文依據）：
- MathTutorBench (2025)：用系統規則壓住模型的解題衝動
- Khan (2023)：先內部診斷再開口；不直接給答案
- Zhang et al. (2025)：追問難度動態對齊
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request

NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
# 預設模型：2026-10-10 實測可用（免費 key）。gpt-oss-20b 是推理模型，
# 要給足 max_tokens（思考會吃掉額度），content 為 null 時改讀 reasoning_content。
DEFAULT_MODEL = os.environ.get("NIM_MODEL", "openai/gpt-oss-20b")


def _all_keys() -> list[str]:
    """收集所有 NVIDIA key：NVIDIA_API_KEY、NVIDIA_API_KEY_1..9（輪替備援）。"""
    keys = []
    for name in ["NVIDIA_API_KEY"] + [f"NVIDIA_API_KEY_{i}" for i in range(1, 10)]:
        v = (os.environ.get(name) or "").strip()
        if v and v not in keys:
            keys.append(v)
    return keys


def has_llm() -> bool:
    return bool(_all_keys())


# 多 key 分流狀態：key -> {"invalid": bool, "cool_until": timestamp}
# invalid = 401/403（key 壞了，本次進程不再用）
# cool_until = 429（被限流，冷卻 N 秒後再用）
_key_state: dict[str, dict] = {}
_rr_index = 0
_COOLDOWN_S = 60


def diagnose_keys() -> list[dict]:
    """診斷每把 key 的狀態（不回傳 key 值）。打輕量 models 端點驗證。
    回傳 [{"index": 1, "status": "ok"|"unauthorized"|"rate_limited"|"timeout"|"error", "ms": int}]"""
    results = []
    keys = _all_keys()
    for i, key in enumerate(keys, 1):
        t0 = time.time()
        req = urllib.request.Request(
            "https://integrate.api.nvidia.com/v1/models",
            headers={"Authorization": f"Bearer {key}"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                resp.read(1024)
            status = "ok" if resp.status == 200 else "error"
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                status = "unauthorized"
            elif e.code == 429:
                status = "rate_limited"
            else:
                status = f"http_{e.code}"
        except Exception as e:
            status = "timeout" if "timed out" in str(e).lower() else "error"
        results.append({"index": i, "status": status,
                        "ms": int((time.time() - t0) * 1000)})
    return results


def _nim_call(messages: list[dict], max_tokens: int = 1200,
              temperature: float = 0.7) -> str | None:
    """打 NIM chat completions。多 key 時 round-robin 分流；
    遇到 429 該 key 冷卻 60 秒、401/403 直接淘汰，自動換下一把。
    全部失敗回 None（呼叫端降級為規則式）。"""
    global _rr_index
    keys = _all_keys()
    if not keys:
        return None
    now = time.time()
    usable = [k for k in keys
              if not _key_state.get(k, {}).get("invalid")
              and _key_state.get(k, {}).get("cool_until", 0) <= now]
    pool = usable or keys  # 全在冷卻就硬試
    start = _rr_index % len(pool)
    _rr_index += 1
    ordered = pool[start:] + pool[:start]
    body = json.dumps({
        "model": DEFAULT_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }).encode("utf-8")
    for key in ordered:
        req = urllib.request.Request(
            NIM_URL, data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {key}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            msg = data["choices"][0]["message"]
            text = (msg.get("content") or msg.get("reasoning_content") or "").strip()
            if text:
                return text
        except urllib.error.HTTPError as e:
            if e.code == 429:
                _key_state.setdefault(key, {})["cool_until"] = now + _COOLDOWN_S
            elif e.code in (401, 403):
                _key_state.setdefault(key, {})["invalid"] = True
            continue
        except Exception:
            continue
    return None


# ---------------- 系統 prompt 模板（硬約束） ----------------

_TUTOR_CONSTRAINTS = """硬約束（必須遵守）：
1. 絕不直接給出完整答案或完整解釋，一次輸出不超過 150 字。
2. 永遠以一個追問結尾，引導學生自己想。
3. 先在心裡診斷：學生錯在哪？錯誤類型是事實錯誤／推理斷裂／概念混淆？
4. 語氣是教練不是考官：先具體稱讚一個講得好的點，再指出問題。
5. 全部使用繁體中文。"""


def feynman_feedback(question: str, student_explain: str,
                     history: list[dict] | None = None) -> dict:
    """費曼環節：學生解釋 → AI 糾錯＋追問。回傳 {feedback, followup}。"""
    history = history or []
    if has_llm():
        msgs = [
            {"role": "system",
             "content": "你是一位蘇格拉底式家教。學生正在用費曼學習法向你解釋一個概念，"
                        "試圖說服你他真的懂了。你的工作是檢驗他的理解、追問漏洞。\n" + _TUTOR_CONSTRAINTS},
            {"role": "user",
             "content": f"學生的問題是：{question}\n\n學生的解釋：{student_explain}\n\n"
                        f"請先簡短回應他的解釋（稱讚具體的優點＋指出一個最關鍵的漏洞），"
                        f"然後提出一個追問。"},
        ]
        for h in history[-4:]:
            msgs.append({"role": "user", "content": h.get("q", "")})
            msgs.append({"role": "assistant", "content": h.get("a", "")})
        out = _nim_call(msgs, max_tokens=900)
        if out:
            return {"feedback": out, "followup": "", "llm": True}
    # 規則式降級：結構化引導
    return {
        "feedback": _rule_feedback(student_explain),
        "followup": _rule_followup(question),
        "llm": False,
    }


def _rule_feedback(explain: str) -> str:
    n = len(explain or "")
    if n < 20:
        return ("你的解釋有點短——費曼學習法的重點是「講到別人能聽懂」。"
                "試著多講一點：這個概念的關鍵機制是什麼？為什麼會這樣？")
    has_why = any(w in (explain or "") for w in ("因為", "所以", "導致", "原因", "機制"))
    base = "很好，你願意用自己的話講出來，這本身就是最強的學習（提取練習）。"
    if has_why:
        return base + "我注意到你試著解釋了因果——很棒。接著挑戰：如果有人提出反例，你的解釋還站得住嗎？"
    return base + "不過我還沒看到「為什麼」——試著回答：這背後的機制是什麼？為什麼會這樣而不是那樣？"


def _rule_followup(question: str) -> str:
    return ("追問：如果把這個問題反過來問——「在什麼情況下，答案會完全相反？」"
            "你會怎麼回答？（試著舉一個具體例子）")


def generate_quiz(question: str, topic: str, grade_band: str,
                  depth: int, n: int = 3) -> list[dict]:
    """穿插測驗：生成 n 題選擇題。回傳 [{question, options[4], answer_index, concept}]。"""
    if has_llm():
        msgs = [
            {"role": "system",
             "content": "你是出題助手。為學生的學習問題生成理解型選擇題。"
                        "只輸出 JSON 陣列，每題含 question、options（4個）、answer_index（0-3）、concept（一句話概念）。"
                        "不要出純記憶題，要出需要推理的題。全部繁體中文。\n" + _TUTOR_CONSTRAINTS},
            {"role": "user",
             "content": f"學習問題：{question}\n主題：{topic}\n年級段：{grade_band}\n"
                        f"深度等級：{depth}（1=入門，數字越大越深）\n請出 {n} 題。只回 JSON，不要其他文字。"},
        ]
        out = _nim_call(msgs, max_tokens=1600, temperature=0.5)
        items = _extract_json_arr(out)
        if items:
            return [_norm_quiz(q) for q in items[:n] if isinstance(q, dict)]
    return [_rule_quiz(question, topic, i) for i in range(n)]


def _norm_quiz(q: dict) -> dict:
    opts = q.get("options") or []
    opts = (list(opts) + ["選項A", "選項B", "選項C", "選項D"])[:4]
    ai = q.get("answer_index", 0)
    try:
        ai = max(0, min(3, int(ai)))
    except Exception:
        ai = 0
    return {"question": str(q.get("question", "這題在問什麼？")),
            "options": opts, "answer_index": ai,
            "concept": str(q.get("concept", ""))}


def _rule_quiz(question: str, topic: str, i: int) -> dict:
    templates = [
        ("關於「{q}」，以下哪個說法最接近核心機制？",
         ["需要更多資訊才能判斷", "取決於具體情境", "核心機制是因果鏈而非單一原因", "以上皆非"], 2,
         "複雜現象通常是多因果鏈，不是單一原因。"),
        ("如果有人主張「{q}的答案很簡單」，你會如何回應？",
         ["同意，簡單最好", "要求對方提出證據與反例", "直接反對", "換個話題"], 1,
         "好的主張需要證據，也要經得起反例檢驗。"),
        ("「{t}」這個主題中，最值得追問「為什麼」的是？",
         ["表面現象", "背後的機制與條件", "名詞定義", "誰先發現的"], 1,
         "機制性問題（為什麼）比事實性問題（是什麼）更能促進深層理解。"),
    ]
    t = templates[i % len(templates)]
    return {"question": t[0].format(q=question[:30], t=topic or "這個主題"),
            "options": t[1], "answer_index": t[2], "concept": t[3]}


def name_skill_badge(question: str, topic: str, depth: int,
                     build_score: float) -> dict:
    """技能章命名。回傳 {name, rarity, ai_comment}。"""
    rarities = ["普通", "稀有", "史詩", "傳說"]
    rarity = rarities[min(3, depth - 1 if depth >= 1 else 0)]
    if has_llm():
        msgs = [
            {"role": "system",
             "content": "你是遊戲命名師。為學生的學習成果命名一枚技能章（武器名），"
                        "風格是史詩奇幻＋知識感，8字以內，繁體中文。只回 JSON："
                        '{"name":"…","ai_comment":"一句具體的稱讚（30字內，針對他的學習表現）"}。'},
            {"role": "user",
             "content": f"學習問題：{question}\n主題：{topic}\n深度：Lv{depth}\n"
                        f"請命名並寫一句評語。只回 JSON。"},
        ]
        out = _nim_call(msgs, max_tokens=700, temperature=0.9)
        d = _extract_json_obj(out)
        if d:
            name = str(d.get("name", ""))[:12] or _rule_badge_name(topic, depth)
            return {"name": name, "rarity": rarity,
                    "ai_comment": str(d.get("ai_comment", ""))[:60], "llm": True}
    return {"name": _rule_badge_name(topic, depth), "rarity": rarity,
            "ai_comment": _rule_comment(build_score), "llm": False}


def _rule_badge_name(topic: str, depth: int) -> str:
    cores = ["之刃", "之盾", "之鑰", "之眼", "之心"]
    t = (topic or "未知").strip()[:4]
    return f"{t}{cores[depth % len(cores)]}"


def _rule_comment(build_score: float) -> str:
    if build_score >= 0.7:
        return "你的解釋出現了因果推理與自我修正——這是知識建構的標誌。"
    if build_score >= 0.4:
        return "你開始用自己的話組織概念了，下一步試著回答「為什麼」。"
    return "願意開口解釋就是好的開始，下次試著講出背後的機制。"


def analyze_explanation(explain: str) -> dict:
    """分析學生解釋的「知識建構度」（Roscoe & Chi, 2007）。
    回傳 {build_score 0-1, signals}。規則式即可，不需 LLM。"""
    text = explain or ""
    signals = {
        "causal": sum(text.count(w) for w in ("因為", "所以", "導致", "因此", "造成")),
        "contrast": sum(text.count(w) for w in ("但是", "然而", "相反", "不過", "反而")),
        "analogy": sum(text.count(w) for w in ("就像", "好比", "類似", "如同", "譬如")),
        "self_fix": sum(text.count(w) for w in ("其實", "換句話說", "更準確地說", "修正")),
        "length": len(text),
    }
    score = 0.0
    score += min(0.3, signals["causal"] * 0.1)
    score += min(0.25, signals["contrast"] * 0.12)
    score += min(0.2, signals["analogy"] * 0.2)
    score += min(0.15, signals["self_fix"] * 0.15)
    score += min(0.1, signals["length"] / 2000)
    return {"build_score": round(min(1.0, score), 3), "signals": signals}


# ---------------- 費曼辯論 ----------------

def _scan_json_blocks(text: str) -> list[str]:
    """平衡括號掃描：找出所有頂層 JSON 區塊（{} 或 []）。
    推理模型（gpt-oss）會先輸出長串思考過程，舊的 find/rfind 硬切會被
    思考過程裡的括號搞爛。這裡正確配對括號（字串內的括號不算），
    並先去掉 markdown fence。"""
    t = re.sub(r"```[a-zA-Z]*", "", text or "")
    blocks: list[str] = []
    stack: list[str] = []
    start = -1
    in_str = False
    esc = False
    pairs = {"}": "{", "]": "["}
    for i, ch in enumerate(t):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            if not stack:
                start = i
            stack.append(ch)
        elif ch in "}]":
            if stack and stack[-1] == pairs[ch]:
                stack.pop()
                if not stack and start >= 0:
                    blocks.append(t[start:i + 1])
                    start = -1
    return blocks


def _extract_json_obj(text: str | None) -> dict | None:
    """從模型輸出中擷取 JSON 物件（由後往前試，答案通常在最後）。"""
    if not text:
        return None
    for b in reversed(_scan_json_blocks(text)):
        try:
            d = json.loads(b)
            if isinstance(d, dict):
                return d
        except Exception:
            continue
    return None


def _extract_json_arr(text: str | None) -> list | None:
    """從模型輸出中擷取 JSON 陣列（由後往前試，答案通常在最後）。"""
    if not text:
        return None
    for b in reversed(_scan_json_blocks(text)):
        try:
            d = json.loads(b)
            if isinstance(d, list):
                return d
        except Exception:
            continue
    return None


def _rule_suspicion(explain: str) -> dict:
    """規則式懷疑度三維度（0-1，越高＝論點防禦越好）。
    clarity 論點清晰度：長度＋自我修正；examples 舉例適切性：類比＋舉例詞；
    logic 邏輯嚴密性：建構度分數。"""
    text = explain or ""
    analysis = analyze_explanation(text)
    sig = analysis["signals"]
    example_kw = ("例如", "譬如", "舉例", "比如", "比方")
    clarity = 0.25 + min(0.5, len(text) / 300) + min(0.25, sig["self_fix"] * 0.12)
    examples = min(1.0, sig["analogy"] * 0.4 +
                   sum(text.count(w) for w in example_kw) * 0.3)
    logic = min(1.0, analysis["build_score"] + sig["causal"] * 0.03)
    return {"clarity": round(min(1.0, clarity), 3),
            "examples": round(examples, 3),
            "logic": round(min(1.0, logic), 3)}


def _norm_suspicion(d: dict) -> dict:
    def _f(v):
        try:
            return round(max(0.0, min(1.0, float(v))), 3)
        except Exception:
            return 0.5
    return {"clarity": _f(d.get("clarity")), "examples": _f(d.get("examples")),
            "logic": _f(d.get("logic"))}


def debate_challenge(question: str, explanation: str, feedback) -> dict:
    """把 AI 回饋轉成「最強漏洞挑戰」。
    回傳 {challenge, suspicion: {clarity, examples, logic}, llm}。"""
    fb_text = (feedback.get("feedback", "") if isinstance(feedback, dict)
               else str(feedback or ""))
    if has_llm():
        msgs = [
            {"role": "system",
             "content": "你是辯論教練。只回 JSON：{\"challenge\": "
                        "\"針對學生解釋中最強的一個漏洞發起的挑戰質問（100字內，繁體中文，"
                        "語氣像對手不像老師）\", \"clarity\": 0-1論點清晰度, "
                        "\"examples\": 0-1舉例適切性, \"logic\": 0-1邏輯嚴密性}。"
                        "分數是即時估計，不是考試分數。"},
            {"role": "user",
             "content": f"學習問題：{question}\n學生解釋：{explanation[:800]}"
                        f"\nAI回饋：{fb_text[:800]}"},
        ]
        d = _extract_json_obj(_nim_call(msgs, max_tokens=800, temperature=0.6))
        if d and d.get("challenge"):
            return {"challenge": str(d["challenge"])[:300],
                    "suspicion": _norm_suspicion(d), "llm": True}
    # 規則式降級：取回饋中的第一個漏洞句，否則用追問模板
    challenge = _first_vulnerability(fb_text) or _rule_followup(question)
    return {"challenge": challenge,
            "suspicion": _rule_suspicion(explanation), "llm": False}


def _first_vulnerability(fb_text: str) -> str:
    """從回饋文字中擷取第一個像「漏洞」的句子（簡易規則）。"""
    text = (fb_text or "")
    for sep in ("！", "？", "\n"):
        text = text.replace(sep, "。")
    for sent in text.split("。"):
        s = sent.strip()
        if len(s) >= 12 and any(w in s for w in
                                ("但是", "不過", "漏洞", "問題", "反例", "如果",
                                 "為什麼", "真的嗎", "站得住")):
            return s[:150] + "——你怎麼回應這個質疑？"
    return ""


def _bigrams(text: str) -> set:
    """中文 bigram 集合（去標點、去非中文）。"""
    import re
    t = re.sub(r"[^\u4e00-\u9fff]", "", text or "")
    return {t[i:i + 2] for i in range(len(t) - 1)}


def debate_judge(question: str, challenge: str, response: str) -> dict:
    """評判用戶是否堵住了上一輪的漏洞。
    回傳 {verdict: blocked/evaded/partial, suspicion, judge_note, llm}。"""
    if has_llm():
        msgs = [
            {"role": "system",
             "content": "你是辯論裁判。判斷學生的回應是否堵住了挑戰中的漏洞。只回 JSON："
                        "{\"verdict\": \"blocked|evaded|partial\", \"clarity\": 0-1, "
                        "\"examples\": 0-1, \"logic\": 0-1, "
                        "\"judge_note\": \"一句裁判評語（40字內，繁體中文）\"}。"
                        "blocked=正面回應並補上論據；evaded=閃躲、答非所問；"
                        "partial=有回應但論據不足。分數是即時估計。"},
            {"role": "user",
             "content": f"學習問題：{question}\n上一輪挑戰：{challenge}"
                        f"\n學生回應：{response[:800]}"},
        ]
        d = _extract_json_obj(_nim_call(msgs, max_tokens=700, temperature=0.4))
        if d and d.get("verdict") in ("blocked", "evaded", "partial"):
            return {"verdict": d["verdict"],
                    "suspicion": _norm_suspicion(d),
                    "judge_note": str(d.get("judge_note", ""))[:80],
                    "llm": True}
    verdict = _rule_judge(challenge, response)
    return {"verdict": verdict,
            "suspicion": _rule_suspicion(response),
            "judge_note": _rule_judge_note(verdict), "llm": False}


def _rule_judge(challenge: str, response: str) -> str:
    """規則式評判：回應是否沾到挑戰的關鍵 bigram＋有無論證訊號。"""
    ch, rp = _bigrams(challenge), _bigrams(response)
    overlap = len(ch & rp) / max(1, len(ch))
    causal = any(w in response for w in
                 ("因為", "所以", "因此", "導致", "例如", "譬如", "舉例來說"))
    if overlap >= 0.2 and causal:
        return "blocked"
    if overlap >= 0.08 or causal:
        return "partial"
    return "evaded"


def _rule_judge_note(verdict: str) -> str:
    return {"blocked": "正面迎戰，漏洞補上了。",
            "partial": "有回應到，但論據還可以更紮實。",
            "evaded": "好像閃掉了關鍵質疑——直球對決試試？"}[verdict]


def debate_summary(question: str, rounds: list[dict]) -> str:
    """R3 用：AI 總結雙方論點，邀請用戶最後陳述一句。"""
    if has_llm():
        trail = "\n".join(
            f"第{r['round']}輪：挑戰「{r.get('challenge', '')[:120]}」→ "
            f"回應「{r.get('response', '')[:120]}」（{r.get('verdict', '')}）"
            for r in rounds)
        msgs = [
            {"role": "system",
             "content": "你是辯論主持人。用 120 字內總結這場辯論雙方的論點交鋒（繁體中文），"
                        "最後邀請學生用一句話做最終陳述。不要評價輸贏。"},
            {"role": "user", "content": f"學習問題：{question}\n{trail}"},
        ]
        out = _nim_call(msgs, max_tokens=600, temperature=0.5)
        if out:
            return out[:400]
    # 規則式降級
    n = len(rounds)
    return (f"這場辯論走了 {n} 輪：AI 質疑了你的論點漏洞，你逐一回應。現在請用一句話"
            f"做最終陳述——如果只能留一句話給後來的人，你會怎麼總結「{question[:30]}」？")
