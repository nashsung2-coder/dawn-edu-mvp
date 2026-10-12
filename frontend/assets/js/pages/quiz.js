/* 費曼戰役：開戰 → 穿插測驗(摸底) → 費曼解釋(AI糾錯) → 辯論攻防 → 授勳
 * v4.0：直連 Cloudflare Worker（NVIDIA NIM）+ Supabase，不再經 Render 後端
 * 生命週期：init → landing → quiz → feynman → debate → badge
 */
import { chat } from "../core/llm.js";
import { isLoggedIn } from "../core/auth.js";
import { supabase } from "../core/supabase.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("q-view");
const userline = document.getElementById("q-userline");

/* ---------- 狀態 ---------- */
let S = null; // 戰役狀態

function newBattle(question, hypothesis) {
  return {
    question,
    hypothesis: hypothesis || "",
    quizQuestions: [],
    quizAnswers: [],
    quizScore: 0,
    explanation: "",
    feynmanScore: 0,
    feynmanFeedback: "",
    debateRounds: [],
    badge: null,
    startedAt: new Date().toISOString(),
  };
}

/* ---------- 工具 ---------- */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function extractJson(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}") + 1;
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end));
  } catch (e) {}
  return null;
}
function extractJsonArr(text) {
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]") + 1;
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end));
  } catch (e) {}
  return null;
}
function skeleton(msg) {
  view.innerHTML = `<div style="text-align:center;padding:40px 20px">`
    + `<div style="font-size:40px;margin-bottom:16px;animation:pulse 1.5s infinite">🤖</div>`
    + `<p style="font-size:16px;font-weight:600;margin:0 0 8px">${escapeHtml(msg || "AI 正在出題，請稍候…")}</p>`
    + `<p style="font-size:13px;color:var(--muted);margin:0">通常需要 5-15 秒，請不要關閉頁面</p>`
    + `</div>`
    + `<style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}</style>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="燈籠插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="q-retry">重試</button></div>`;
  document.getElementById("q-retry").onclick = retry;
}
function phaseBar(step) {
  const phases = ["開戰", "穿插測驗", "費曼解釋", "辯論攻防", "授勳"];
  return `<div class="q-phases" role="list" aria-label="戰役進度">` +
    phases.map((p, i) =>
      `<span role="listitem" class="q-phase ${i < step ? "done" : i === step ? "now" : ""}">${p}</span>`
    ).join("") + `</div>`;
}

/* ---------- LLM：出題 ---------- */
async function generateQuiz(question) {
  const out = await chat([
    { role: "system", content:
      "你是出題助手。為學生的學習問題生成理解型選擇題。" +
      "只輸出 JSON 陣列，每題含 question、options（4個）、answer_index（0-3）、concept（一句話概念）。" +
      "不要出純記憶題，要出需要推理的題。全部繁體中文。" },
    { role: "user", content: `學習問題：${question}\n請出 3 題。只回 JSON，不要其他文字。` },
  ], { temperature: 0.5, maxTokens: 1600 });

  const items = extractJsonArr(out);
  if (items && items.length) {
    return items.slice(0, 3).map(q => ({
      question: String(q.question || "").slice(0, 300),
      options: Array.isArray(q.options) ? q.options.slice(0, 4).map(o => String(o).slice(0, 100)) : [],
      answer_index: Math.min(3, Math.max(0, parseInt(q.answer_index) || 0)),
      concept: String(q.concept || "").slice(0, 100),
    })).filter(q => q.question && q.options.length === 4);
  }
  // 降級：通用推理題
  return [
    { question: `關於「${question}」，以下哪個說法最需要進一步驗證？`,
      options: ["直接接受表面解釋", "追問背後的因果機制", "只記結論不問為什麼", "找一個例子就夠了"],
      answer_index: 1, concept: "批判性思考：追問機制" },
    { question: `如果要向完全不懂的人解釋「${question}」，最好的策略是？`,
      options: ["背誦定義", "用生活中的比喻和例子", "只講專業術語", "跳過難的部分"],
      answer_index: 1, concept: "費曼技巧：用簡單語言" },
    { question: `檢驗自己是否真的理解「${question}」的最佳方法是？`,
      options: ["重讀筆記三遍", "試著舉出反例並解釋", "把重點畫線", "問同學答案"],
      answer_index: 1, concept: "理解檢驗：反例思考" },
  ];
}

