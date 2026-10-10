/* 島嶼世界：島嶼總覽 → 開疆拓土 → 佔領標籤 → 領土日誌 → 探索 → 建造 → 寵物
 * 全鏈路調真實後端，零假數據。
 * 生命週期：init → loading → api → render / empty / error
 * 樣式僅用 base.css / island.css 已有 class + inline style（不新增 CSS 檔）。
 */
import { swr, post, get } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("i-view");
const sub = document.getElementById("i-sub");

const EXPAND_ACTIONS = [
  { key: "complete_topic", label: "完成主題" },
  { key: "fix_myth", label: "破除迷思" },
  { key: "ask_question", label: "提出好問題" },
  { key: "complete_quest", label: "完成任務" },
  { key: "co_study", label: "共學" },
];
const BUILD_TYPES = ["圖書館", "訓練場", "瞭望塔"];

/* inline 樣式（base.css 沒有這些元件） */
const S = {
  tabs: "display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap",
  tabBase: "padding:10px 18px;border:1px solid var(--line);border-radius:var(--r-full);font-size:14px;background:transparent;cursor:pointer",
  tabNow: "background:var(--accent,#4f8cff);color:#fff;border-color:transparent",
  tag: "display:inline-block;padding:2px 10px;margin:2px 4px 2px 0;border:1px solid var(--line);border-radius:var(--r-full);font-size:12px",
  actions: "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px",
  logs: "list-style:none;padding:0;margin:8px 0 0",
  logRow: "display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px",
  choices: "display:flex;flex-direction:column;gap:8px;margin-top:12px",
  choice: "width:100%;text-align:left;justify-content:flex-start",
  hint: "padding:10px 14px;border-radius:12px;background:rgba(79,140,255,.08);font-size:13px;margin-top:12px",
  muted: "color:var(--muted)",
  input: "padding:10px 14px;border:1px solid var(--line);border-radius:var(--r-full);font-size:14px",
  select: "width:100%;padding:10px;border:1px solid var(--line);border-radius:12px;font-size:14px",
  label: "display:block;margin:12px 0 4px;font-size:13px",
};

let userId = null;
let activeTab = "overview";
/* 進行中的探索（劇情物件） */
let activeExplore = null;

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
function skeleton() {
  view.innerHTML = `<div class="skeleton" style="height:140px"></div>
    <div class="skeleton" style="height:20px;margin-top:12px"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="i-retry">重試</button></div>`;
  document.getElementById("i-retry").onclick = retry;
}

/* ---- 分頁導覽 ---- */
function tabBar() {
  const tabs = [
    ["overview", "島嶼總覽"],
    ["explore", "探索"],
    ["build", "建造"],
    ["pet", "寵物"],
  ];
  return `<nav style="${S.tabs}" role="tablist" aria-label="島嶼世界分頁">` + tabs.map(([k, label]) =>
    `<button role="tab" style="${S.tabBase};${k === activeTab ? S.tabNow : ""}"
      aria-selected="${k === activeTab}" data-tab="${k}">${label}</button>`
  ).join("") + `</nav>`;
}
function bindTabs(rerender) {
  view.querySelectorAll("[data-tab]").forEach(btn => {
    btn.onclick = () => { activeTab = btn.dataset.tab; rerender(); focusMain(); };
  });
}

