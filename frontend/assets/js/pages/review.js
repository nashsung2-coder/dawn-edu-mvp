/* 複習任務：SM-2 間隔重複，一張一張複習到期卡片。
 * v4.0：直讀 Supabase review_cards 表，不再經 Render 後端。
 * 流程：統計 → 逐張複習（問題 → 顯示提示 → 0-5 自評 → 下次間隔） → 完成慶祝。
 * 生命週期：init → loading → render / empty / error
 */
import { supabase, getUser } from "../core/supabase.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("r-view");
const userline = document.getElementById("r-userline");

/* SM-2 自評等級文案 */
const GRADES = [
  { v: 0, label: "完全忘記", hint: "一點印象都沒有" },
  { v: 1, label: "想起一點", hint: "錯誤但有模糊印象" },
  { v: 2, label: "勉強想起", hint: "猶豫很久才想起" },
  { v: 3, label: "想起來了", hint: "有點卡但答對了" },
  { v: 4, label: "順利回憶", hint: "稍作思考即想起" },
  { v: 5, label: "輕鬆回憶", hint: "毫不費力" },
];

function skeleton() {
  view.innerHTML = `<div class="skeleton" style="height:120px"></div>
    <div class="skeleton" style="height:20px;margin-top:12px"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="燈籠插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="r-retry">重試</button></div>`;
  document.getElementById("r-retry").onclick = retry;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---- SM-2 演算法 ---- */
function sm2(card, grade) {
  let { ease_factor = 2.5, interval_days = 1, repetitions = 0 } = card;
  if (grade >= 3) {
    if (repetitions === 0) interval_days = 1;
    else if (repetitions === 1) interval_days = 6;
    else interval_days = Math.round(interval_days * ease_factor);
    repetitions += 1;
    ease_factor = ease_factor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  } else {
    repetitions = 0;
    interval_days = 1;
  }
  ease_factor = Math.max(1.3, ease_factor);
  const next = new Date();
  next.setDate(next.getDate() + interval_days);
  return { ease_factor, interval_days, repetitions, next_review_at: next.toISOString() };
}

/* ---- 資料讀取 ---- */
async function loadReviewData(userId) {
  const now = new Date().toISOString();
  const [dueRes, totalRes, upcomingRes] = await Promise.all([
    supabase.from("review_cards").select("*").eq("user_id", userId)
      .lte("next_review_at", now).order("next_review_at", { ascending: true }),
    supabase.from("review_cards").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("review_cards").select("next_review_at").eq("user_id", userId)
      .gt("next_review_at", now).order("next_review_at", { ascending: true }).limit(20),
  ]);
  if (dueRes.error) throw dueRes.error;
  const dueCards = dueRes.data || [];
  const total = totalRes.count ?? 0;
  // 即將到期：按天分組
  const upcomingMap = {};
  (upcomingRes.data || []).forEach(c => {
    const days = Math.ceil((new Date(c.next_review_at) - Date.now()) / 86400000);
    upcomingMap[days] = (upcomingMap[days] || 0) + 1;
  });
  const upcoming = Object.entries(upcomingMap)
    .map(([days, count]) => ({ days: +days, count }))
    .sort((a, b) => a.days - b.days).slice(0, 5);
  return { dueCards, stats: { total, due: dueCards.length, rate: 0 }, upcoming };
}

/* ---- 著陸：統計卡＋開始按鈕 ---- */
async function renderLanding() {
  skeleton();
  let dueCards = [], stats = { total: 0, due: 0, rate: 0 }, upcoming = [];
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("登入已過期，請重新登入");
    const data = await loadReviewData(user.id);
    dueCards = data.dueCards; stats = data.stats; upcoming = data.upcoming;
  } catch (e) {
    errorView(`複習資料載入失敗：${e.message}`, renderLanding);
    return;
  }

  const upcomingHtml = upcoming.length
    ? `<div class="r-upcoming"><h2>即將到期</h2>` + upcoming.map(x =>
        `<div class="r-urow"><span>${escapeHtml(String(x.days))} 天後</span><span>${escapeHtml(String(x.count))} 張</span></div>`
      ).join("") + `</div>`
    : "";

  view.innerHTML = `<div class="r-landing">
    <img src="../assets/img/emblem-review.webp?v=3.0.0" alt="複習徽章">
    <h2>間隔重複複習</h2>
    <p>學過的東西會遺忘——SM-2 演算法在你快要忘記時提醒你複習。<br>誠實自評，記得越牢，間隔越長。</p>
    <div class="r-stats" role="list" aria-label="複習統計">
      <div class="r-stat" role="listitem"><strong>${stats.due}</strong><span>今日到期</span></div>
      <div class="r-stat" role="listitem"><strong>${stats.total}</strong><span>卡片總數</span></div>
    </div>
    ${dueCards.length
      ? `<div class="r-mode-select" style="margin:16px 0">
           <p style="font-size:14px;color:var(--muted);margin-bottom:8px">選擇複習模式</p>
           <div style="display:flex;gap:12px;justify-content:center">
             <button class="btn btn-ghost" id="r-mode-flow" style="flex:1;max-width:200px">
               <strong>心流複習</strong><br>
               <span style="font-size:12px">安靜專注，無時間壓力</span>
             </button>
             <button class="btn btn-ghost" id="r-mode-game" style="flex:1;max-width:200px">
               <strong>遊戲化複習</strong><br>
               <span style="font-size:12px">挑戰模式，答對集氣</span>
             </button>
           </div>
         </div>
         <button class="btn btn-primary r-start" id="r-start" hidden>開始複習（${dueCards.length} 張）</button>`
      : `<div class="state-empty">
           <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
           <p>今天沒有到期的卡片，好好休息吧。</p>
           <a class="btn btn-ghost" href="quiz.html">去費曼戰役學新的</a>
         </div>`}
    ${upcomingHtml}
  </div>`;

  const startBtn = document.getElementById("r-start");
  const flowBtn = document.getElementById("r-mode-flow");
  const gameBtn = document.getElementById("r-mode-game");
  let reviewMode = "flow";
  if (flowBtn) {
    flowBtn.onclick = () => {
      reviewMode = "flow";
      flowBtn.classList.add("btn-primary"); flowBtn.classList.remove("btn-ghost");
      gameBtn.classList.remove("btn-primary"); gameBtn.classList.add("btn-ghost");
      startBtn.hidden = false;
      startBtn.textContent = `開始心流複習（${dueCards.length} 張）`;
    };
    gameBtn.onclick = () => {
      reviewMode = "game";
      gameBtn.classList.add("btn-primary"); gameBtn.classList.remove("btn-ghost");
      flowBtn.classList.remove("btn-primary"); flowBtn.classList.add("btn-ghost");
      startBtn.hidden = false;
      startBtn.textContent = `開始遊戲化複習（${dueCards.length} 張）`;
    };
  }
  if (startBtn) startBtn.onclick = () => renderCard(dueCards, 0, stats, reviewMode);
  focusMain();
}

