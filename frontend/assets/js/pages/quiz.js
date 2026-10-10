/* 試煉場：開戰 → 出題 → 作答 → 授勳。全鏈路調真實後端，零假數據。
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

/* ---- 著陸：輸入問題 + 歷史戰績 ---- */
async function renderLanding() {
  skeleton();
  let history = [];
  try {
    const r = await swr("learn:sessions", "/learn/sessions");
    history = r.data || [];
  } catch (e) {
    // 歷史讀不到不擋開戰，只顯示錯誤小條
    console.warn("[quiz] history failed:", e.code);
  }

  const histHtml = history.length
    ? `<div class="q-history"><h2>過往戰績</h2>` + history.slice(0, 5).map(h =>
        `<div class="q-hrow"><span>${escapeHtml(h.question || "未命名戰役")}</span>
         <span>${escapeHtml(h.created_at?.slice(0, 10) || "")}</span></div>`).join("") + `</div>`
    : `<div class="state-empty">
        <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
        <p>尚無挑戰紀錄，來寫下第一筆吧！</p></div>`;

  view.innerHTML = `<div class="q-landing">
    <img src="../assets/img/emblem-quiz.webp?v=3.0.0" alt="試煉徽章">
    <p>輸入你想修煉的主題，AI 會為你出題。<br>答對率越高，獲得的星砂越多。</p>
    <div style="display:flex;gap:8px;max-width:480px;margin:0 auto">
      <input id="q-question" type="text" placeholder="例如：數學函數、公民投票制度…"
        aria-label="學習主題"
        style="flex:1;padding:12px 16px;border:1px solid var(--line);border-radius:var(--r-full);font-size:14px">
      <button class="btn btn-primary" id="q-start">開戰</button>
    </div></div>${histHtml}`;

  document.getElementById("q-start").onclick = () => {
    const q = document.getElementById("q-question").value.trim();
    if (!q) { announce("請先輸入學習主題"); return; }
    startBattle(q);
  };
}

/* ---- 開戰：建會話 → 出題 ---- */
async function startBattle(question) {
  skeleton();
  announce("開戰中，AI 正在出題");
  try {
    const session = await post("/learn/sessions", { question });
    const sid = session.id || session.sid || session.session_id;
    if (!sid) throw new Error("後端未回傳會話 ID");
    const quiz = await post(`/learn/sessions/${sid}/quiz?n=5`, {});
    const questions = quiz.questions || quiz.items || [];
    if (!questions.length) {
      errorView("AI 這次沒有出題，請換個主題再試", () => renderLanding());
      return;
    }
    renderQuiz(sid, questions);
  } catch (e) {
    errorView(`開戰失敗：${e.message}（${e.code || "未知"}）`, () => startBattle(question));
  }
}

/* ---- 作答 ---- */
function renderQuiz(sid, questions) {
  const answers = new Array(questions.length).fill(null);
  view.innerHTML = `<div id="q-quiz">` + questions.map((q, i) => {
    const opts = q.options || q.choices || [];
    return `<div class="card q-qcard"><h3>第 ${i + 1} 題 · ${escapeHtml(q.question || q.text || "")}</h3>` +
      opts.map((opt, j) =>
        `<button class="q-opt" data-q="${i}" data-o="${j}" aria-pressed="false">${escapeHtml(opt)}</button>`
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
      renderResult(sid, result, questions.length);
    } catch (e) {
      errorView(`交卷失敗：${e.message}`, () => renderQuiz(sid, questions));
    }
  };
  focusMain();
}

/* ---- 結算 + 授勳 ---- */
async function renderResult(sid, result, total) {
  const score = result.score ?? result.correct ?? 0;
  view.innerHTML = `<div class="q-result">
    <h2>試煉完成</h2>
    <p class="q-score">${score} / ${total}</p>
    <p style="color:var(--muted)">${escapeHtml(result.message || "")}</p>
    <button class="btn btn-primary" id="q-finish">授勳</button>
    <button class="btn btn-ghost" id="q-again" style="margin-left:8px">再戰一場</button></div>`;

  document.getElementById("q-again").onclick = () => renderLanding();
  document.getElementById("q-finish").onclick = async () => {
    try {
      // 後端 quirks：空 body 會 422，必須帶 badge_name
      const fin = await post(`/learn/sessions/${sid}/finish`, {
        badge_name: `試煉·${new Date().toISOString().slice(0, 10)}`,
      });
      announce(`授勳完成，獲得 ${fin.stardust ?? fin.reward ?? 0} 星砂`);
      view.querySelector(".q-result").insertAdjacentHTML("beforeend",
        `<p style="margin-top:16px">獲得星砂：<strong>${fin.stardust ?? fin.reward ?? 0}</strong></p>
         <a class="btn" href="../index.html" style="margin-top:16px">回首頁</a>`);
      document.getElementById("q-finish").disabled = true;
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
      <p>請先登入再進入試煉場</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    userline.textContent = "未登入";
    return;
  }
  try {
    const r = await swr("auth:me", "/auth/me");
    userline.textContent = `旅人 ${r.data?.name || ""} · 歡迎回來`;
  } catch { userline.textContent = "旅人"; }
  renderLanding();
})();