/* ================= 總覽 ================= */
async function renderOverview() {
  skeleton();
  announce("載入島嶼總覽");
  let status = null, statusErr = null;
  try {
    const r = await get(`/islands/${userId}`);
    status = r.island || r;
  } catch (e) {
    statusErr = e;
    console.warn("[island] status failed:", e.code);
  }

  let named = [];
  try {
    const r = await swr("world:islands", "/world/islands");
    named = r.data?.islands || (Array.isArray(r.data) ? r.data : []);
  } catch (e) { console.warn("[island] named islands failed:", e.code); }

  let logs = [];
  try {
    const r = await swr("world:island-logs", `/islands/${userId}/logs?limit=10`);
    logs = r.data?.logs || (Array.isArray(r.data) ? r.data : []);
  } catch (e) { console.warn("[island] logs failed:", e.code); }

  const statusHtml = status ? `
    <div class="card">
      <h2>🏝️ ${escapeHtml(status.name || "無名島")}</h2>
      <p style="${S.muted}">領土 ${escapeHtml(String(status.territory ?? 0))} 單位
        · 今日開拓 ${escapeHtml(String(status.used_today ?? 0))} / ${escapeHtml(String(status.daily_cap ?? 5))}</p>
      ${(status.occupied_tags?.length) ? `<p>已佔領標籤：` +
        status.occupied_tags.map(t => `<span style="${S.tag}">${escapeHtml(t)}</span>`).join("") + `</p>` : ""}
      ${status.resources ? `<p style="${S.muted};font-size:13px">資源：` +
        Object.entries(status.resources).map(([k, v]) => `${escapeHtml(k)}×${escapeHtml(String(v))}`).join("、") + `</p>` : ""}
      ${(status.badges?.length) ? `<p>徽章：` +
        status.badges.map(b => `<span style="${S.tag}">${escapeHtml(typeof b === "string" ? b : b.name || "")}</span>`).join("") + `</p>` : ""}
    </div>
    <div class="card">
      <h3>開疆拓土</h3>
      <p style="${S.muted};font-size:13px">選擇一種學習行動，為島嶼擴張領土。</p>
      <div style="${S.actions}">${EXPAND_ACTIONS.map(a =>
        `<button class="btn btn-ghost" data-expand="${a.key}">${a.label}</button>`).join("")}</div>
    </div>
    <div class="card">
      <h3>佔領標籤</h3>
      <p style="${S.muted};font-size:13px">例如 SUBJ:物理、SUBJ:數學。佔領後島嶼知識密度提升。</p>
      <div style="display:flex;gap:8px">
        <input id="i-tag-input" type="text" placeholder="SUBJ:物理" aria-label="標籤"
          style="flex:1;${S.input}">
        <button class="btn btn-primary" id="i-occupy-go">佔領</button>
      </div>
    </div>` : `
    <div class="state-empty">
      <img src="../assets/img/empty-neon.webp?v=3.0.0" alt="空島插圖">
      <p>${statusErr ? `島嶼狀態讀取失敗：${escapeHtml(statusErr.message)}` : "你的島嶼還在星海中沉睡"}</p>
      <button class="btn btn-primary" id="i-first-expand">開疆拓土，喚醒島嶼</button>
    </div>`;

  const namedHtml = `
    <div class="card">
      <h3>我的島嶼</h3>
      ${named.length ? `<div class="i-grid">` + named.map(it =>
        `<div class="card"><h4>${escapeHtml(it.name || "無名島")}</h4>
         <p style="${S.muted};font-size:13px">${escapeHtml(it.topic || "")}
         ${it.buildings?.length ? ` · 建築 ${it.buildings.length}` : ""}</p></div>`).join("") + `</div>`
      : `<p style="${S.muted}">還沒有命名的島嶼</p>`}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <input id="i-island-name" type="text" placeholder="島嶼名稱" aria-label="島嶼名稱"
          style="flex:1;min-width:140px;${S.input}">
        <input id="i-island-topic" type="text" placeholder="主題（選填）" aria-label="島嶼主題"
          style="flex:1;min-width:110px;${S.input}">
        <button class="btn btn-primary" id="i-create-island">命名新島嶼</button>
      </div>
    </div>`;

  const logsHtml = `
    <div class="card">
      <h3>領土日誌</h3>
      ${logs.length ? `<ul style="${S.logs}">` + logs.slice(0, 10).map(l =>
        `<li style="${S.logRow}"><span>${escapeHtml(l.action || l.kind || l.text || JSON.stringify(l))}</span>
         <span style="${S.muted};font-size:12px">${escapeHtml((l.created_at || "").slice(0, 10))}</span></li>`
      ).join("") + `</ul>` : `<p style="${S.muted}">尚無領土紀錄</p>`}
    </div>`;

  view.innerHTML = tabBar() + `<div role="tabpanel">` + statusHtml + namedHtml + logsHtml + `</div>`;
  bindTabs(renderOverview);

  /* 開疆拓土 */
  view.querySelectorAll("[data-expand]").forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.expand;
      btn.disabled = true;
      try {
        const r = await post(`/islands/${userId}/expand`, { action }, { idempotent: true });
        const isl = r.island || {};
        toast(r.reason || `開疆成功！領土 ${isl.territory ?? ""}`);
        renderOverview();
      } catch (e) {
        toast(`開疆失敗：${e.message}`);
        btn.disabled = false;
      }
    };
  });
  document.getElementById("i-first-expand")?.addEventListener("click", async (e) => {
    const btn = e.target; btn.disabled = true; btn.textContent = "喚醒中…";
    try {
      const r = await post(`/islands/${userId}/expand`, { action: "complete_quest" }, { idempotent: true });
      toast(r.reason || "島嶼已喚醒！");
      renderOverview();
    } catch (err) {
      toast(`喚醒失敗：${err.message}`); btn.disabled = false; btn.textContent = "開疆拓土，喚醒島嶼";
    }
  });

  /* 佔領標籤 */
  document.getElementById("i-occupy-go")?.addEventListener("click", async () => {
    const tag = document.getElementById("i-tag-input").value.trim();
    if (!tag) { announce("請先輸入標籤"); return; }
    const btn = document.getElementById("i-occupy-go");
    btn.disabled = true;
    try {
      const r = await post(`/islands/${userId}/occupy`, { tag });
      toast(r.reason || `已佔領「${tag}」`);
      renderOverview();
    } catch (e) {
      toast(`佔領失敗：${e.message}`); btn.disabled = false;
    }
  });

  /* 命名新島嶼（session_id 為必填，取書架最新戰役；無則用時間戳） */
  document.getElementById("i-create-island")?.addEventListener("click", async () => {
    const name = document.getElementById("i-island-name").value.trim();
    const topic = document.getElementById("i-island-topic").value.trim();
    if (!name) { announce("請先輸入島嶼名稱"); return; }
    const btn = document.getElementById("i-create-island");
    btn.disabled = true; btn.textContent = "命名中…";
    let session_id = `manual-${Date.now()}`;
    try {
      const hs = await swr("learn:sessions", "/learn/sessions").catch(() => null);
      const first = hs?.data?.[0] || hs?.data?.items?.[0];
      const sid = first?.id || first?.sid || first?.session_id;
      if (sid) session_id = sid;
    } catch { /* 用預設值 */ }
    try {
      const r = await post("/world/islands",
        { name, topic, session_id }, { idempotent: true });
      toast(`「${r.island?.name || name}」已在星海中浮現`);
      renderOverview();
    } catch (e) {
      toast(`命名失敗：${e.message}`); btn.disabled = false; btn.textContent = "命名新島嶼";
    }
  });
  focusMain();
}