/* ---- 逐張複習：問題 → 顯示提示 → 自評 ---- */
function renderCard(cards, idx, stats, mode = "flow") {
  const card = cards[idx];
  const total = cards.length;
  const q = card.question || "未命名卡片";
  const topic = card.topic || "";
  const isGame = mode === "game";

  view.innerHTML = `<div class="r-progress" role="progressbar" aria-valuenow="${idx + 1}"
      aria-valuemin="1" aria-valuemax="${total}" aria-label="複習進度">
      <div class="r-progress-fill" style="width:${Math.round(((idx + 1) / total) * 100)}%"></div>
    </div>
    <p class="r-count">第 ${idx + 1} / ${total} 張${isGame ? " · 遊戲化模式" : " · 心流模式"}</p>
    <div class="card r-card">
      ${topic ? `<p class="r-topic">${escapeHtml(topic)}</p>` : ""}
      <h2 class="r-question">${escapeHtml(q)}</h2>
      <div id="r-hint-slot"></div>
      <button class="btn btn-ghost" id="r-show">顯示提示</button>
      <div id="r-grade-slot"></div>
    </div>`;

  document.getElementById("r-show").onclick = () => {
    const hint = card.hint || card.answer || "";
    document.getElementById("r-hint-slot").innerHTML =
      `<div class="r-hint">${hint ? escapeHtml(hint) : "（這張卡片沒有提示）"}</div>`;
    document.getElementById("r-show").style.display = "none";
    renderGrades(cards, idx, stats, mode);
    announce("已顯示提示，請誠實自評你的回憶程度");
  };
  focusMain();
}

function renderGrades(cards, idx, stats, mode = "flow") {
  const slot = document.getElementById("r-grade-slot");
  const isGame = mode === "game";
  slot.innerHTML = `<p class="r-grade-title">${isGame ? "回憶成功！選擇你的掌握度" : "你回憶起來了嗎？"}</p>
    <div class="r-grades" role="group" aria-label="自評等級">` +
    GRADES.map(g =>
      `<button class="r-grade g${g.v}" data-g="${g.v}" aria-label="${g.v} 分：${g.label}，${g.hint}">
         <strong>${g.v}</strong><span>${g.label}</span>
       </button>`
    ).join("") + `</div>`;

  slot.querySelectorAll(".r-grade").forEach(btn => {
    btn.onclick = () => gradeCard(cards, idx, stats, +btn.dataset.g, btn, mode);
  });
}