/* ---------- LLM：費曼評估 ---------- */
async function evaluateExplanation(topic, explanation) {
  const out = await chat([
    { role: "system", content:
      "你是嚴格但友善的老師。學生要用自己的話解釋一個概念來說服你。" +
      "評估他的解釋完整度（0-100 分），用繁體中文回應。" +
      "回傳 JSON：{\"score\": 分數, \"feedback\": \"你的評價（100字內）\", " +
      "\"followup\": \"追問（50字內）\", \"missing_points\": [\"缺失要點\"]}。只回 JSON。" },
    { role: "user", content: `主題：${topic}\n學生的解釋：${explanation}` },
  ], { temperature: 0.3, maxTokens: 800 });

  const p = extractJson(out);
  if (p && typeof p.score === "number") return p;
  let score = 40;
  if (explanation.length > 100) score += 10;
  if (explanation.length > 300) score += 10;
  if (/因為|所以|導致/.test(explanation)) score += 10;
  if (/例如|比如|舉例/.test(explanation)) score += 10;
  return { score: Math.min(85, score),
    feedback: "你的解釋有基本架構，但還可以更深入。",
    followup: `關於「${topic}」，你能說說它為什麼會這樣運作嗎？`,
    missing_points: ["因果機制", "具體例子"] };
}

/* ---------- LLM：辯論 ---------- */
async function debateChallenge(question, explanation, feedback) {
  const out = await chat([
    { role: "system", content:
      "你是辯論教練。只回 JSON：{\"challenge\": " +
      "\"針對學生解釋中最強的一個漏洞發起的挑戰質問（100字內，繁體中文，語氣像對手不像老師）\"}。" },
    { role: "user", content: `學習問題：${question}\n學生解釋：${explanation.slice(0, 800)}\nAI回饋：${feedback.slice(0, 800)}` },
  ], { temperature: 0.6, maxTokens: 800 });
  const p = extractJson(out);
  if (p && p.challenge) return p.challenge.slice(0, 300);
  return `你說的聽起來有道理，但是——如果有人提出完全相反的看法，你的解釋還站得住嗎？舉個具體例子說服我。`;
}

async function debateJudge(question, challenge, response) {
  const out = await chat([
    { role: "system", content:
      "你是辯論裁判。判斷學生的回應是否堵住了挑戰中的漏洞。只回 JSON：" +
      "{\"verdict\": \"blocked|evaded|partial\", " +
      "\"judge_note\": \"一句裁判評語（40字內，繁體中文）\"}。" +
      "blocked=正面回應並補上論據；evaded=閃躲、答非所問；partial=有回應但論據不足。" },
    { role: "user", content: `學習問題：${question}\n上一輪挑戰：${challenge}\n學生回應：${response.slice(0, 800)}` },
  ], { temperature: 0.4, maxTokens: 700 });
  const p = extractJson(out);
  if (p && ["blocked", "evaded", "partial"].includes(p.verdict)) {
    return { verdict: p.verdict, judge_note: String(p.judge_note || "").slice(0, 80) };
  }
  // 規則式降級
  const overlap = challenge.split("").filter(c => response.includes(c)).length / Math.max(1, challenge.length);
  const causal = /因為|所以|因此|導致|例如|舉例/.test(response);
  const verdict = (overlap > 0.15 && causal) ? "blocked" : (overlap > 0.05 || causal) ? "partial" : "evaded";
  const notes = { blocked: "正面迎戰，漏洞補上了。", partial: "有回應到，但論據還可以更紮實。", evaded: "好像閃掉了關鍵質疑——直球對決試試？" };
  return { verdict, judge_note: notes[verdict] };
}