/* ================= 探索 ================= */
async function renderExplore() {
  if (activeExplore) { renderExploreStory(); return; }
  skeleton();
  announce("載入探索區");
  let zones = [];
  try {
    const r = await swr("world:zones", "/world/zones");
    zones = r.data?.zones || (Array.isArray(r.data) ? r.data : []);
  } catch (e) { console.warn("[island] zones failed:", e.code); }

  let records = [];
  try {
    const r = await swr("world:explore-records", "/world/explore");
    records = r.data?.explorations || (Array.isArray(r.data) ? r.data : []);
  } catch (e) { console.warn("[island] explore records failed:", e.code); }

  const zonesHtml = zones.length
    ? `<div class="i-grid">` + zones.map(z =>
        `<div class="card"><h3>${escapeHtml(z.name)}</h3>
         <p style="${S.muted};font-size:13px">${escapeHtml(z.desc || "")}</p>
         <p style="${S.muted};font-size:12px">${escapeHtml(String(z.stages ?? 0))} 個階段</p>
         <button class="btn btn-primary" data-zone="${escapeHtml(z.name)}" style="margin-top:8px">開始探索</button></div>`
      ).join("") + `</div>`
    : `<div class="state-empty"><p>探索區域載入失敗</p>
       <button class="btn btn-primary" id="i-zones-retry">重試</button></div>`;

  const recordsHtml = `
    <div class="card" style="margin-top:16px"><h3>我的探索紀錄</h3>
    ${records.length ? `<ul style="${S.logs}">` + records.map(r =>
      `<li style="${S.logRow}"><span>${escapeHtml(r.zone || "")} · 第 ${escapeHtml(String(r.stage ?? 0))} 階段` +
        (r.status === "done" ? "（完成）" : r.status === "ongoing" ? "（進行中）" : "") + `</span>
       <span style="${S.muted};font-size:12px">${escapeHtml((r.created_at || "").slice(0, 10))}</span>
       ${r.status === "ongoing" ? `<button class="btn btn-ghost" data-resume="${escapeHtml(r.id)}">繼續</button>` : ""}</li>`
    ).join("") + `</ul>` : `<p style="${S.muted}">尚無探索紀錄，選一個區域出發吧</p>`}
    </div>`;

  view.innerHTML = tabBar() + `<div role="tabpanel"><h2>探索區</h2>${zonesHtml}${recordsHtml}</div>`;
  bindTabs(renderExplore);

  document.getElementById("i-zones-retry")?.addEventListener("click", renderExplore);
  view.querySelectorAll("[data-zone]").forEach(btn => {
    btn.onclick = async () => {
      const zone = btn.dataset.zone;
      btn.disabled = true; btn.textContent = "啟程中…";
      announce(`正在前往${zone}`);
      try {
        const r = await post("/world/explore", { zone }, { idempotent: true });
        activeExplore = r;
        toast(`抵達${zone}！`);
        renderExploreStory();
      } catch (e) {
        toast(`啟程失敗：${e.message}`); btn.disabled = false; btn.textContent = "開始探索";
      }
    };
  });
  view.querySelectorAll("[data-resume]").forEach(btn => {
    btn.onclick = async () => {
      const eid = btn.dataset.resume;
      btn.disabled = true;
      try {
        activeExplore = await get(`/world/explore/${eid}`);
        renderExploreStory();
      } catch (e) {
        toast(`讀取探索進度失敗：${e.message}`); btn.disabled = false;
      }
    };
  });
  focusMain();
}