async function gradeCard(cards, idx, stats, grade, btn, mode = "flow") {
  btn.disabled = true;
  announce(`已評 ${grade} 分，記錄中`);
  const card = cards[idx];
  let nextDays = null;
  try {
    const result = sm2(card, grade);
    nextDays = result.interval_days;
    const { error } = await supabase.from("review_cards").update({
      ease_factor: result.ease_factor,
      interval_days: result.interval_days,
      repetitions: result.repetitions,
      next_review_at: result.next_review_at,
      last_reviewed_at: new Date().toISOString(),
    }).eq("id", card.id);
    if (error) throw error;
    // 更新本地卡片狀態
    Object.assign(card, result);
  } catch (e) {
    announce(`評分失敗：${e.message}，可重試`);
    btn.disabled = false;
    return;
  }
  const nextText = nextDays !== null ? `下次 ${nextDays} 天後再見` : "已排入下次複習";
  const slot = document.getElementById("r-grade-slot");
  const q = card.question || "";
  const hint = card.hint || card.answer || "";
  slot.innerHTML = `<p class="r-next">${escapeHtml(nextText)}</p>
    <button class="btn btn-ghost" id="r-save-node" style="margin-bottom:8px">存入知識倉庫</button>
    <div id="r-node-form" hidden style="margin-bottom:12px;text-align:left">
      <input id="r-node-concepts" type="text" placeholder="相關概念（用逗號分隔，如：光合作用，葉綠體）"
        style="width:100%;padding:8px;margin-bottom:8px" aria-label="相關概念">
      <label style="font-size:13px"><input type="checkbox" id="r-node-public" checked> 公開分享（加入學習網絡）</label>
      <button class="btn btn-primary" id="r-node-submit" style="margin-top:8px">確認存入</button>
    </div>
    <button class="btn btn-primary" id="r-next-btn">${idx + 1 < cards.length ? "下一張" : "完成"}</button>`;
  document.getElementById("r-next-btn").onclick = () => {
    if (idx + 1 < cards.length) renderCard(cards, idx + 1, stats, mode);
    else renderDone(stats, cards.length);
  };
  // 存入知識倉庫
  document.getElementById("r-save-node").onclick = () => {
    const form = document.getElementById("r-node-form");
    form.hidden = !form.hidden;
  };
  document.getElementById("r-node-submit").onclick = async () => {
    const concepts = document.getElementById("r-node-concepts").value
      .split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const isPublic = document.getElementById("r-node-public").checked;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("profiles").select("name").eq("id", user.id).single();
      const { error } = await supabase.from("knowledge_nodes").insert({
        user_id: user.id,
        title: q.slice(0, 100),
        question: q,
        answer: hint,
        explanation: hint,
        concepts,
        is_public: isPublic,
        owner_name: profile?.name || "匿名",
        source: "review",
      });
      if (error) throw error;
      announce("已存入知識倉庫");
      document.getElementById("r-save-node").textContent = "已存入知識倉庫";
      document.getElementById("r-save-node").disabled = true;
      document.getElementById("r-node-form").hidden = true;
    } catch (e) {
      announce(`存入失敗：${e.message}`);
    }
  };
  document.getElementById("r-next-btn").focus();
}

/* ---- 全部完成 ---- */
function renderDone(stats, doneCount) {
  view.innerHTML = `<div class="r-done">
    <img src="../assets/img/emblem-review.webp?v=3.0.0" alt="複習徽章">
    <h2>今日複習完成！</h2>
    <p>完成了 ${doneCount} 張卡片，記憶又加固了一層。</p>
    <div class="r-stats" role="list" aria-label="複習統計">
      <div class="r-stat" role="listitem"><strong>${doneCount}</strong><span>本次完成</span></div>
      <div class="r-stat" role="listitem"><strong>${stats.total}</strong><span>卡片總數</span></div>
    </div>
    <div style="margin-top:16px">
      <a class="btn btn-primary" href="quiz.html">去學新的</a>
      <a class="btn btn-ghost" href="mastery.html" style="margin-left:8px">看掌握度</a>
    </div>
  </div>`;
  announce(`複習完成，共 ${doneCount} 張`);
  focusMain();
}

/* ---- 啟動 ---- */
(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再開始複習</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    userline.textContent = "未登入";
    return;
  }
  try {
    const user = await getUser();
    const { data: profile } = await supabase.from("profiles").select("name").eq("id", user.id).single();
    userline.textContent = `旅人 ${profile?.name || ""} · 溫故知新`;
  } catch { userline.textContent = "旅人"; }
  renderLanding();
})();
