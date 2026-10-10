/* 費曼戰役：開戰 → 費曼解釋(AI糾錯) → 辯論攻防 → 穿插測驗 → 授勳
 * 完整學習閉環，全鏈路調真實後端，零假數據。
 * 生命週期：init → loading → api → render / empty / error
 */
import { swr, post, get } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("q-view");
const userline = document.getElementById("q-userline");

function skeleton() {
  view.innerHTML = `<div class="skeleton" style="height:120px"></div>
    <div class="skeleton" style="height:20px;margin-top:12px"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="燈籠插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="q-retry">重試</button></div>`;
  document.getElementById("q-retry").onclick = retry;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function phaseBar(step) {
  const phases = ["開戰", "費曼解釋", "辯論攻防", "穿插測驗", "授勳"];
  return `<div class="q-phases" role="list" aria-label="戰役進度">` +
    phases.map((p, i) =>
      `<span role="listitem" class="q-phase ${i < step ? "done" : i === step ? "now" : ""}">${p}</span>`
    ).join("") + `</div>`;
}

/* ---- 著陸：輸入問題 + 歷史戰績 ---- */
async function renderLanding() {
  skeleton();
  let history = [];
  try {
    const r = await swr("learn:sessions", "/learn/sessions");
    history = r.data || r.items || [];
  } catch (e) {
    console.warn("[quiz] history failed:", e.code);
  }

  const histHtml = history.length
    ? `<div class="q-history"><h2>過往戰績</h2>` + history.slice(0, 5).map(h =>
        `<div class="q-hrow"><span>${escapeHtml(h.question || "未命名戰役")}</span>
         <span>${escapeHtml(h.status || "")} · ${escapeHtml((h.created_at || "").slice(0, 10))}</span></div>`
      ).join("") + `</div>`
    : `<div class="state-empty">
        <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
        <p>尚無挑戰紀錄，來寫下第一筆吧！</p></div>`;

  view.innerHTML = `<div class="q-landing">
    <img src="../assets/img/emblem-quiz.webp?v=3.0.0" alt="試煉徽章">
    <h2>費曼戰役</h2>
    <p>選一個主題，用自己的話解釋它。<br>AI 會糾錯、跟你辯論、再出題驗收——完整走完才算掌握。</p>
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
    const hypo = document.getElementById("q-hypo").value.trim();
    startBattle(q, hypo);
  };
}

/* ---- Phase 0: 開戰 ---- */
async function startBattle(question, hypothesis) {
  skeleton();
  announce("開戰中");
  try {
    const body = { question };
    if (hypothesis) body.hypothesis = hypothesis;
    const session = await post("/learn/sessions", body);
    const sid = session.id || session.sid || session.session_id;
    if (!sid) throw new Error("後端未回傳會話 ID");
    await post(`/learn/sessions/${sid}/events`, { kind: "battle_start", payload: { question } }).catch(() => {});
    renderFeynman(sid, question, 1);
  } catch (e) {
    errorView(`開戰失敗：${e.message}（${e.code || "未知"}）`, () => startBattle(question, hypothesis));
  }
}

/* ---- Phase 1: 費曼解釋 → AI 糾錯 ---- */
function renderFeynman(sid, question, step) {
  view.innerHTML = `${phaseBar(step)}
    <div class="card q-feynman">
      <h2>費曼解釋</h2>
      <p class="q-q">主題：${escapeHtml(question)}</p>
      <p style="color:var(--muted)">假裝你要教會一個完全不懂的人。用自己的話寫下來，越白話越好。</p>
      <textarea id="q-explain" rows="6" placeholder="用你自己的話解釋…"
        aria-label="費曼解釋"
        style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;font-size:14px"></textarea>
      <button class="btn btn-primary" id="q-feynman-go" style="margin-top:12px;width:100%">送出，請 AI 糾錯</button>
    </div>`;
  document.getElementById("q-feynman-go").onclick = async () => {
    const explanation = document.getElementById("q-explain").value.trim();
    if (explanation.length < 15) { announce("解釋至少寫 15 個字"); return; }
    skeleton();
    announce("AI 正在批閱你的解釋");
    try {
      const r = await post(`/learn/sessions/${sid}/feynman`, { explanation });
      renderCorrection(sid, question, explanation, r, step);
    } catch (e) {
      errorView(`AI 糾錯失敗：${e.message}`, () => renderFeynman(sid, question, step));
    }
  };
  focusMain();
}

function renderCorrection(sid, question, explanation, correction, step) {
  const fb = correction.feedback || correction.correction || correction.message || "";
  const score = correction.score ?? correction.rating ?? null;
  view.innerHTML = `${phaseBar(step)}
    <div class="card q-correction">
      <h2>AI 糾錯</h2>
      ${score !== null ? `<p class="q-score">${escapeHtml(String(score))}</p>` : ""}
      <div class="q-feedback">${escapeHtml(fb) || "AI 已讀完你的解釋。"}</div>
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn-primary" id="q-to-debate">進入辯論攻防</button>
        <button class="btn btn-ghost" id="q-rewrite">重寫解釋</button>
      </div>
    </div>`;
  document.getElementById("q-to-debate").onclick = () => renderDebateStart(sid, question, explanation, step + 1);
  document.getElementById("q-rewrite").onclick = () => renderFeynman(sid, question, step);
  focusMain();
}

/* ---- Phase 2: 辯論攻防（R1 → R2 → R3） ---- */
function renderDebateStart(sid, question, explanation, step) {
  view.innerHTML = `${phaseBar(step)}
    <div class="card q-debate">
      <h2>辯論攻防 · 第一回合</h2>
      <p style="color:var(--muted)">AI 會針對你的解釋提出質疑。用 ≥15 字回應，反駁或補強都可以。</p>
      <button class="btn btn-primary" id="q-debate-go" style="width:100%">開戰</button>
    </div>`;
  document.getElementById("q-debate-go").onclick = async () => {
    skeleton();
    announce("AI 正在出招");
    try {
      const r = await post(`/learn/sessions/${sid}/debate/start`, { explanation });
      renderDebateRound(sid, question, r, 1, step);
    } catch (e) {
      errorView(`辯論開戰失敗：${e.message}`, () => renderDebateStart(sid, question, explanation, step));
    }
  };
  focusMain();
}

function renderDebateRound(sid, question, round, roundNum, step) {
  const challenge = round.challenge || round.question || round.text || round.message || "";
  const total = 3;
  view.innerHTML = `${phaseBar(step)}
    <div class="card q-debate">
      <h2>辯論攻防 · 第 ${roundNum} / ${total} 回合</h2>
      <div class="q-challenge"><strong>AI 質疑：</strong>${escapeHtml(challenge)}</div>
      ${roundNum > 1 && round.feedback ? `<div class="q-feedback"><strong>上一輪點評：</strong>${escapeHtml(round.feedback)}</div>` : ""}
      <textarea id="q-rebut" rows="5" placeholder="寫下你的反駁或補強（≥15 字）…"
        aria-label="辯論回應" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;font-size:14px;margin-top:12px"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-primary" id="q-respond" style="flex:1">送出回應</button>
        <button class="btn btn-ghost" id="q-appeal">申訴重判</button>
        <button class="btn btn-ghost" id="q-concede">暫停挑戰</button>
      </div>
    </div>`;

  document.getElementById("q-respond").onclick = async () => {
    const text = document.getElementById("q-rebut").value.trim();
    if (text.length < 15) { announce("回應至少寫 15 個字"); return; }
    skeleton();
    announce(`第 ${roundNum} 回合送出，AI 評判中`);
    try {
      const r = await post(`/learn/sessions/${sid}/debate/respond`, { text });
      if (roundNum >= total) {
        renderDebateDone(sid, question, r, step);
      } else {
        renderDebateRound(sid, question, r, roundNum + 1, step);
      }
    } catch (e) {
      errorView(`回應失敗：${e.message}`, () => renderDebateRound(sid, question, round, roundNum, step));
    }
  };
  document.getElementById("q-appeal").onclick = async () => {
    try {
      announce("申訴中，AI 重新評判上一輪");
      const r = await post(`/learn/sessions/${sid}/debate/appeal`, {});
      renderDebateRound(sid, question, r, roundNum, step);
    } catch (e) { announce(`申訴失敗：${e.message}`); }
  };
  document.getElementById("q-concede").onclick = async () => {
    try {
      await post(`/learn/sessions/${sid}/debate/concede`, {});
      announce("已暫停辯論，直接進入測驗");
      startQuiz(sid, question, step + 1);
    } catch (e) { announce(`暫停失敗：${e.message}`); }
  };
  focusMain();
}

function renderDebateDone(sid, question, result, step) {
  const verdict = result.verdict || result.message || result.feedback || "三回合結束。";
  view.innerHTML = `${phaseBar(step)}
    <div class="card q-debate-done">
      <h2>辯論結束</h2>
      <div class="q-feedback">${escapeHtml(verdict)}</div>
      <button class="btn btn-primary" id="q-to-quiz" style="width:100%;margin-top:16px">進入穿插測驗</button>
    </div>`;
  document.getElementById("q-to-quiz").onclick = () => startQuiz(sid, question, step + 1);
  focusMain();
}

/* ---- Phase 3: 穿插測驗 ---- */
async function startQuiz(sid, question, step) {
  skeleton();
  announce("AI 正在出題");
  try {
    const quiz = await post(`/learn/sessions/${sid}/quiz`, {});
    const questions = quiz.questions || quiz.items || [];
    if (!questions.length) {
      errorView("AI 這次沒有出題", () => startQuiz(sid, question, step));
      return;
    }
    renderQuiz(sid, question, questions, step);
  } catch (e) {
    errorView(`出題失敗：${e.message}`, () => startQuiz(sid, question, step));
  }
}

function renderQuiz(sid, question, questions, step) {
  const answers = new Array(questions.length).fill(null);
  view.innerHTML = `${phaseBar(step)}
    <div id="q-quiz">` + questions.map((q, i) => {
    const opts = q.options || q.choices || [];
    return `<div class="card q-qcard"><h3>第 ${i + 1} 題 · ${escapeHtml(q.question || q.text || "")}</h3>` +
      opts.map((opt, j) =>
        `<button class="q-opt" data-q="${i}" data-o="${j}" aria-pressed="false">${escapeHtml(String(opt))}</button>`
      ).join("") + `</div>`;
  }).join("") + `<button class="btn btn-primary" id="q-submit" style="width:100%">交卷</button></div>`;

  view.querySelectorAll(".q-opt").forEach(btn => {
    btn.onclick = () => {
      const qi = +btn.dataset.q;
      view.querySelectorAll(`.q-opt[data-q="${qi}"]`).forEach(b => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      answers[qi] = +btn.dataset.o;
    };
  });

  document.getElementById("q-submit").onclick = async () => {
    if (answers.some(a => a === null)) { announce("還有題目沒作答"); return; }
    skeleton();
    try {
      const result = await post(`/learn/sessions/${sid}/quiz/answers`, { answers });
      renderResult(sid, question, result, questions.length, step);
    } catch (e) {
      errorView(`交卷失敗：${e.message}`, () => renderQuiz(sid, question, questions, step));
    }
  };
  focusMain();
}

/* ---- Phase 4: 結算 + 授勳 ---- */
async function renderResult(sid, question, result, total, step) {
  const score = result.score ?? result.correct ?? 0;
  const detail = result.detail || result.feedback || result.message || "";
  view.innerHTML = `${phaseBar(step)}
    <div class="q-result">
      <h2>試煉完成</h2>
      <p class="q-score">${score} / ${total}</p>
      ${detail ? `<p style="color:var(--muted)">${escapeHtml(detail)}</p>` : ""}
      <input id="q-badge" type="text" placeholder="技能章名稱（選填，預設自動命名）" aria-label="技能章名稱"
        style="max-width:400px;width:100%;margin:12px auto 0;padding:10px 16px;border:1px solid var(--line);border-radius:var(--r-full);font-size:13px;display:block">
      <div style="margin-top:12px">
        <button class="btn btn-primary" id="q-finish">授勳</button>
        <button class="btn btn-ghost" id="q-again" style="margin-left:8px">再戰一場</button>
      </div>
    </div>`;

  document.getElementById("q-again").onclick = () => renderLanding();
  document.getElementById("q-finish").onclick = async () => {
    const badgeName = document.getElementById("q-badge").value.trim()
      || `戰役·${question.slice(0, 12)}·${new Date().toISOString().slice(0, 10)}`;
    try {
      const fin = await post(`/learn/sessions/${sid}/finish`, { badge_name: badgeName });
      const reward = fin.stardust ?? fin.reward ?? 0;
      const badge = fin.badge_name || badgeName;
      announce(`授勳完成，獲得技能章「${badge}」與 ${reward} 星砂`);
      view.querySelector(".q-result").insertAdjacentHTML("beforeend",
        `<div class="card" style="margin-top:16px">
           <h3>🏅 ${escapeHtml(badge)}</h3>
           <p>獲得星砂：<strong>${reward}</strong></p>
           <div style="margin-top:12px">
             <a class="btn btn-primary" href="bookshelf.html">去書架看看</a>
             <button class="btn btn-ghost" id="q-again2" style="margin-left:8px">再戰一場</button>
           </div>
         </div>`);
      document.getElementById("q-finish").disabled = true;
      document.getElementById("q-again2").onclick = () => renderLanding();
    } catch (e) {
      announce(`授勳失敗：${e.message}`);
    }
  };
  focusMain();
}

/* ---- 啟動 ---- */
(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再進入費曼戰役</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    userline.textContent = "未登入";
    return;
  }
  try {
    const r = await swr("auth:me", "/auth/me");
    const me = r.data?.user || r.data?.data || {};
    userline.textContent = `旅人 ${me.name || ""} · 歡迎回來`;
  } catch { userline.textContent = "旅人"; }
  renderLanding();
})();