/* 探索劇情：顯示當前節點 → 選擇 → 推進 */
function renderExploreStory() {
  const ex = activeExplore;
  const cur = ex.current || ex.next;
  const stage = ex.stage ?? 0;
  const total = ex.total_stages ?? ex.zone_info?.stages ?? 0;
  const trail = ex.trail || [];

  if (!cur) {
    view.innerHTML = tabBar() + `<div role="tabpanel">
      <div class="state-error"><p>探索劇情讀取異常</p>
      <button class="btn btn-primary" id="i-explore-back">回探索區</button></div></div>`;
    bindTabs(renderExplore);
    document.getElementById("i-explore-back").onclick = () => { activeExplore = null; renderExplore(); };
    return;
  }

  const choices = cur.choices || [];
  view.innerHTML = tabBar() + `<div role="tabpanel">
    <div class="card">
      <p style="${S.muted};font-size:13px">${escapeHtml(ex.zone || "")} · 第 ${stage + 1} / ${total} 階段</p>
      <h2>${escapeHtml(cur.title || "")}</h2>
      <p>${escapeHtml(cur.text || "")}</p>
      ${cur.hint ? `<p style="${S.hint}">💡 ${escapeHtml(cur.hint)}</p>` : ""}
      <div style="${S.choices}" role="group" aria-label="劇情選擇">` +
      choices.map((c, i) =>
        `<button class="btn btn-ghost" style="${S.choice}" data-choice="${i}">${escapeHtml(c)}</button>`
      ).join("") + `</div>
      ${trail.length ? `<details style="margin-top:12px"><summary>已走過的路（${trail.length}）</summary><ul style="${S.logs}">` +
        trail.map(t => `<li style="${S.logRow}"><span><strong>${escapeHtml(t.title || "")}</strong>：${escapeHtml(t.choice || "")}</span></li>`).join("") +
        `</ul></details>` : ""}
      <button class="btn btn-ghost" id="i-explore-back" style="margin-top:12px">暫停，先回探索區</button>
    </div></div>`;
  bindTabs(renderExplore);

  view.querySelectorAll("[data-choice]").forEach(btn => {
    btn.onclick = async () => {
      const idx = +btn.dataset.choice;
      view.querySelectorAll("[data-choice]").forEach(b => { b.disabled = true; });
      btn.textContent = "抉擇中…";
      announce("正在推進劇情");
      try {
        const r = await post(`/world/explore/${ex.id}/choose`, { choice_index: idx });
        if (r.done) {
          renderExploreDone(r);
        } else {
          activeExplore = { ...ex, ...r, current: r.next, stage: (ex.stage ?? 0) + 1 };
          renderExploreStory();
        }
      } catch (e) {
        toast(`推進失敗：${e.message}`);
        renderExploreStory();
      }
    };
  });
  document.getElementById("i-explore-back").onclick = () => { activeExplore = null; renderExplore(); };
  focusMain();
}

