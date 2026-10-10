/* 探索冒險：視覺小說風劇情探索（參照原神劇情演出）
 * 區域大卡片 → 場景圖＋對話框 → 樂觀選項回饋 → 時間線足跡 → 獎勵彈出
 * 全鏈路調真實後端，零假數據。
 * 生命週期：init → loading → api → render / empty / error
 */
import { swr, post, get } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("x-view");
const userline = document.getElementById("x-userline");
const IMG = "../assets/img/game";

/* 區域名 → 場景圖 */
const ZONE_IMG = {
  "迷霧群島": "zone-mist.webp",
  "回聲深淵": "zone-abyss.webp",
  "星砂荒漠": "zone-desert.webp",
};
function zoneImg(name) {
  const f = ZONE_IMG[name];
  return f ? `${IMG}/${f}?v=3.0.0` : null;
}

/* 注入視覺小說風樣式（只用裸名 token） */
function ensureStyle() {
  if (document.getElementById("x-vn-style")) return;
  const st = document.createElement("style");
  st.id = "x-vn-style";
  st.textContent = `
.x-zone-cards{display:grid;gap:var(--sp-5);margin:var(--sp-6) 0}
.x-zcard{border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;background:var(--card);cursor:pointer;transition:transform .25s var(--ease),box-shadow .25s var(--ease);text-align:left;width:100%;padding:0;color:inherit;font:inherit}
.x-zcard:hover,.x-zcard:focus-visible{transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,0,0,.18);outline:2px solid var(--accent);outline-offset:2px}
.x-zcard img{width:100%;height:190px;object-fit:cover;display:block}
.x-zcard-body{padding:var(--sp-5)}
.x-zcard-body h3{font-size:var(--fs-20);margin-bottom:var(--sp-2)}
.x-zcard-body p{color:var(--muted);font-size:var(--fs-14);margin-bottom:var(--sp-3)}
.x-zcard-cta{display:inline-block;font-size:var(--fs-14);font-weight:700;color:var(--accent)}
.x-scene{position:relative;border-radius:var(--r-lg);overflow:hidden;margin-bottom:var(--sp-5);border:1px solid var(--line)}
.x-scene img{width:100%;height:220px;object-fit:cover;display:block}
.x-scene-cap{position:absolute;left:0;right:0;bottom:0;padding:var(--sp-4) var(--sp-5);background:linear-gradient(transparent,rgba(0,0,0,.65));color:#fff;font-size:var(--fs-13)}
.x-dialog{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);padding:var(--sp-6);margin-bottom:var(--sp-5)}
.x-dialog h2{font-size:var(--fs-20);margin-bottom:var(--sp-3)}
.x-dialog .x-text{font-size:var(--fs-16);line-height:1.9;white-space:pre-wrap}
.x-note{background:var(--bg-soft);border:1px dashed var(--accent);border-radius:var(--r-md);padding:var(--sp-4);margin-bottom:var(--sp-6);font-size:var(--fs-13)}
.x-note b{color:var(--accent)}
.x-choice{display:block;width:100%;text-align:left;padding:var(--sp-5);margin-bottom:var(--sp-3);border:2px solid var(--line);border-radius:var(--r-md);background:var(--card);font-size:var(--fs-15);line-height:1.6;cursor:pointer;transition:border-color .15s var(--ease),background .15s var(--ease),transform .15s var(--ease)}
.x-choice:hover{border-color:var(--accent);background:var(--bg-soft);transform:translateX(6px)}
.x-choice:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.x-choice.picked{border-color:var(--accent);background:var(--bg-soft);opacity:.75}
.x-choice:disabled{cursor:default}
.x-stages{display:flex;gap:var(--sp-3);justify-content:center;align-items:center;margin-bottom:var(--sp-6)}
.x-dot{width:14px;height:14px;border-radius:50%;border:2px solid var(--line);transition:all .3s var(--ease)}
.x-dot.done{background:var(--accent);border-color:var(--accent)}
.x-dot.now{border-color:var(--accent);box-shadow:0 0 0 4px var(--bg-soft);transform:scale(1.25)}
.x-timeline{list-style:none;margin:var(--sp-4) 0;padding:0;text-align:left}
.x-timeline li{position:relative;padding:0 0 var(--sp-4) var(--sp-7);border-left:2px solid var(--line)}
.x-timeline li:last-child{border-left-color:transparent}
.x-timeline li::before{content:"";position:absolute;left:-7px;top:2px;width:12px;height:12px;border-radius:50%;background:var(--accent)}
.x-timeline .x-tl-stage{font-size:var(--fs-12);color:var(--muted)}
.x-timeline .x-tl-choice{font-size:var(--fs-14);margin-top:2px}
@keyframes x-pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.12);opacity:1}100%{transform:scale(1);opacity:1}}
.x-reward-pop{animation:x-pop .5s var(--ease) both}
.x-reward-big{font-size:var(--fs-32);font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums}
.x-flash{animation:x-flash .4s var(--ease)}
@keyframes x-flash{0%{opacity:.2}100%{opacity:1}}`;
  document.head.appendChild(st);
}

