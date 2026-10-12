/* 掌握度儀表板：主題掌握度 + 技能章 + 弱項提醒。
 * 全鏈路調真實後端，零假數據。
 * 生命週期：init → loading → api → render / empty / error
 */
import { supabase, getUser } from "../core/supabase.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("m-view");
const userline = document.getElementById("m-userline");

const MASTERED_AT = 0.6; // 掌握度 ≥60% 視為已掌握
const RARITY_COLORS = { "普通": "#9aa0a6", "稀有": "#4da3ff", "史詩": "#b16dff", "傳說": "#ffb300" };

function skeleton() {
  view.innerHTML = `<div class="skeleton" style="height:96px"></div>
    <div class="skeleton" style="height:20px;margin-top:12px"></div>
    <div class="skeleton" style="height:20px;margin-top:8px"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="燈籠插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="m-retry">重試</button></div>`;
  document.getElementById("m-retry").onclick = retry;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pct(v) {
  const n = Math.max(0, Math.min(1, Number(v) || 0));
  return Math.round(n * 100);
}
function rarityColor(r) { return RARITY_COLORS[r] || "#9aa0a6"; }

function masteryBar(topic, m) {
  const p = pct(m);
  return `<div class="m-topic">
    <div class="m-topic-head">
      <span class="m-topic-name">${escapeHtml(topic)}</span>
      <span class="m-topic-pct">${p}%</span>
    </div>
    <div class="m-bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0"
      aria-valuemax="100" aria-label="${escapeHtml(topic)}掌握度">
      <div class="m-bar-fill" style="width:${p}%"></div>
    </div>
  </div>`;
}

async function renderDashboard() {
  skeleton();
  announce("載入掌握度資料");
  try {
    const user = await getUser();
    if (!user) throw new Error("請先登入");

    // 從 battle_records 推算主題掌握度（feynman_score 平均）
    const { data: battles } = await supabase.from("battle_records")
      .select("question, feynman_score, badge_name, badge_rarity").eq("user_id", user.id);

    const topicMap = {};
    (battles || []).forEach(b => {
      const t = b.question || "未命名主題";
      if (!topicMap[t]) topicMap[t] = { scores: [] };
      topicMap[t].scores.push(Number(b.feynman_score) || 0);
    });
    const topics = Object.entries(topicMap).map(([topic, v]) => ({
      topic,
      mastery: v.scores.reduce((a, b) => a + b, 0) / v.scores.length / 100,
    }));
    const badges = (battles || []).filter(b => b.badge_name).map(b => ({
      name: b.badge_name, rarity: b.badge_rarity || "普通",
    }));
    const sessionList = battles || [];

    /* ---- 總覽 ---- */
    const mastered = topics.filter(t => (Number(t.mastery) || 0) >= MASTERED_AT);
    const avg = topics.length
      ? topics.reduce((s, t) => s + (Number(t.mastery) || 0), 0) / topics.length : 0;
    const statsHtml = `<section class="m-section" aria-label="總覽">
      <div class="m-stats">
        <div class="m-stat"><span class="m-stat-n">${mastered.length}</span><span class="m-stat-l">已掌握主題</span></div>
        <div class="m-stat"><span class="m-stat-n">${pct(avg)}%</span><span class="m-stat-l">平均掌握度</span></div>
        <div class="m-stat"><span class="m-stat-n">${badges.length}</span><span class="m-stat-l">技能章</span></div>
        <div class="m-stat"><span class="m-stat-n">${sessionList.length}</span><span class="m-stat-l">出戰次數</span></div>
      </div>
    </section>`;

    /* ---- 掌握度條 ---- */
    const sorted = [...topics].sort((a, b) => (Number(b.mastery) || 0) - (Number(a.mastery) || 0));
    const barsHtml = sorted.length
      ? `<section class="m-section" aria-label="主題掌握度">
          <h2>主題掌握度</h2>
          ${sorted.map(t => masteryBar(t.topic || "未命名主題", t.mastery)).join("")}
        </section>`
      : `<section class="m-section"><div class="state-empty">
          <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
          <p>還沒有掌握度紀錄。去打一場費曼戰役，儀表板就會亮起來。</p>
          <a class="btn btn-primary" href="quiz.html">開始第一戰</a></div></section>`;

    /* ---- 技能章 ---- */
    const badgesHtml = badges.length
      ? `<section class="m-section" aria-label="技能章">
          <h2>技能章 · ${badges.length}</h2>
          <div class="m-badges">` + badges.map(b => `
            <div class="m-badge" style="--rarity:${rarityColor(b.rarity)}">
              <h3>🏅 ${escapeHtml(b.name || "無名之章")}</h3>
              <p>稀有度 ${escapeHtml(b.rarity || "普通")}${b.archetype ? ` · ${escapeHtml(b.archetype)}` : ""}</p>
              <p class="m-badge-stats">攻擊 ${b.attack ?? "—"} · 防禦 ${b.defense ?? "—"}</p>
              ${b.ai_comment ? `<p>「${escapeHtml(b.ai_comment)}」</p>` : ""}
            </div>`).join("") + `</div></section>`
      : "";

    /* ---- 弱項提醒 ---- */
    const weak = [...topics]
      .sort((a, b) => (Number(a.mastery) || 0) - (Number(b.mastery) || 0))
      .slice(0, 3);
    const weakHtml = weak.length
      ? `<section class="m-section" aria-label="弱項提醒">
          <h2>弱項提醒</h2>
          <div class="m-weak">` + weak.map(t => {
          const p = pct(t.mastery);
          return `<div class="m-weak-row">
            <span class="m-topic-name">${escapeHtml(t.topic || "未命名主題")}</span>
            <div class="m-bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0"
              aria-valuemax="100" aria-label="${escapeHtml(t.topic || "")}掌握度">
              <div class="m-bar-fill" style="width:${p}%"></div>
            </div>
            <span class="m-weak-pct">${p}%</span>
            <a class="btn btn-ghost" href="quiz.html">去修煉</a>
          </div>`;
        }).join("") + `</div></section>`
      : "";

    view.innerHTML = statsHtml + barsHtml + badgesHtml + weakHtml;
    userline.textContent = topics.length ? `共 ${topics.length} 個主題` : "尚無學習紀錄";
    announce(`儀表板載入完成，${topics.length} 個主題，${badges.length} 枚技能章`);
    focusMain();
  } catch (e) {
    errorView(`載入失敗：${e.message}（${e.code || "未知"}）`, renderDashboard);
  }
}

/* ---- 啟動 ---- */
(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再查看掌握度儀表板</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    userline.textContent = "未登入";
    return;
  }
  try {
    const u = await getUser();
    let uname = "";
    if (u) {
      const { data: p } = await supabase.from("profiles").select("name").eq("id", u.id).single();
      uname = p?.name || "";
    }
    userline.textContent = `旅人 ${uname} · 載入中…`;
  } catch { /* 保持預設文案 */ }
  renderDashboard();
})();
