/* 知識對決：發起對決 → 作答 → 結果。全調真實後端。 */
import { post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("d-view");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  root.appendChild(el); announce(msg);
  setTimeout(() => el.remove(), 3000);
}

function renderLobby() {
  view.innerHTML = `<div class="d-center">
    <img src="../assets/img/emblem-duel.webp?v=3.0.0" alt="對決徽章">
    <p style="color:var(--muted);margin-bottom:16px">向隨機旅人發起知識對決，<br>答對越多，星砂越多。</p>
    <button class="btn btn-primary" id="d-start">發起對決</button></div>`;
  document.getElementById("d-start").onclick = startDuel;
}

async function startDuel() {
  view.innerHTML = `<div class="skeleton" style="height:160px"></div>`;
  announce("正在尋找對手");
  try {
    const duel = await post("/duels", {});
    const duelId = duel.id || duel.duel_id;
    const questions = duel.questions || duel.items || [];
    if (!duelId || !questions.length) throw new Error("對決建立失敗");
    renderDuel(duelId, questions);
  } catch (e) {
    view.innerHTML = `<div class="state-error">
      <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
      <p>對決發起失敗：${escapeHtml(e.message)}</p>
      <button class="btn btn-primary" id="d-retry">重試</button></div>`;
    document.getElementById("d-retry").onclick = renderLobby;
  }
}

function renderDuel(duelId, questions) {
  const answers = new Array(questions.length).fill(null);
  view.innerHTML = questions.map((q, i) => {
    const opts = q.options || q.choices || [];
    return `<div class="card" style="margin-bottom:16px">
      <h3>第 ${i + 1} 題 · ${escapeHtml(q.question || q.text || "")}</h3>` +
      opts.map((opt, j) =>
        `<button class="q-opt" data-q="${i}" data-o="${j}" aria-pressed="false"
          style="display:block;width:100%;text-align:left;padding:12px;margin-top:8px;
          border:1px solid var(--line);border-radius:12px;background:var(--card)">${escapeHtml(opt)}</button>`
      ).join("") + `</div>`;
  }).join("") + `<button class="btn btn-primary" id="d-submit" style="width:100%">出招</button>`;

  view.querySelectorAll(".q-opt").forEach(btn => {
    btn.onclick = () => {
      const qi = +btn.dataset.q;
      view.querySelectorAll(`.q-opt[data-q="${qi}"]`).forEach(b => {
        b.setAttribute("aria-pressed", "false");
        b.style.borderColor = "var(--line)";
      });
      btn.setAttribute("aria-pressed", "true");
      btn.style.borderColor = "var(--accent)";
      answers[qi] = +btn.dataset.o;
    };
  });

  document.getElementById("d-submit").onclick = async () => {
    if (answers.some(a => a === null)) { announce("還有題目沒作答"); return; }
    view.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
    try {
      const r = await post(`/duels/${duelId}/answers`, { answers });
      const win = r.win ?? (r.score > 0);
      view.innerHTML = `<div class="d-center">
        <h2>${win ? "勝利！" : "雖敗猶榮"}</h2>
        <p class="q-score" style="font-size:32px;font-weight:800;margin:16px 0">
          ${r.score ?? ""} / ${questions.length}</p>
        <p style="color:var(--muted)">${escapeHtml(r.message || "")}</p>
        <button class="btn btn-primary" id="d-again" style="margin-top:16px">再戰</button>
        <a class="btn btn-ghost" href="../index.html" style="margin-top:16px;margin-left:8px">回首頁</a></div>`;
      document.getElementById("d-again").onclick = renderLobby;
      toast(win ? "對決勝利！" : "對決結束");
    } catch (e) {
      view.innerHTML = `<div class="state-error"><p>結算失敗：${escapeHtml(e.message)}</p>
        <button class="btn btn-primary" id="d-retry2">重試</button></div>`;
      document.getElementById("d-retry2").onclick = () => renderDuel(duelId, questions);
    }
  };
  focusMain();
}

(function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty"><p>請先登入</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  renderLobby();
})();