function skeleton() {
  view.innerHTML = `<div class="skeleton" style="height:220px;border-radius:var(--r-lg)"></div>
    <div class="skeleton" style="height:120px;margin-top:12px;border-radius:var(--r-lg)"></div>
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
  return String(s ?? "").replace(/[&<>"']/g, c =>
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

/* ---- 著陸：區域大卡片 + 探索紀錄 ---- */
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
    const d = r.data || {};
    history = d.explorations || d.data || d.items || (Array.isArray(d) ? d : []);
  } catch (e) {
    console.warn("[explore] history failed:", e.code);
  }

  const zoneHtml = zones.length
    ? `<div class="x-zone-cards">` + zones.map(z => {
        const name = z.name || "未知區域";
        const img = zoneImg(name);
        return `<button class="x-zcard x-go" data-zone="${escapeHtml(name)}" aria-label="前往${escapeHtml(name)}">
          ${img ? `<img src="${img}" alt="${escapeHtml(name)}場景" loading="lazy">` : ""}
          <span class="x-zcard-body">
            <h3>${escapeHtml(name)}</h3>
            <p>${escapeHtml(z.desc || z.description || "")}</p>
            <span class="x-zcard-cta">${escapeHtml(String(z.stages ?? "?"))} 幕劇情 → 啟程</span>
          </span>
        </button>`;
      }).join("") + `</div>`
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

/* ---- 劇情：場景圖 + 對話框 + 選項 ---- */
function renderStory(eid, data) {
  const cur = data.current || {};
  const choices = cur.choices || [];
  const stage = data.stage ?? 0;
  const total = data.total_stages ?? (data.zone_info && data.zone_info.stages) ?? 0;
  const hint = cur.hint || data.hint || "";
  const zoneName = data.zone || "";
  const img = zoneImg(zoneName);

  view.innerHTML = `${stageBar(stage, total)}
    ${img ? `<div class="x-scene">
      <img src="${img}" alt="${escapeHtml(zoneName)}場景">
      <div class="x-scene-cap">${escapeHtml(zoneName)} · 第 ${stage + 1} 幕</div>
    </div>` : `<p class="x-zone-tag">${escapeHtml(zoneName)} · 第 ${stage + 1} 幕</p>`}
    <div class="x-dialog x-flash">
      <h2>${escapeHtml(cur.title || "劇情")}</h2>
      <p class="x-text">${escapeHtml(cur.text || "")}</p>
    </div>
    ${hint ? `<div class="x-note"><b>📓 旅行者筆記：</b>${escapeHtml(hint)}</div>` : ""}
    <div class="x-choices" role="group" aria-label="劇情選項">
      ${choices.map((c, i) =>
        `<button class="x-choice" data-i="${i}"><span aria-hidden="true">▸ </span>${escapeHtml(String(c))}</button>`).join("")}
    </div>
    <button class="btn btn-ghost" id="x-back" style="margin-top:12px">← 返回區域列表</button>`;

  view.querySelectorAll(".x-choice").forEach(btn => {
    btn.onclick = () => choose(eid, +btn.dataset.i, btn, data.zone);
  });
  document.getElementById("x-back").onclick = () => renderLanding();
  focusMain();
}

/* ---- 劇情選擇：樂觀回饋 ---- */
let lastTotal = 0;
async function choose(eid, index, btn, zone) {
  // 樂觀回饋：立即標記選擇
  const all = view.querySelectorAll(".x-choice");
  all.forEach(b => { b.disabled = true; });
  btn.classList.add("picked");
  const label = btn.textContent.trim();
  announce(`選擇了：${label}，劇情推進中`);
  // 插入即時回饋條
  const fb = document.createElement("p");
  fb.className = "x-note";
  fb.innerHTML = `<b>已選擇：</b>${escapeHtml(label)} —— 劇情推進中…`;
  btn.parentElement.after(fb);

  try {
    const r = await post(`/world/explore/${eid}/choose`, { choice_index: index });
    if (r.done) {
      renderDone(eid, r, zone);
    } else if (r.next) {
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
      const fresh = await get(`/world/explore/${eid}`);
      renderStory(eid, fresh);
    }
  } catch (e) {
    // 失敗回滾：恢復選項
    all.forEach(b => { b.disabled = false; b.classList.remove("picked"); });
    fb.remove();
    announce(`選擇失敗：${e.message}，請再試一次`);
  }
}

/* ---- 完成：時間線足跡 + 獎勵彈出 ---- */
function renderDone(eid, result, zone) {
  const reward = result.reward || {};
  const trail = result.trail || [];
  const rewardLines = [];
  if (reward.starsand) rewardLines.push({ big: `✨ +${escapeHtml(String(reward.starsand))}`, small: "星砂" });
  if (reward.pet) rewardLines.push({ big: "🐾", small: "獲得寵物！" });
  Object.keys(reward).forEach(k => {
    if (k !== "starsand" && k !== "pet" && reward[k]) {
      rewardLines.push({ big: "🎁", small: `${k}：${reward[k]}` });
    }
  });

  view.innerHTML = `<div class="x-done">
    <h2>探索完成</h2>
    <p class="x-zone-tag">${escapeHtml(zone || "")}</p>
    ${result.hint ? `<div class="x-note"><b>📓 旅行者筆記：</b>${escapeHtml(result.hint)}</div>` : ""}
    ${trail.length ? `<h3 style="text-align:left;margin-top:var(--sp-6)">你的足跡</h3>
      <ol class="x-timeline">` +
      trail.map(t => `<li>
        <div class="x-tl-stage">第 ${t.stage + 1} 幕 · ${escapeHtml(t.title || "")}</div>
        <div class="x-tl-choice">▸ ${escapeHtml(t.choice || "")}</div>
      </li>`).join("") + `</ol>` : ""}
    <div class="card x-reward x-reward-pop">
      <h3>獲得獎勵</h3>
      ${rewardLines.length
        ? rewardLines.map(l => `<p><span class="x-reward-big">${l.big}</span><br><span>${escapeHtml(l.small)}</span></p>`).join("")
        : "<p>這次沒有額外獎勵，但收穫了故事。</p>"}
    </div>
    <div style="margin-top:16px">
      <button class="btn btn-primary" id="x-again">再探一處</button>
      <a class="btn btn-ghost" href="bookshelf.html" style="margin-left:8px">去書架看看</a>
    </div>
  </div>`;

  announce(`探索完成${rewardLines.length ? "，獲得 " + rewardLines.map(l => l.small).join("、") : ""}`);
  document.getElementById("x-again").onclick = () => renderLanding();
  focusMain();
}

/* ---- 啟動 ---- */
(async function init() {
  ensureStyle();
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再開始探索冒險</p>
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