/* ---------- LLM：技能章命名 ---------- */
async function nameBadge(question, topic, depth) {
  const rarities = ["普通", "稀有", "史詩", "傳說"];
  const rarity = rarities[Math.min(3, depth - 1)];
  const out = await chat([
    { role: "system", content:
      "你是遊戲命名師。為學生的學習成果命名一枚技能章（武器名），" +
      "風格是史詩奇幻＋知識感，8字以內，繁體中文。只回 JSON：" +
      "{\"name\":\"…\",\"ai_comment\":\"一句具體的稱讚（30字內，針對他的學習表現）\"}。" },
    { role: "user", content: `學習問題：${question}\n主題：${topic}\n深度：Lv${depth}\n請命名並寫一句評語。只回 JSON。` },
  ], { temperature: 0.9, maxTokens: 700 });
  const p = extractJson(out);
  if (p && p.name) {
    return { name: String(p.name).slice(0, 12), rarity, ai_comment: String(p.ai_comment || "").slice(0, 60) };
  }
  const cores = ["之刃", "之盾", "之鑰", "之眼", "之心"];
  return { name: `${topic.slice(0, 4)}${cores[depth % cores.length]}`, rarity,
    ai_comment: "你的解釋出現了因果推理——這是知識建構的標誌。" };
}

/* ---------- Supabase 持久化 ---------- */
async function saveBattle() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("battle_records").insert({
      user_id: user.id,
      question: S.question,
      quiz_score: S.quizScore,
      feynman_score: S.feynmanScore,
      debate_rounds: S.debateRounds.length,
      badge_name: S.badge?.name || null,
      badge_rarity: S.badge?.rarity || null,
      created_at: S.startedAt,
    });
  } catch (e) { console.warn("存檔失敗:", e); }
}
async function loadHistory() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase.from("battle_records")
      .select("question, badge_name, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);
    return data || [];
  } catch (e) { return []; }
}

/* ---------- 頁面：著陸 ---------- */
async function renderLanding() {
  skeleton();
  const history = await loadHistory();
  const histHtml = history.length
    ? `<div class="q-history"><h2>過往戰績</h2>` + history.map(h =>
        `<div class="q-hrow"><span>${escapeHtml(h.question || "未命名戰役")}</span>
         <span>${escapeHtml(h.badge_name || "")} · ${escapeHtml((h.created_at || "").slice(0, 10))}</span></div>`
      ).join("") + `</div>`
    : `<div class="state-empty">
        <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
        <p>尚無挑戰紀錄，來寫下第一筆吧！</p></div>`;

  view.innerHTML = `${phaseBar(0)}<div class="q-landing">
    <img src="../assets/img/emblem-quiz.webp?v=3.0.0" alt="試煉徽章">
    <h2>費曼戰役</h2>
    <p>選一個主題，先測驗摸底，再用自己的話解釋。<br>AI 會糾錯、跟你辯論——完整走完才算掌握。</p>
    <div style="display:flex;gap:8px;max-width:520px;margin:0 auto">
      <input id="q-question" type="text" placeholder="例如：為什麼天空是藍色的？"
        aria-label="學習主題"
        style="flex:1;padding:12px 16px;border:1px solid var(--line);border-radius:var(--r-full);font-size:14px">
      <button class="btn btn-primary" id="q-start">開戰</button>
    </div>
    <input id="q-hypo" type="text" placeholder="你的初步假設（選填）" aria-label="初步假設"
      style="max-width:520px;width:100%;margin:8px auto 0;padding:10px 16px;border:1px solid var(--line);border-radius:var(--r-full);font-size:13px;display:block">
    </div>${histHtml}`;

  document.getElementById("q-start").onclick = () => {
    const q = document.getElementById("q-question").value.trim();
    if (!q) { announce("請先輸入學習主題"); return; }
    S = newBattle(q, document.getElementById("q-hypo").value.trim());
    startQuiz();
  };
  try {
    const kbTopic = sessionStorage.getItem("kb_feynman_topic");
    if (kbTopic) {
      document.getElementById("q-question").value = kbTopic;
      sessionStorage.removeItem("kb_feynman_topic");
      sessionStorage.removeItem("kb_feynman_label");
    }
  } catch (e) {}
  focusMain();
}

