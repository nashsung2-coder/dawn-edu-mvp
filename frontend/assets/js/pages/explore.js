/* 探索冒險：區域列表 → 開始探索 → 劇情選擇 → 完成結算
 * 全鏈路調真實後端，零假數據。
 * 生命週期：init → loading → api → render / empty / error
 */
import { swr, post, get } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("x-view");
const userline = document.getElementById("x-userline");

function skeleton() {
  view.innerHTML = `<div class="skeleton" style="height:120px"></div>
    <div class="skeleton" style="height:20px;margin-top:12px"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="燈籠插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="x-retry">重試</button></div>`;
  document.getElementById("x-retry").onclick = retry;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function stageBar(stage, total) {
  if (!total || total < 1) return "";
  let dots = "";
  for (let i = 0; i < total; i++) {
    dots += `<span class="x-dot ${i < stage ? "done" : i === stage ? "now" : ""}" aria-hidden="true"></span>`;
  }
  return `<div class="x-stages" role="img" aria-label="探索進度：第 ${stage + 1} 幕，共 ${total} 幕">${dots}</div>`;
}

/* ---- 著陸：區域列表 + 探索紀錄 ---- */
async function renderLanding() {
  skeleton();
  let zones = [];
  try {
    const r = await get("/world/zones");
    zones = r.zones || r.data || r.items || [];
  } catch (e) {
    console.warn("[explore] zones failed:", e.code);
  }
  let history = [];
  try {
    const r = await swr("world:explore", "/world/explore");
    history = r.explorations || r.data || r.items || [];
  } catch (e) {
    console.warn("[explore] history failed:", e.code);
  }

  const zoneHtml = zones.length
    ? `<div class="x-zones">` + zones.map(z => `
        <div class="card x-zone">
          <h3>${escapeHtml(z.name || "未知區域")}</h3>
          <p>${escapeHtml(z.desc || z.description || "")}</p>
          ${z.stages ? `<p class="x-meta">${escapeHtml(String(z.stages))} 幕劇情</p>` : ""}
          <button class="btn btn-primary x-go" data-zone="${escapeHtml(z.name || "")}">開始探索</button>
        </div>`).join("") + `</div>`
    : `<div class="state-empty">
        <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
        <p>目前沒有可探索的區域</p></div>`;

  const histHtml = history.length
    ? `<div class="x-history"><h2>探索紀錄</h2>` + history.slice(0, 10).map(h => `
        <div class="x-hrow">
          <span>${escapeHtml(h.zone || "未知區域")}</span>
          <span>${h.status === "done" ? "完成" : h.status === "ongoing" ? "進行中" : escapeHtml(h.status || "")} · ${escapeHtml((h.created_at || "").slice(0, 10))}</span>
        </div>`).join("") + `</div>`
    : "";

  view.innerHTML = `<div class="x-landing">
    <img src="../assets/img/emblem-explore.webp?v=3.0.0" alt="探索冒險徽章">
    <h2>啟程</h2>
    <p>選一個區域出發。每個選擇都會引向不同的劇情——<br>沒有標準答案，只有屬於你的冒險。</p>
    </div>${zoneHtml}${histHtml}`;

  view.querySelectorAll(".x-go").forEach(btn => {
    btn.onclick = () => startExplore(btn.dataset.zone);
  });
  focusMain();
}

/* ---- 開始探索 ---- */
async function startExplore(zone) {
  skeleton();
  announce(`啟程前往${zone}`);
  try {
    const r = await post("/world/explore", { zone });
    const eid = r.id || r.exploration_id;
    if (!eid) throw new Error("後端未回傳探索 ID");
    lastTotal = r.total_stages ?? (r.zone_info && r.zone_info.stages) ?? 0;
    renderStory(eid, r);
  } catch (e) {
    errorView(`啟程失敗：${e.message}（${e.code || "未知"}）`, () => startExplore(zone));
  }
}

/* ---- 劇情：顯示當前幕 + 選項 ---- */
function renderStory(eid, data) {
  const cur = data.current || {};
  const choices = cur.choices || [];
  const stage = data.stage ?? 0;
  const total = data.total_stages ?? (data.zone_info && data.zone_info.stages) ?? 0;
  const hint = cur.hint || data.hint || "";

  view.innerHTML = `${stageBar(stage, total)}
    <div class="card x-story">
      <p class="x-zone-tag">${escapeHtml(data.zone || "")} · 第 ${stage + 1} 幕</p>
      <h2>${escapeHtml(cur.title || "劇情")}</h2>
      <p class="x-text">${escapeHtml(cur.text || "")}</p>
      ${hint ? `<p class="x-hint">💡 ${escapeHtml(hint)}</p>` : ""}
      <div class="x-choices" role="group" aria-label="劇情選項">
        ${choices.map((c, i) =>
          `<button class="x-opt" data-i="${i}">${escapeHtml(String(c))}</button>`).join("")}
      </div>
      <button class="btn btn-ghost" id="x-back" style="margin-top:12px">← 返回區域列表</button>
    </div>`;

  view.querySelectorAll(".x-opt").forEach(btn => {
    btn.onclick = () => choose(eid, +btn.dataset.i, data.zone);
  });
  document.getElementById("x-back").onclick = () => renderLanding();
  focusMain();
}

/* ---- 劇情選擇 ---- */
let lastTotal = 0;
async function choose(eid, index, zone) {
  skeleton();
  announce("做出選擇，劇情推進中");
  try {
    const r = await post(`/world/explore/${eid}/choose`, { choice_index: index });
    if (r.done) {
      renderDone(eid, r, zone);
    } else if (r.next) {
      // 用 choose 回傳的 next 拼出下一幕的資料形狀
      const stage = (r.trail && r.trail.length) ? r.trail.length : 0;
      renderStory(eid, {
        zone,
        stage,
        total_stages: lastTotal,
        current: r.next,
        hint: r.hint,
        choice: r.choice,
        trail: r.trail
      });
    } else {
      // 保底：重拉進度
      const fresh = await get(`/world/explore/${eid}`);
      renderStory(eid, fresh);
    }
  } catch (e) {
    errorView(`選擇失敗：${e.message}（${e.code || "未知"}）`, () => choose(eid, index, zone));
  }
}

/* ---- 完成：獎勵結算 ---- */
function renderDone(eid, result, zone) {
  const reward = result.reward || {};
  const trail = result.trail || [];
  const rewardLines = [];
  if (reward.starsand) rewardLines.push(`✨ 星砂 × ${escapeHtml(String(reward.starsand))}`);
  if (reward.pet) rewardLines.push(`🐾 獲得寵物！`);
  // 後端回什麼顯示什麼：列出未知獎勵鍵
  Object.keys(reward).forEach(k => {
    if (k !== "starsand" && k !== "pet" && reward[k]) {
      rewardLines.push(`🎁 ${escapeHtml(k)}：${escapeHtml(String(reward[k]))}`);
    }
  });

  view.innerHTML = `<div class="x-done">
    <img src="../assets/img/emblem-explore.webp?v=3.0.0" alt="探索冒險徽章">
    <h2>探索完成</h2>
    <p class="x-zone-tag">${escapeHtml(zone || "")}</p>
    ${result.hint ? `<p class="x-hint">💡 ${escapeHtml(result.hint)}</p>` : ""}
    ${trail.length ? `<div class="x-trail"><h3>你的足跡</h3>` +
      trail.map(t => `<div class="x-trow"><span>第 ${t.stage + 1} 幕 · ${escapeHtml(t.title || "")}</span><span>${escapeHtml(t.choice || "")}</span></div>`).join("") +
      `</div>` : ""}
    <div class="card x-reward">
      <h3>獲得獎勵</h3>
      ${rewardLines.length ? rewardLines.map(l => `<p>${l}</p>`).join("") : "<p>這次沒有額外獎勵，但收穫了故事。</p>"}
    </div>
    <div style="margin-top:16px">
      <button class="btn btn-primary" id="x-again">再探一處</button>
      <a class="btn btn-ghost" href="bookshelf.html" style="margin-left:8px">去書架看看</a>
    </div>
  </div>`;

  announce(`探索完成${rewardLines.length ? "，" + rewardLines.join("，") : ""}`);
  document.getElementById("x-again").onclick = () => renderLanding();
  focusMain();
}

/* ---- 啟動 ---- */
(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再開始探索冒險</p>
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
