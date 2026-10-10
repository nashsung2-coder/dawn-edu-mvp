/* 複習任務：SM-2 間隔重複，一張一張複習到期卡片。
 * 流程：統計 → 逐張複習（問題 → 顯示提示 → 0-5 自評 → 下次間隔） → 完成慶祝。
 * 全鏈路調真實後端，零假數據。
 * 生命週期：init → loading → api → render / empty / error
 */
import { swr, post, get } from "../core/api.js";
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
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---- 資料正規化（防禦式：後端形狀以契約為準，多寫相容） ---- */
function normCards(r) {
  const d = r?.data ?? r;
  const arr = d?.cards ?? d?.due ?? d?.items ?? (Array.isArray(d) ? d : []);
  return Array.isArray(arr) ? arr : [];
}
function cardId(c) { return c.id ?? c.card_id ?? c.cid ?? ""; }
function cardQuestion(c) { return c.question ?? c.front ?? c.title ?? c.topic ?? "未命名卡片"; }
function cardHint(c) { return c.hint ?? c.answer_hint ?? c.answer ?? c.back ?? ""; }
function cardTopic(c) { return c.topic ?? c.subject ?? ""; }
function normStats(r) {
  const d = r?.data ?? r ?? {};
  return {
    total: d.total_cards ?? d.total ?? 0,
    due: d.due_count ?? d.due ?? 0,
    reviewed: d.reviewed_count ?? d.reviewed ?? 0,
    rate: d.completion_rate ?? d.rate ?? 0,
  };
}
function normUpcoming(r) {
  const d = r?.data ?? r;
  const arr = d?.upcoming ?? d?.items ?? (Array.isArray(d) ? d : []);
  return Array.isArray(arr) ? arr : [];
}
function normTier(r) {
  const d = r?.data ?? r ?? {};
  return {
    tier: d.tier ?? "basic",
    name: d.tier_name ?? d.name ?? "基礎版",
    battlesLeft: d.daily_battles_left ?? d.battles_left ?? null,
  };
}

/* ---- 著陸：統計卡＋方案＋開始按鈕 ---- */
async function renderLanding() {
  skeleton();
  let stats = normStats({}), upcoming = [], tier = normTier({}), dueCards = [];
  let failed = false;
  try {
    const [s, u, t, d] = await Promise.allSettled([
      swr("learn:review:stats", "/learn/review/stats"),
      swr("learn:review:upcoming", "/learn/review/upcoming"),
      swr("tier", "/tier"),
      swr("learn:review:due", "/learn/review/due"),
    ]);
    if (s.status === "fulfilled") stats = normStats(s.value);
    if (u.status === "fulfilled") upcoming = normUpcoming(u.value);
    if (t.status === "fulfilled") tier = normTier(t.value);
    if (d.status === "fulfilled") dueCards = normCards(d.value);
    if (s.status === "rejected" && d.status === "rejected") failed = true;
  } catch (e) {
    console.warn("[review] landing failed:", e.code);
    failed = true;
  }
  if (failed) {
    errorView("複習資料載入失敗，請稍後再試", renderLanding);
    return;
  }

  const ratePct = Math.round((stats.rate > 1 ? stats.rate : stats.rate * 100) || 0);
  const upcomingHtml = upcoming.length
    ? `<div class="r-upcoming"><h2>即將到期</h2>` + upcoming.slice(0, 5).map(x => {
        const days = x.days_until ?? x.days ?? x.in_days ?? 0;
        const count = x.count ?? x.cards ?? 1;
        return `<div class="r-urow"><span>${escapeHtml(String(days))} 天後</span><span>${escapeHtml(String(count))} 張</span></div>`;
      }).join("") + `</div>`
    : "";

  view.innerHTML = `<div class="r-landing">
    <img src="../assets/img/emblem-review.webp?v=3.0.0" alt="複習徽章">
    <h2>間隔重複複習</h2>
    <p>學過的東西會遺忘——SM-2 演算法在你快要忘記時提醒你複習。<br>誠實自評，記得越牢，間隔越長。</p>
    <div class="r-stats" role="list" aria-label="複習統計">
      <div class="r-stat" role="listitem"><strong>${stats.due}</strong><span>今日到期</span></div>
      <div class="r-stat" role="listitem"><strong>${stats.total}</strong><span>卡片總數</span></div>
      <div class="r-stat" role="listitem"><strong>${ratePct}%</strong><span>完成率</span></div>
    </div>
    <div class="r-tier">
      <span class="r-tier-badge ${tier.tier === "basic" ? "basic" : "plus"}">${escapeHtml(tier.name)}</span>
      ${tier.battlesLeft !== null ? `<span>今日剩餘戰役 ${escapeHtml(String(tier.battlesLeft))} 場</span>` : ""}
    </div>
    ${dueCards.length
      ? `<button class="btn btn-primary r-start" id="r-start">開始複習（${dueCards.length} 張）</button>`
      : `<div class="state-empty">
           <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
           <p>今天沒有到期的卡片，好好休息吧。</p>
           <a class="btn btn-ghost" href="quiz.html">去費曼戰役學新的</a>
         </div>`}
    ${upcomingHtml}
  </div>`;

  const startBtn = document.getElementById("r-start");
  if (startBtn) startBtn.onclick = () => renderCard(dueCards, 0, stats);
  focusMain();
}