/* ---------- Phase 1：測驗 ---------- */
async function startQuiz() {
  skeleton("AI 正在生成摸底測驗…");
  announce("AI 正在出題（摸底測驗）");
  try {
    S.quizQuestions = await generateQuiz(S.question);
    if (!S.quizQuestions.length) throw new Error("AI 這次沒有出題");
    renderQuiz(0);
  } catch (e) {
    errorView(`出題失敗：${e.message}`, () => startQuiz());
  }
}
function renderQuiz(idx) {
  const q = S.quizQuestions[idx];
  view.innerHTML = `${phaseBar(1)}
    <div class="card" style="padding:24px;max-width:600px;margin:0 auto">
      <p style="font-size:13px;color:var(--muted)">第 ${idx + 1} / ${S.quizQuestions.length} 題 · 概念：${escapeHtml(q.concept)}</p>
      <h3 style="font-size:17px;margin:12px 0">${escapeHtml(q.question)}</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${q.options.map((opt, i) => `
          <button class="btn btn-ghost q-opt" data-i="${i}" style="text-align:left;padding:12px">
            <strong>${"ABCD"[i]}</strong> · ${escapeHtml(opt)}
          </button>`).join("")}
      </div>
      <div id="q-feedback" style="margin-top:12px"></div>
    </div>`;
  view.querySelectorAll(".q-opt").forEach(btn => {
    btn.onclick = () => answerQuiz(idx, parseInt(btn.dataset.i));
  });
  focusMain();
}
function answerQuiz(idx, chosen) {
  const q = S.quizQuestions[idx];
  const correct = chosen === q.answer_index;
  S.quizAnswers.push({ chosen, correct });
  if (correct) S.quizScore++;

  const fb = document.getElementById("q-feedback");
  fb.innerHTML = `<div style="padding:12px;border-radius:8px;background:${correct ? "#e8f5e9" : "#fce4ec"}">
    <strong>${correct ? "✓ 答對了" : "✗ 答錯了"}</strong>
    <p style="font-size:13px;margin:8px 0 0">正確答案：${"ABCD"[q.answer_index]} · ${escapeHtml(q.concept)}</p>
    ${idx + 1 < S.quizQuestions.length
      ? `<button class="btn btn-primary" id="q-next" style="margin-top:12px">下一題</button>`
      : `<button class="btn btn-primary" id="q-next" style="margin-top:12px">進入費曼解釋</button>`}
  </div>`;
  view.querySelectorAll(".q-opt").forEach(b => b.disabled = true);
  document.getElementById("q-next").onclick = () => {
    if (idx + 1 < S.quizQuestions.length) renderQuiz(idx + 1);
    else renderFeynman();
  };
  fb.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------- Phase 2：費曼解釋 ---------- */
function renderFeynman() {
  view.innerHTML = `${phaseBar(2)}
    <div class="card" style="padding:24px;max-width:600px;margin:0 auto">
      <p style="font-size:13px;color:var(--muted)">測驗成績：${S.quizScore} / ${S.quizQuestions.length}</p>
      <h3 style="font-size:17px">現在，用你自己的話解釋「${escapeHtml(S.question)}」</h3>
      <p style="font-size:13px;color:var(--muted)">說服 AI 你真的懂了。AI 會評估並追問。</p>
      <textarea id="q-explain" rows="8" placeholder="在這裡寫下你的解釋…"
        style="width:100%;padding:12px;font-size:15px;margin-top:12px" aria-label="你的解釋"></textarea>
      <button class="btn btn-primary" id="q-submit-exp" style="width:100%;margin-top:12px">提交解釋</button>
      <div id="q-feynman-result"></div>
    </div>`;
  document.getElementById("q-submit-exp").onclick = submitFeynman;
  focusMain();
}
async function submitFeynman() {
  const text = document.getElementById("q-explain").value.trim();
  if (text.length < 20) { announce("解釋太短了，再多講一點"); return; }
  const btn = document.getElementById("q-submit-exp");
  btn.disabled = true; btn.textContent = "AI 評估中…（約需 15 秒）";
  try {
    const ev = await evaluateExplanation(S.question, text);
    S.explanation = text;
    S.feynmanScore = ev.score;
    S.feynmanFeedback = ev.feedback;
    const box = document.getElementById("q-feynman-result");
    box.innerHTML = `
      <div style="padding:16px;background:var(--surface);border-radius:12px;margin-top:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong>AI 評估</strong>
          <span style="font-size:20px;font-weight:800;color:var(--accent)">${ev.score} 分</span>
        </div>
        <p style="white-space:pre-wrap">${escapeHtml(ev.feedback)}</p>
        ${ev.followup ? `<p style="font-size:13px;color:var(--muted);margin-top:8px"><strong>追問：</strong>${escapeHtml(ev.followup)}</p>` : ""}
        <button class="btn btn-primary" id="q-to-debate" style="width:100%;margin-top:12px">進入辯論攻防</button>
      </div>`;
    document.getElementById("q-to-debate").onclick = startDebate;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    announce(e.message || "AI 評估失敗");
    btn.disabled = false; btn.textContent = "提交解釋";
  }
}

/* ---------- Phase 3：辯論 ---------- */
async function startDebate() {
  skeleton("AI 正在準備辯論挑戰…");
  try {
    const challenge = await debateChallenge(S.question, S.explanation, S.feynmanFeedback);
    S.debateRounds = [{ round: 1, challenge, response: "", verdict: "" }];
    renderDebateRound(0);
  } catch (e) {
    errorView(`辯論準備失敗：${e.message}`, () => startDebate());
  }
}
function renderDebateRound(idx) {
  const r = S.debateRounds[idx];
  view.innerHTML = `${phaseBar(3)}
    <div class="card" style="padding:24px;max-width:600px;margin:0 auto">
      <p style="font-size:13px;color:var(--muted)">辯論第 ${r.round} 輪</p>
      <div style="padding:16px;background:#fff3e0;border-radius:12px;margin:12px 0">
        <strong>🔥 AI 挑戰：</strong>
        <p style="margin:8px 0 0">${escapeHtml(r.challenge)}</p>
      </div>
      ${S.debateRounds.slice(0, idx).map(pr => `
        <details style="margin-bottom:8px;font-size:13px;color:var(--muted)">
          <summary>第 ${pr.round} 輪回顧（${pr.verdict === "blocked" ? "守住" : pr.verdict === "partial" ? "部分守住" : "被突破"}）</summary>
          <p>挑戰：${escapeHtml(pr.challenge.slice(0, 100))}…</p>
          <p>你的回應：${escapeHtml(pr.response.slice(0, 100))}…</p>
        </details>`).join("")}
      <textarea id="q-debate-resp" rows="6" placeholder="正面回應這個挑戰，補上你的論據…"
        style="width:100%;padding:12px;font-size:15px" aria-label="辯論回應"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" id="q-debate-submit" style="flex:1">提交回應</button>
        ${idx >= 1 ? `<button class="btn btn-ghost" id="q-debate-end">結束辯論，去授勳</button>` : ""}
      </div>
      <div id="q-debate-result"></div>
    </div>`;
  document.getElementById("q-debate-submit").onclick = () => submitDebate(idx);
  const endBtn = document.getElementById("q-debate-end");
  if (endBtn) endBtn.onclick = () => finishBattle();
  focusMain();
}
async function submitDebate(idx) {
  const text = document.getElementById("q-debate-resp").value.trim();
  if (text.length < 10) { announce("回應太短了"); return; }
  const btn = document.getElementById("q-debate-submit");
  btn.disabled = true; btn.textContent = "裁判評判中…";
  try {
    const r = S.debateRounds[idx];
    const judge = await debateJudge(S.question, r.challenge, text);
    r.response = text;
    r.verdict = judge.verdict;
    r.judge_note = judge.judge_note;

    const box = document.getElementById("q-debate-result");
    const verdictText = { blocked: "🛡️ 守住了！", partial: "⚔️ 部分守住", evaded: "💔 被突破了" }[judge.verdict];
    box.innerHTML = `
      <div style="padding:12px;background:var(--surface);border-radius:8px;margin-top:12px">
        <strong>${verdictText}</strong>
        <p style="font-size:13px;margin:8px 0 0">${escapeHtml(judge.judge_note)}</p>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-primary" id="q-debate-next" style="flex:1">下一輪挑戰</button>
          <button class="btn btn-ghost" id="q-debate-finish">結束辯論，去授勳</button>
        </div>
      </div>`;
    document.getElementById("q-debate-next").onclick = async () => {
      skeleton("AI 正在準備下一輪挑戰…");
      try {
        const challenge = await debateChallenge(S.question, S.explanation + "\n" + text, judge.judge_note);
        S.debateRounds.push({ round: S.debateRounds.length + 1, challenge, response: "", verdict: "" });
        renderDebateRound(S.debateRounds.length - 1);
      } catch (e) { announce(e.message); renderDebateRound(idx); }
    };
    document.getElementById("q-debate-finish").onclick = () => finishBattle();
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    announce(e.message || "評判失敗");
    btn.disabled = false; btn.textContent = "提交回應";
  }
}

/* ---------- Phase 4：授勳 ---------- */
async function finishBattle() {
  skeleton("AI 正在為你打造技能章…");
  try {
    // 深度 = 測驗答對率 + 費曼分數 + 辯論表現 綜合
    const quizRate = S.quizQuestions.length ? S.quizScore / S.quizQuestions.length : 0;
    const blocked = S.debateRounds.filter(r => r.verdict === "blocked").length;
    const depth = Math.min(4, Math.max(1,
      Math.round(1 + quizRate * 1.5 + (S.feynmanScore / 100) * 1 + blocked * 0.3)));
    S.badge = await nameBadge(S.question, S.question.slice(0, 8), depth);
    await saveBattle();
    renderBadge(depth);
  } catch (e) {
    errorView(`授勳失敗：${e.message}`, () => finishBattle());
  }
}
function renderBadge(depth) {
  const blocked = S.debateRounds.filter(r => r.verdict === "blocked").length;
  view.innerHTML = `${phaseBar(4)}
    <div class="card" style="padding:32px 24px;max-width:600px;margin:0 auto;text-align:center">
      <div style="font-size:64px;margin-bottom:16px">🏆</div>
      <h2 style="margin:0 0 8px">戰役完成！</h2>
      <p style="color:var(--muted);font-size:14px">「${escapeHtml(S.question)}」</p>
      <div style="margin:24px 0;padding:20px;background:linear-gradient(135deg,#fff8e1,#ffecb3);border-radius:16px">
        <p style="font-size:13px;color:var(--muted);margin:0">獲得技能章 · ${escapeHtml(S.badge.rarity)}</p>
        <p style="font-size:24px;font-weight:800;margin:8px 0">⚔️ ${escapeHtml(S.badge.name)}</p>
        <p style="font-size:14px;color:var(--muted);margin:0">${escapeHtml(S.badge.ai_comment)}</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0;text-align:center">
        <div><p style="font-size:24px;font-weight:800;margin:0">${S.quizScore}/${S.quizQuestions.length}</p><p style="font-size:12px;color:var(--muted);margin:0">測驗</p></div>
        <div><p style="font-size:24px;font-weight:800;margin:0">${S.feynmanScore}</p><p style="font-size:12px;color:var(--muted);margin:0">費曼分數</p></div>
        <div><p style="font-size:24px;font-weight:800;margin:0">${blocked}/${S.debateRounds.length}</p><p style="font-size:12px;color:var(--muted);margin:0">辯論守住</p></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn btn-primary" id="q-again">再來一場</button>
        <a class="btn btn-ghost" href="feynman.html">去費曼說服</a>
      </div>
    </div>`;
  document.getElementById("q-again").onclick = () => { S = null; renderLanding(); };
  announce(`戰役完成！獲得技能章 ${S.badge.name}`);
  focusMain();
}

/* ---------- 啟動 ---------- */
(function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">
      <p>請先登入再參加費曼戰役</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  userline.textContent = "";
  renderLanding();
})();