/* 探索完成：獎勵結算 */
function renderExploreDone(result) {
  const reward = result.reward || {};
  const trail = result.trail || [];
  activeExplore = null;
  view.innerHTML = tabBar() + `<div role="tabpanel">
    <div class="card">
      <h2>🎉 探索完成！</h2>
      <p>${escapeHtml(result.hint || "這趟旅程讓你成長了。")}</p>
      ${reward.starsand ? `<p>獲得星砂：<strong>${escapeHtml(String(reward.starsand))}</strong></p>` : ""}
      ${reward.pet ? `<p>🐾 寵物似乎也有所成長</p>` : ""}
      ${trail.length ? `<h3>旅途回顧</h3><ul style="${S.logs}">` +
        trail.map(t => `<li style="${S.logRow}"><span><strong>${escapeHtml(t.title || "")}</strong>：${escapeHtml(t.choice || "")}</span></li>`).join("") +
        `</ul>` : ""}
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn-primary" id="i-explore-again">再探索一次</button>
        <button class="btn btn-ghost" id="i-explore-to-pet">看看寵物</button>
      </div>
    </div></div>`;
  bindTabs(renderExplore);
  announce("探索完成");
  document.getElementById("i-explore-again").onclick = () => renderExplore();
  document.getElementById("i-explore-to-pet").onclick = () => { activeTab = "pet"; renderPet(); };
  focusMain();
}

/* ================= 建造 ================= */
async function renderBuild() {
  skeleton();
  announce("載入建造");
  let named = [];
  try {
    const r = await swr("world:islands", "/world/islands");
    named = r.data?.islands || (Array.isArray(r.data) ? r.data : []);
  } catch (e) { console.warn("[island] islands for build failed:", e.code); }

  view.innerHTML = tabBar() + `<div role="tabpanel">
    <div class="card">
      <h2>建造 / 升級</h2>
      <p style="${S.muted};font-size:13px">在你的島嶼上蓋建築。建築需要星砂（圖書館 50 起）。</p>
      ${named.length ? `
      <label for="i-build-island" style="${S.label}">選擇島嶼</label>
      <select id="i-build-island" style="${S.select}">
        ${named.map(it => `<option value="${escapeHtml(it.id)}">${escapeHtml(it.name || "無名島")}</option>`).join("")}
      </select>
      <label for="i-build-type" style="${S.label}">建築類型</label>
      <select id="i-build-type" style="${S.select}">
        ${BUILD_TYPES.map(b => `<option value="${b}">${b}</option>`).join("")}
      </select>
      <button class="btn btn-primary" id="i-build-go" style="width:100%;margin-top:16px">開始建造</button>`
      : `<div class="state-empty"><p>還沒有島嶼，先去總覽命名一座吧</p>
         <button class="btn btn-primary" id="i-build-to-overview">去總覽</button></div>`}
    </div></div>`;
  bindTabs(renderBuild);

  document.getElementById("i-build-to-overview")?.addEventListener("click", () => {
    activeTab = "overview"; renderOverview();
  });
  document.getElementById("i-build-go")?.addEventListener("click", async () => {
    const island_id = document.getElementById("i-build-island").value;
    const btype = document.getElementById("i-build-type").value;
    const btn = document.getElementById("i-build-go");
    btn.disabled = true; btn.textContent = "建造中…";
    announce(`正在建造${btype}`);
    try {
      const r = await post("/world/build", { island_id, btype }, { idempotent: true });
      toast(r.reason || r.message || `${btype}建造完成！`);
      renderBuild();
    } catch (e) {
      toast(`建造失敗：${e.message}`);
      btn.disabled = false; btn.textContent = "開始建造";
    }
  });
  focusMain();
}