/* ---- 逐張複習：問題 → 顯示提示 → 自評 ---- */
function renderCard(cards, idx, stats) {
  const card = cards[idx];
  const total = cards.length;
  const q = cardQuestion(card);
  const topic = cardTopic(card);

  view.innerHTML = `<div class="r-progress" role="progressbar" aria-valuenow="${idx + 1}"
      aria-valuemin="1" aria-valuemax="${total}" aria-label="複習進度">
      <div class="r-progress-fill" style="width:${Math.round(((idx + 1) / total) * 100)}%"></div>
    </div>
    <p class="r-count">第 ${idx + 1} / ${total} 張</p>
    <div class="card r-card">
      ${topic ? `<p class="r-topic">${escapeHtml(topic)}</p>` : ""}
      <h2 class="r-question">${escapeHtml(q)}</h2>
      <div id="r-hint-slot"></div>
      <button class="btn btn-ghost" id="r-show">顯示提示</button>
      <div id="r-grade-slot"></div>
    </div>`;

  document.getElementById("r-show").onclick = () => {
    const hint = cardHint(card);
    document.getElementById("r-hint-slot").innerHTML =
      `<div class="r-hint">${hint ? escapeHtml(hint) : "（這張卡片沒有提示）"}</div>`;
    document.getElementById("r-show").style.display = "none";
    renderGrades(cards, idx, stats);
    announce("已顯示提示，請誠實自評你的回憶程度");
  };
  focusMain();
}

function renderGrades(cards, idx, stats) {
  const card = cards[idx];
  const slot = document.getElementById("r-grade-slot");
  slot.innerHTML = `<p class="r-grade-title">你回憶起來了嗎？</p>
    <div class="r-grades" role="group" aria-label="自評等級">` +
    GRADES.map(g =>
      `<button class="r-grade g${g.v}" data-g="${g.v}" aria-label="${g.v} 分：${g.label}，${g.hint}">
         <strong>${g.v}</strong><span>${g.label}</span>
       </button>`
    ).join("") + `</div>`;

  slot.querySelectorAll(".r-grade").forEach(btn => {
    btn.onclick = () => gradeCard(cards, idx, stats, +btn.dataset.g, btn);
  });
}

async function gradeCard(cards, idx, stats, grade, btn) {
  btn.disabled = true;
  announce(`已評 ${grade} 分，記錄中`);
  const cid = cardId(cards[idx]);
  let nextDays = null;
  try {
    const r = await post(`/learn/review/${cid}/grade`, { grade });
    const d = r?.data ?? r ?? {};
    nextDays = d.next_interval_days ?? d.next_review_in_days ?? d.interval_days ?? d.next_days ?? null;
  } catch (e) {
    announce(`評分失敗：${e.message}，可重試`);
    btn.disabled = false;
    return;
  }
  const nextText = nextDays !== null ? `下次 ${nextDays} 天後再見` : "已排入下次複習";
  const slot = document.getElementById("r-grade-slot");
  slot.innerHTML = `<p class="r-next">${escapeHtml(nextText)}</p>
    <button class="btn btn-primary" id="r-next-btn">${idx + 1 < cards.length ? "下一張 →" : "完成 🎉"}</button>`;
  document.getElementById("r-next-btn").onclick = () => {
    if (idx + 1 < cards.length) renderCard(cards, idx + 1, stats);
    else renderDone(stats, cards.length);
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
    const r = await swr("auth:me", "/auth/me");
    const me = r.data?.user || r.data?.data || {};
    userline.textContent = `旅人 ${me.name || ""} · 溫故知新`;
  } catch { userline.textContent = "旅人"; }
  renderLanding();
})();
