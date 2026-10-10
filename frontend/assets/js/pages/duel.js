/* 知識對決：選標籤＋對手 → 發起 → 作答 → 結果（每回合回饋＋觀念提醒）
 * 全鏈路調真實後端，零假數據。
 * 生命週期：init → loading(skeleton) → api → render / empty / error
 */
import { swr, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("d-view");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function skeleton(h = 160) {
  view.innerHTML = `<div class="skeleton" style="height:${h}px" aria-hidden="true"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="d-retry">重試</button></div>`;
  document.getElementById("d-retry").onclick = retry;
}
function loginView() {
  view.innerHTML = `<div class="state-empty">
    <p>請先登入再發起知識對決</p>
    <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
}

/* ---- 著陸：說明＋選對決領域＋填對手 ---- */
async function renderLanding() {
  skeleton();
  announce("載入對決資訊");
  let me = null, tags = [];
  try {
    const r = await swr("auth:me", "/auth/me");
    me = r.data?.user || r.data;
    const uid = me?.id;
    if (!uid) throw new Error("無法取得使用者資訊");
    const isl = await swr(`island:${uid}`, `/islands/${uid}`);
    tags = isl.data?.occupied_tags || [];
  } catch (e) {
    errorView(`載入失敗：${e.message}（${e.code || "未知"}）`, renderLanding);
    return;
  }

  const uid = me.id;
  const tagHtml = tags.length
    ? `<div class="card" style="margin:16px 0"><h2>選擇對決領域</h2>
       <p style="color:var(--muted);font-size:13px">只能用你已佔領的標籤開戰（對手也必須擁有該標籤）</p>
       <div role="radiogroup" aria-label="對決領域" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">` +
       tags.map((t, i) =>
         `<button class="q-opt d-tag" data-tag="${escapeHtml(t)}" role="radio"
            aria-checked="${i === 0}" aria-label="領域 ${escapeHtml(t)}"
            style="${i === 0 ? "border-color:var(--accent);" : ""}">${escapeHtml(t)}</button>`
       ).join("") + `</div></div>`
    : `<div class="state-empty">
         <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
         <p>你還沒有佔領任何標籤，無法發起對決。<br>先去島嶼佔領一個知識標籤吧！</p>
         <a class="btn btn-primary" href="island.html">去佔領標籤</a></div>`;

  view.innerHTML = `<div class="d-center">
    <p style="color:var(--muted);margin-bottom:8px">向另一位旅人發起知識對決，<br>
    雙方在共同領域答題，答對越多，星砂越多。</p></div>
    ${tagHtml}
    ${tags.length ? `<div class="card" style="margin-bottom:16px">
      <h2>指定對手</h2>
      <input id="d-opponent" type="text" placeholder="對手的使用者 ID（例如 u_xxxx）"
        aria-label="對手使用者 ID"
        style="width:100%;padding:12px 16px;border:1px solid var(--line);border-radius:12px;font-size:14px">
      <button class="btn btn-primary" id="d-start" style="width:100%;margin-top:12px">發起對決</button>
    </div>` : ""}`;

  let selectedTag = tags[0] || null;
  view.querySelectorAll(".d-tag").forEach(btn => {
    btn.onclick = () => {
      view.querySelectorAll(".d-tag").forEach(b => {
        b.setAttribute("aria-checked", "false");
        b.style.borderColor = "";
      });
      btn.setAttribute("aria-checked", "true");
      btn.style.borderColor = "var(--accent)";
      selectedTag = btn.dataset.tag;
    };
  });

  const startBtn = document.getElementById("d-start");
  if (startBtn) {
    startBtn.onclick = () => {
      const opp = document.getElementById("d-opponent").value.trim();
      if (!opp) { announce("請輸入對手的使用者 ID"); return; }
      if (opp === uid) { announce("不能跟自己對決"); return; }
      if (!selectedTag) { announce("請選擇對決領域"); return; }
      startDuel(uid, opp, selectedTag);
    };
  }
  focusMain();
}

/* ---- 發起對決 ---- */
async function startDuel(challengerId, opponentId, tag) {
  skeleton();
  announce("正在建立對決");
  try {
    const duel = await post("/duels", {
      challenger_id: challengerId,
      opponent_id: opponentId,
      tag,
    });
    const duelId = duel.duel_id ?? duel.id;
    const questions = duel.questions || [];
    if (!duelId || !questions.length) throw new Error("對決建立失敗，後端未回傳題目");
    announce(duel.reason || "對決成立");
    renderDuel(duelId, challengerId, questions, tag);
  } catch (e) {
    errorView(`對決發起失敗：${e.message}（${e.code || "未知"}）`, renderLanding);
  }
}

/* ---- 作答 ---- */
function renderDuel(duelId, userId, questions, tag) {
  const answers = new Array(questions.length).fill(null);
  view.innerHTML = `<div class="d-center" style="margin-bottom:12px">
      <p style="color:var(--muted)">對決領域：<strong>${escapeHtml(tag)}</strong> · 共 ${questions.length} 回合</p>
    </div>` + questions.map((q, i) => {
    const opts = q.options || q.choices || [];
    return `<div class="card" style="margin-bottom:16px">
      <h3>第 ${q.round ?? i + 1} 回合</h3>
      <p>${escapeHtml(q.question || q.text || "")}</p>
      <div role="radiogroup" aria-label="第 ${q.round ?? i + 1} 回合選項">` +
      opts.map((opt, j) =>
        `<button class="q-opt" data-q="${i}" data-o="${j}" role="radio" aria-checked="false"
          aria-label="選項 ${escapeHtml(String(opt))}"
          style="display:block;width:100%;text-align:left;padding:12px;margin-top:8px;
          border:1px solid var(--line);border-radius:12px;background:var(--card);
          font-size:14px">${escapeHtml(String(opt))}</button>`
      ).join("") + `</div></div>`;
  }).join("") + `<button class="btn btn-primary" id="d-submit" style="width:100%">出招</button>`;

  view.querySelectorAll(".q-opt[data-q]").forEach(btn => {
    btn.onclick = () => {
      const qi = +btn.dataset.q;
      view.querySelectorAll(`.q-opt[data-q="${qi}"]`).forEach(b => {
        b.setAttribute("aria-checked", "false");
        b.style.borderColor = "";
      });
      btn.setAttribute("aria-checked", "true");
      btn.style.borderColor = "var(--accent)";
      answers[qi] = +btn.dataset.o;
    };
  });

  document.getElementById("d-submit").onclick = async () => {
    if (answers.some(a => a === null)) { announce("還有回合沒作答"); return; }
    skeleton(120);
    announce("結算中");
    try {
      const r = await post(`/duels/${duelId}/answers`, { user_id: userId, answers });
      renderResult(r, questions.length);
    } catch (e) {
      errorView(`結算失敗：${e.message}（${e.code || "未知"}）`,
        () => renderDuel(duelId, userId, questions, tag));
    }
  };
  focusMain();
}

/* ---- 結果：分數＋每回合回饋 ---- */
function renderResult(r, total) {
  const score = r.your_score ?? r.score ?? 0;
  const feedback = r.feedback || [];
  const win = score >= Math.ceil(total / 2);

  view.innerHTML = `<div class="d-center">
    <h2>${win ? "🎉 對決勝利！" : "雖敗猶榮"}</h2>
    <p style="font-size:40px;font-weight:800;margin:16px 0" aria-label="得分 ${score} 共 ${r.total ?? total} 題">
      ${score} / ${r.total ?? total}</p>
    ${r.settled ? `<p style="color:var(--muted)">對決已結算</p>` : `<p style="color:var(--muted)">等待對手作答後結算</p>`}
  </div>` + (feedback.length ? `<h2 style="margin:24px 0 8px">逐回合回顧</h2>` +
    feedback.map(fb =>
      `<div class="card" style="margin-bottom:12px;border-left:4px solid ${fb.correct ? "var(--ok,#4caf50)" : "var(--warn,#f44336)"}">
        <h3>第 ${fb.round} 回合 ${fb.correct ? "✅" : "❌"}</h3>
        <p>你的選擇：<strong>${escapeHtml(fb.your_choice ?? "")}</strong></p>
        ${fb.correct ? "" : `<p>正確答案：<strong>${escapeHtml(fb.correct_answer ?? "")}</strong></p>`}
        ${fb.concept_note ? `<p style="color:var(--muted);font-size:13px;margin-top:8px">${escapeHtml(fb.concept_note)}</p>` : ""}
      </div>`
    ).join("") : "") + `
  <div style="margin-top:24px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
    <button class="btn btn-primary" id="d-again">再戰一場</button>
    <a class="btn btn-ghost" href="bookshelf.html">回書架</a>
  </div>`;

  document.getElementById("d-again").onclick = renderLanding;
  announce(`對決結束，得分 ${score}，共 ${r.total ?? total} 題`);
  focusMain();
}

/* ---- 啟動 ---- */
(function init() {
  if (!isLoggedIn()) { loginView(); return; }
  renderLanding();
})();