/* ================= 寵物 ================= */
async function renderPet() {
  skeleton();
  announce("載入寵物");
  let pet = null, petErr = null;
  try {
    const r = await swr("world:pet", "/world/pet");
    pet = r.data?.pet ?? r.data ?? null;
    if (pet && typeof pet !== "object") pet = null;
  } catch (e) {
    petErr = e;
    console.warn("[island] pet failed:", e.code);
  }

  const petHtml = pet ? `
    <div class="card i-pet">
      <h2>🐾 ${escapeHtml(pet.name || "小夥伴")}</h2>
      <p style="${S.muted}">種類：${escapeHtml(pet.species || "未知")}
        · Lv.${escapeHtml(String(pet.level ?? 1))}
        · 經驗 ${escapeHtml(String(pet.exp ?? 0))}</p>
      ${pet.mood != null ? `<p style="${S.muted}">心情值：${escapeHtml(String(pet.mood))}</p>` : ""}
      <p style="${S.muted};font-size:13px">改名請到<a href="pet.html">寵物小屋</a></p>
    </div>` : petErr ? `
    <div class="state-error"><p>寵物讀取失敗：${escapeHtml(petErr.message)}</p>
      <button class="btn btn-primary" id="i-pet-retry">重試</button></div>` : `
    <div class="card i-pet">
      <h2>寵物蛋</h2>
      <p style="${S.muted}">你的寵物蛋還沒孵化。給它取個名字，迎接新夥伴吧！</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <input id="i-pet-name" type="text" placeholder="寵物名字（必填）" aria-label="寵物名字"
          maxlength="20" style="flex:1;min-width:140px;${S.input}">
        <input id="i-pet-species" type="text" placeholder="種類（選填）" aria-label="寵物種類"
          maxlength="20" style="flex:1;min-width:110px;${S.input}">
        <button class="btn btn-primary" id="i-hatch">孵化</button>
      </div>
    </div>`;

  view.innerHTML = tabBar() + `<div role="tabpanel">${petHtml}</div>`;
  bindTabs(renderPet);

  document.getElementById("i-pet-retry")?.addEventListener("click", renderPet);
  document.getElementById("i-hatch")?.addEventListener("click", async (e) => {
    const btn = e.target;
    const name = document.getElementById("i-pet-name").value.trim();
    if (!name) { announce("請先給寵物取個名字"); document.getElementById("i-pet-name").focus(); return; }
    const species = document.getElementById("i-pet-species").value.trim();
    btn.disabled = true; btn.textContent = "孵化中…";
    announce("寵物孵化中");
    try {
      const body = { name };
      if (species) body.species = species;
      const r = await post("/world/pet/hatch", body, { idempotent: true });
      toast(`孵化成功！${r.pet?.name || name} 誕生了 🎉`);
      renderPet();
    } catch (err) {
      toast(`孵化失敗：${err.message}`);
      btn.disabled = false; btn.textContent = "孵化";
    }
  });
  focusMain();
}

/* ---- 啟動 ---- */
(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再進入島嶼世界</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    sub.textContent = "未登入";
    return;
  }
  try {
    const r = await swr("auth:me", "/auth/me");
    const me = r.data?.user || r.data || {};
    userId = me.id;
    if (!userId) throw new Error("無法取得使用者 ID");
    sub.textContent = `旅人 ${me.name || ""} 的島嶼世界`;
  } catch (e) {
    errorView(`載入失敗：${e.message}`, init);
    return;
  }
  renderOverview();
})();
