/* 知識對決 —— 爐石式對戰體驗
 * 著陸（競技場主視覺）→ VS 畫面 → 逐題對戰 → 勝敗結算
 * 全鏈路調真實後端，零假數據。
 * 生命週期：init → loading(skeleton) → api → render / empty / error
 */
import { swr, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("d-view");
const ARENA_IMG = "../assets/img/game/duel-arena.webp?v=3.0.0";

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

/* 共用：競技場主視覺橫幅 */
function arenaHero(subtitle) {
  return `<div style="position:relative;border-radius:16px;overflow:hidden;margin-bottom:16px;min-height:200px;
      background:linear-gradient(135deg,#160d2e 0%,#3d1f5c 60%,#6b2d7a 100%)">
    <img src="${ARENA_IMG}" alt="對決競技場" loading="lazy"
      style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
      onerror="this.style.display='none'">
    <div style="position:relative;padding:36px 20px 28px;text-align:center;
        background:linear-gradient(180deg,rgba(12,7,26,.35) 0%,rgba(12,7,26,.88) 100%)">
      <p style="color:#ffd97a;letter-spacing:6px;font-size:12px;margin:0 0 8px">⚔ KNOWLEDGE DUEL ⚔</p>
      <h2 style="color:#fff;font-size:26px;margin:0 0 8px;text-shadow:0 2px 12px rgba(0,0,0,.6)">知識對決</h2>
      <p style="color:#e8ddf5;font-size:14px;margin:0">${subtitle}</p>
    </div>
  </div>`;
}

/* ---- 著陸：競技場＋選領域＋指定對手 ---- */
async function renderLanding() {
  skeleton();
  announce("載入對決資訊");
  let me = null, tags = [], territory = null;
  try {
    const r = await swr("auth:me", "/auth/me");
    me = r.data?.user || r.data;
    const uid = me?.id;
    if (!uid) throw new Error("無法取得使用者資訊");
    const isl = await swr(`island:${uid}`, `/islands/${uid}`);
    tags = isl.data?.occupied_tags || [];
    territory = isl.data?.territory ?? null;
  } catch (e) {
    errorView(`載入失敗：${e.message}（${e.code || "未知"}）`, renderLanding);
    return;
  }

  const uid = me.id;
  const myName = me.name || "旅人";

  if (!tags.length) {
    view.innerHTML = arenaHero("在共同領域一決高下，勝者贏得星砂與榮耀") + `
      <div class="state-empty">
        <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
        <p>你還沒有佔領任何標籤，無法發起對決。<br>先去島嶼佔領一個知識標籤吧！</p>
        <a class="btn btn-primary" href="island.html">去佔領標籤</a>
      </div>`;
    focusMain();
    return;
  }

  view.innerHTML = arenaHero("在共同領域一決高下，勝者贏得星砂與榮耀") + `
    <div class="card" style="margin-bottom:16px;border:1px solid var(--line)">
      <h2 style="margin-top:0">🛡 選擇對決領域</h2>
      <p style="color:var(--muted);font-size:13px;margin:0 0 4px">只能用你已佔領的標籤開戰（對手也必須擁有該標籤）</p>
      <div role="radiogroup" aria-label="對決領域"
        style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px">` +
      tags.map((t, i) =>
        `<button class="d-tag" data-tag="${escapeHtml(t)}" role="radio"
          aria-checked="${i === 0}" aria-label="領域 ${escapeHtml(t)}"
          style="padding:12px 20px;border-radius:999px;font-size:15px;font-weight:700;cursor:pointer;
          border:2px solid ${i === 0 ? "#ffd97a" : "var(--line)"};
          background:${i === 0 ? "linear-gradient(135deg,#3d2b12,#6b4d1a)" : "var(--card)"};
          color:${i === 0 ? "#ffd97a" : "inherit"}">${escapeHtml(t)}</button>`
      ).join("") + `</div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h2 style="margin-top:0">🎯 指定對手</h2>
      <input id="d-opponent" type="text" placeholder="對手的使用者 ID（例如 u_xxxx）"
        aria-label="對手使用者 ID" autocomplete="off"
        style="width:100%;padding:14px 16px;border:1px solid var(--line);border-radius:12px;font-size:15px">
      <button class="btn btn-primary" id="d-start"
        style="width:100%;margin-top:14px;padding:16px;font-size:18px;font-weight:800;letter-spacing:4px;
        background:linear-gradient(135deg,#b8860b,#ffd97a);border:none;color:#2a1a05;cursor:pointer">
        ⚔ 開 戰
      </button>
      <p style="color:var(--muted);font-size:12px;text-align:center;margin:10px 0 0">
        ${myName}${territory !== null ? ` · 我的領土 ${escapeHtml(String(territory))}` : ""} · 領土差距過大將被拒絕出戰</p>
    </div>`;

  let selectedTag = tags[0];
  view.querySelectorAll(".d-tag").forEach(btn => {
    btn.onclick = () => {
      view.querySelectorAll(".d-tag").forEach(b => {
        b.setAttribute("aria-checked", "false");
        b.style.borderColor = "var(--line)";
        b.style.background = "var(--card)";
        b.style.color = "inherit";
      });
      btn.setAttribute("aria-checked", "true");
      btn.style.borderColor = "#ffd97a";
      btn.style.background = "linear-gradient(135deg,#3d2b12,#6b4d1a)";
      btn.style.color = "#ffd97a";
      selectedTag = btn.dataset.tag;
      announce(`已選擇領域 ${selectedTag}`);
    };
  });

  document.getElementById("d-start").onclick = () => {
    const opp = document.getElementById("d-opponent").value.trim();
    if (!opp) { announce("請輸入對手的使用者 ID"); return; }
    if (opp === uid) { announce("不能跟自己對決"); return; }
    startDuel({ uid, myName, territory }, opp, selectedTag);
  };
  focusMain();
}

/* ---- 發起對決 → VS 畫面 ---- */
async function startDuel(me, opponentId, tag) {
  skeleton(220);
  announce("正在建立對決，雙方入場");
  try {
    const duel = await post("/duels", {
      challenger_id: me.uid,
      opponent_id: opponentId,
      tag,
    });
    const duelId = duel.duel_id ?? duel.id;
    const questions = duel.questions || [];
    if (!duelId || !questions.length) throw new Error("對決建立失敗，後端未回傳題目");
    announce(duel.reason || "對決成立，雙方入場");
    renderVS(duelId, me, opponentId, tag, questions);
  } catch (e) {
    errorView(`對決發起失敗：${e.message}（${e.code || "未知"}）`, renderLanding);
  }
}

/* VS 畫面：左右雙方＋中央 VS */
function renderVS(duelId, me, opponentId, tag, questions) {
  const fighterCard = (name, sub, side) => `
    <div style="flex:1;min-width:0;text-align:${side};padding:16px;border-radius:14px;
      background:linear-gradient(135deg,rgba(20,12,40,.92),rgba(60,30,90,.92));
      border:1px solid ${side === "left" ? "#4da3ff" : "#ff5a5a"}">
      <div style="font-size:12px;letter-spacing:3px;color:var(--muted)">
        ${side === "left" ? "🔵 挑戰者" : "🔴 應戰者"}</div>
      <div style="font-size:18px;font-weight:800;color:#fff;margin:6px 0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(name)}</div>
      <div style="font-size:13px;color:#d9cdf0">${sub}</div>
    </div>`;

  view.innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      <p style="color:#ffd97a;letter-spacing:4px;font-size:12px;margin:0 0 4px">領域 · ${escapeHtml(tag)}</p>
      <p style="color:var(--muted);font-size:13px;margin:0">共 ${questions.length} 回合</p>
    </div>
    <div style="display:flex;align-items:stretch;gap:10px;margin-bottom:20px">
      ${fighterCard(me.myName, me.territory !== null ? `領土 ${escapeHtml(String(me.territory))}` : "旅人", "left")}
      <div style="display:flex;align-items:center;justify-content:center;min-width:64px">
        <span style="font-size:38px;font-weight:900;font-style:italic;color:#ff5a5a;
          text-shadow:0 0 18px rgba(255,90,90,.55)">VS</span>
      </div>
      ${fighterCard(opponentId, "應戰者", "right")}
    </div>
    <button class="btn btn-primary" id="d-enter"
      style="width:100%;padding:16px;font-size:17px;font-weight:800;letter-spacing:3px;
      background:linear-gradient(135deg,#b8860b,#ffd97a);border:none;color:#2a1a05;cursor:pointer">
      🥊 進入第 1 回合
    </button>`;

  document.getElementById("d-enter").onclick = () =>
    renderRound(duelId, me, opponentId, tag, questions, 0, new Array(questions.length).fill(null));
  announce(`對決成立，${me.myName} 對戰 ${opponentId}，共 ${questions.length} 回合`);
  focusMain();
}

/* ---- 逐題對戰：一題一畫面 ---- */
function renderRound(duelId, me, opponentId, tag, questions, idx, answers) {
  const q = questions[idx];
  const total = questions.length;
  const opts = q.options || q.choices || [];
  const picked = answers[idx];

  const dots = questions.map((_, i) =>
    `<span aria-hidden="true" style="display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 3px;
      background:${i < idx ? "#4caf50" : i === idx ? "#ffd97a" : "var(--line)"}"></span>`
  ).join("");

  view.innerHTML = `
    <div style="text-align:center;margin-bottom:12px" aria-label="第 ${idx + 1} 回合，共 ${total} 回合">
      <div style="margin-bottom:8px">${dots}</div>
      <p style="color:#ffd97a;letter-spacing:4px;font-size:12px;margin:0">ROUND ${idx + 1} / ${total}</p>
    </div>
    <div class="card" style="margin-bottom:16px;border:1px solid var(--line)">
      <h3 style="margin-top:0;font-size:17px;line-height:1.6">${escapeHtml(q.question || q.text || "")}</h3>
      <div role="radiogroup" aria-label="第 ${idx + 1} 回合選項" style="margin-top:12px">` +
      opts.map((opt, j) => {
        const isPicked = picked === j;
        const locked = picked !== null;
        return `<button class="q-opt" data-o="${j}" role="radio"
          aria-checked="${isPicked}" ${locked && !isPicked ? "disabled" : ""}
          aria-label="選項：${escapeHtml(String(opt))}${isPicked ? "（已選擇）" : ""}"
          style="display:flex;align-items:center;justify-content:space-between;gap:8px;
          width:100%;text-align:left;padding:15px 16px;margin-top:10px;font-size:15px;cursor:${locked ? "default" : "pointer"};
          border:2px solid ${isPicked ? "#ffd97a" : "var(--line)"};border-radius:12px;
          background:${isPicked ? "linear-gradient(135deg,#3d2b12,#5c441a)" : "var(--card)"};
          color:${isPicked ? "#ffd97a" : "inherit"};
          opacity:${locked && !isPicked ? ".55" : "1"}">
          <span>${escapeHtml(String(opt))}</span>
          ${isPicked ? `<span style="font-size:13px;font-weight:800;white-space:nowrap">✓ 已選擇</span>` : ""}
        </button>`;
      }).join("") + `</div>
    </div>
    <div style="display:flex;gap:10px">
      ${idx > 0 ? `<button class="btn btn-ghost" id="d-prev" style="padding:14px 20px">← 上一題</button>` : ""}
      <button class="btn btn-primary" id="d-next" ${picked === null ? "disabled" : ""}
        style="flex:1;padding:14px;font-size:16px;font-weight:800;letter-spacing:2px;opacity:${picked === null ? ".45" : "1"}">
        ${idx === total - 1 ? "⚔ 出招結算" : "下一題 →"}
      </button>
    </div>
    <p style="color:var(--muted);font-size:12px;text-align:center;margin-top:10px">選定後鎖定，可按「上一題」回去修改</p>`;

  view.querySelectorAll(".q-opt[data-o]:not([disabled])").forEach(btn => {
    btn.onclick = () => {
      answers[idx] = +btn.dataset.o;
      announce(`第 ${idx + 1} 回合已選擇`);
      renderRound(duelId, me, opponentId, tag, questions, idx, answers);
    };
  });

  const prev = document.getElementById("d-prev");
  if (prev) prev.onclick = () => renderRound(duelId, me, opponentId, tag, questions, idx - 1, answers);

  document.getElementById("d-next").onclick = async () => {
    if (answers[idx] === null) { announce("請先選擇一個答案"); return; }
    if (idx < total - 1) {
      announce(`進入第 ${idx + 2} 回合`);
      renderRound(duelId, me, opponentId, tag, questions, idx + 1, answers);
      return;
    }
    // 最後一題 → 結算
    skeleton(120);
    announce("雙方出招完畢，結算中");
    try {
      const r = await post(`/duels/${duelId}/answers`, { user_id: me.uid, answers });
      renderResult(r, total, tag);
    } catch (e) {
      errorView(`結算失敗：${e.message}（${e.code || "未知"}）`,
        () => renderRound(duelId, me, opponentId, tag, questions, idx, answers));
    }
  };
  focusMain();
}

/* ---- 結果：勝敗大字＋比分＋逐回合回顧 ---- */
function renderResult(r, total, tag) {
  const score = r.your_score ?? r.score ?? 0;
  const feedback = r.feedback || [];
  const win = score >= Math.ceil(total / 2);

  view.innerHTML = `
    <div style="text-align:center;border-radius:16px;padding:36px 20px;margin-bottom:20px;
      background:${win
        ? "linear-gradient(135deg,#3d2b12 0%,#6b4d1a 60%,#8a6a1f 100%)"
        : "linear-gradient(135deg,#1c1c26 0%,#2c2c3a 100%)"};
      border:2px solid ${win ? "#ffd97a" : "var(--line)"}">
      <p style="font-size:44px;margin:0 0 8px">${win ? "🏆" : "🛡"}</p>
      <h2 style="font-size:34px;margin:0 0 8px;letter-spacing:8px;
        color:${win ? "#ffd97a" : "var(--muted)"}">${win ? "勝 利" : "敗 北"}</h2>
      <p style="font-size:15px;color:${win ? "#f5e6c4" : "var(--muted)"};margin:0 0 12px">
        領域 · ${escapeHtml(tag || "")}</p>
      <p style="font-size:46px;font-weight:900;margin:0;color:#fff"
        aria-label="得分 ${score}，共 ${r.total ?? total} 題">${score}
        <span style="font-size:20px;color:var(--muted)">/ ${r.total ?? total}</span></p>
      ${r.settled
        ? `<p style="color:#a8e6a3;font-size:13px;margin:12px 0 0">✓ 對決已結算</p>`
        : `<p style="color:var(--muted);font-size:13px;margin:12px 0 0">等待對手作答後結算</p>`}
    </div>` +
    (feedback.length ? `<h2 style="margin:0 0 12px">📜 逐回合回顧</h2>` +
      feedback.map(fb => `
        <div class="card" style="margin-bottom:12px;
          border-left:5px solid ${fb.correct ? "#4caf50" : "#f44336"}">
          <h3 style="margin-top:0">第 ${fb.round} 回合
            <span style="color:${fb.correct ? "#4caf50" : "#f44336"}">${fb.correct ? "✅ 答對" : "❌ 答錯"}</span></h3>
          <p>你的選擇：<strong>${escapeHtml(fb.your_choice ?? "")}</strong></p>
          ${fb.correct ? "" : `<p>正確答案：<strong style="color:#4caf50">${escapeHtml(fb.correct_answer ?? "")}</strong></p>`}
          ${fb.concept_note ? `<div style="margin-top:10px;padding:10px 12px;border-radius:8px;
            background:var(--card);border:1px dashed var(--line)">
            <p style="font-size:12px;color:var(--muted);margin:0 0 4px">💡 觀念提醒</p>
            <p style="font-size:13px;margin:0">${escapeHtml(fb.concept_note)}</p></div>` : ""}
        </div>`).join("") : "") + `
    <div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn btn-primary" id="d-again" style="padding:14px 28px;font-size:16px;font-weight:800">⚔ 再戰一場</button>
      <a class="btn btn-ghost" href="bookshelf.html" style="padding:14px 20px">回書架</a>
    </div>`;

  document.getElementById("d-again").onclick = renderLanding;
  announce(`對決結束：${win ? "勝利" : "敗北"}，得分 ${score}，共 ${r.total ?? total} 題`);
  focusMain();
}

/* ---- 啟動 ---- */
(function init() {
  if (!isLoggedIn()) { loginView(); return; }
  renderLanding();
})();
