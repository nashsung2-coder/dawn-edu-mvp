/* 島嶼世界：動森式家園 ＋ 部落衝突式開拓
 * 英雄圖（按領土等級）→ 儀表板 → 開疆任務卡 → 建築槽位 → 標籤雲 → 我的島嶼 → 領土日誌
 * 全鏈路調真實後端，零假數據。樂觀更新（先動畫、後校正）＋ 並行載入。
 * 生命週期：init → loading → api → render / empty / error
 */
import { swr, post, get } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("i-view");
const sub = document.getElementById("i-sub");

/* ---- 真實獎勵表（後端 game.py EXPAND_ACTIONS + ACTION_RESOURCE_REWARD，curl 實測驗證） ---- */
const EXPAND_ACTIONS = [
  { key: "complete_topic", icon: "🌱", label: "完成主題", desc: "完成一個學習主題",
    reward: "領土 +1.0 · 好奇種子 ×1 · 星砂 ×10", delta: 1.0 },
  { key: "fix_myth", icon: "👁️", label: "破除迷思", desc: "修正一個錯誤觀念",
    reward: "領土 +1.0 · 觀察之眼 ×1 · 星砂 ×10", delta: 1.0 },
  { key: "ask_question", icon: "❓", label: "提出好問題", desc: "提出一個新問題",
    reward: "領土 +0.5 · 好奇種子 ×1 · 星砂 ×10", delta: 0.5 },
  { key: "complete_quest", icon: "⚔️", label: "完成任務", desc: "完成一個任務委託",
    reward: "領土 +2.0 · 變因齒輪 ×1 · 心流之泉 ×1 · 星砂 ×10", delta: 2.0 },
  { key: "co_study", icon: "🤝", label: "共學", desc: "與夥伴完成共修任務",
    reward: "領土 +1.5 · 連結之網 ×1 · 星砂 ×10", delta: 1.5 },
];

const BUILDINGS = [
  { type: "圖書館", icon: "📚", desc: "加速文獻理解：測驗前可多看一次提示" },
  { type: "訓練場", icon: "🏋️", desc: "提升武器默契成長速度" },
  { type: "瞭望塔", icon: "🗼", desc: "探索加成：劇情選項多一條線索" },
];
const BUILD_MAX = 5;

const S = {
  tabs: "display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap",
  muted: "color:var(--muted)",
  input: "padding:10px 14px;border:1px solid var(--line);border-radius:var(--r-full);font-size:14px",
  select: "width:100%;padding:10px;border:1px solid var(--line);border-radius:12px;font-size:14px",
  label: "display:block;margin:12px 0 4px;font-size:13px",
  logs: "list-style:none;padding:0;margin:8px 0 0",
  logRow: "display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px",
  tag: "display:inline-block;padding:6px 14px;margin:3px;border-radius:var(--r-full);font-size:13px;cursor:pointer;border:1px solid var(--line);background:transparent",
  tagOn: "background:var(--accent,#4f8cff);color:#fff;border-color:transparent",
  hero: "width:100%;border-radius:16px;display:block;margin-bottom:16px",
  card: "margin-bottom:16px",
  barWrap: "height:12px;border-radius:var(--r-full);background:var(--bg-soft,#eee);border:1px solid var(--line);overflow:hidden;margin-top:8px",
  barFill: "height:100%;border-radius:var(--r-full);background:var(--accent,#4f8cff);transition:width .5s ease",
  questGrid: "display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px",
  questCard: "text-align:left;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--card);cursor:pointer;display:flex;flex-direction:column;gap:6px",
  questBusy: "opacity:.55;pointer-events:none",
  slotGrid: "display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-top:12px",
};

let userId = null;
/* 本地狀態（樂觀更新的單一真相來源） */
let ST = { status: null, named: [], logs: [], tagCloud: [], statusErr: null };

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  root.appendChild(el); announce(msg);
  setTimeout(() => el.remove(), 3200);
}
function skeleton() {
  view.innerHTML = `<div class="skeleton" style="height:180px"></div>
    <div class="skeleton" style="height:20px;margin-top:12px"></div>
    <div class="skeleton" style="height:120px;margin-top:12px"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="i-retry">重試</button></div>`;
  document.getElementById("i-retry").onclick = retry;
}

/* 領土 <10 初生小島；<30 成長；否則繁榮都市 */
function heroImg(territory) {
  const t = Number(territory) || 0;
  const f = t >= 30 ? "island-3" : t >= 10 ? "island-2" : "island-1";
  return `../assets/img/game/${f}.webp?v=3.0.0`;
}
function heroAlt(territory) {
  const t = Number(territory) || 0;
  return t >= 30 ? "繁榮都市島嶼" : t >= 10 ? "成長中的島嶼" : "初生小島";
}

/* ================= 並行載入 ================= */
async function loadAll() {
  skeleton();
  announce("載入島嶼世界");
  const [statusR, namedR, logsR, tagsR] = await Promise.allSettled([
    get(`/islands/${userId}`),
    swr("world:islands", "/world/islands"),
    swr("world:island-logs", `/islands/${userId}/logs?limit=10`),
    swr("tags:tree", "/tags"),
  ]);

  if (statusR.status === "fulfilled") {
    ST.status = statusR.value.island || statusR.value;
    ST.statusErr = null;
  } else {
    ST.status = null;
    ST.statusErr = statusR.reason;
    console.warn("[island] status failed:", statusR.reason?.code);
  }
  if (namedR.status === "fulfilled") {
    const d = namedR.value.data;
    ST.named = d?.islands || (Array.isArray(d) ? d : []);
  } else console.warn("[island] named failed:", namedR.reason?.code);
  if (logsR.status === "fulfilled") {
    const d = logsR.value.data;
    ST.logs = d?.logs || (Array.isArray(d) ? d : []);
  } else console.warn("[island] logs failed:", logsR.reason?.code);
  if (tagsR.status === "fulfilled") {
    ST.tagCloud = buildTagCloud(tagsR.value.data);
  } else console.warn("[island] tags failed:", tagsR.reason?.code);
}

/* 從標籤樹挑一組建議標籤（每維度取幾個，混排） */
function buildTagCloud(data) {
  const dims = data?.dimensions || [];
  const picks = [];
  const perDim = 4;
  dims.forEach(dim => {
    (dim.tags || []).slice(0, perDim).forEach(t => {
      picks.push({ code: `${dim.code}:${t.name}`, label: t.name, dim: dim.name });
    });
  });
  return picks.slice(0, 24);
}

/* ================= 渲染 ================= */
function heroHtml() {
  const st = ST.status;
  if (!st) return "";
  return `<img src="${heroImg(st.territory)}" alt="${heroAlt(st.territory)}"
    style="${S.hero}" loading="eager">`;
}

function dashboardHtml() {
  const st = ST.status;
  if (!st) {
    return `<div class="state-empty" style="${S.card}">
      <img src="../assets/img/empty-neon.webp?v=3.0.0" alt="空島插圖" style="width:120px">
      <p>${ST.statusErr ? `島嶼狀態讀取失敗：${escapeHtml(ST.statusErr.message)}` : "你的島嶼還在星海中沉睡"}</p>
      <button class="btn btn-primary" id="i-wake">開疆拓土，喚醒島嶼</button>
    </div>`;
  }
  const used = Number(st.used_today) || 0;
  const cap = Number(st.daily_cap) || 5;
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const res = st.resources || {};
  const resChips = Object.keys(res).length
    ? Object.entries(res).map(([k, v]) =>
        `<span style="${S.tag};cursor:default">${escapeHtml(k)} ×${escapeHtml(String(v))}</span>`).join("")
    : `<span style="${S.muted};font-size:13px">開疆拓土可獲得資源</span>`;
  return `<div class="card" style="${S.card}">
    <h2 style="margin:0 0 4px">🏝️ ${escapeHtml(st.name || "無名島")}</h2>
    <p style="font-size:28px;font-weight:700;margin:4px 0" aria-label="領土">
      ${escapeHtml(String(st.territory ?? 0))} <span style="font-size:14px;font-weight:400;color:var(--muted)">單位領土</span></p>
    <div aria-label="今日開拓進度">
      <div style="display:flex;justify-content:space-between;font-size:13px;${S.muted}">
        <span>今日開拓</span><span>${escapeHtml(String(used))} / ${escapeHtml(String(cap))}</span></div>
      <div style="${S.barWrap}" role="progressbar" aria-valuenow="${pct}"
        aria-valuemin="0" aria-valuemax="100" aria-label="今日開拓進度">
        <div style="${S.barFill};width:${pct}%"></div></div>
    </div>
    <div style="margin-top:12px" aria-label="資源"><div style="font-size:13px;${S.muted};margin-bottom:4px">資源</div>${resChips}</div>
  </div>`;
}

function questsHtml() {
  const st = ST.status;
  const used = Number(st?.used_today) || 0;
  const cap = Number(st?.daily_cap) || 5;
  return `<div class="card" style="${S.card}">
    <h3 style="margin-top:0">⚔️ 開疆拓土</h3>
    <p style="${S.muted};font-size:13px;margin:0">選一個學習行動，島嶼立即擴張。點下去馬上有效果！</p>
    <div style="${S.questGrid}" role="group" aria-label="開疆任務">` +
    EXPAND_ACTIONS.map(a => {
      const capped = used + a.delta > cap + 1e-9;
      return `<button class="i-quest" data-expand="${a.key}" data-delta="${a.delta}"
        ${capped || !st ? "disabled" : ""}
        aria-label="${a.label}：${a.reward}${capped ? "（今日額度已滿）" : ""}"
        style="${S.questCard}${capped || !st ? ";opacity:.45" : ""}">
        <span style="font-size:28px" aria-hidden="true">${a.icon}</span>
        <strong style="font-size:15px">${a.label}</strong>
        <span style="font-size:12px;${S.muted}">${a.desc}</span>
        <span style="font-size:12px;color:var(--accent,#4f8cff)">🎁 ${a.reward}</span>
        ${capped ? `<span style="font-size:12px;color:var(--muted)">今日額度已滿</span>` : ""}
      </button>`;
    }).join("") + `</div></div>`;
}

function buildSlotsHtml() {
  const named = ST.named;
  if (!named.length) {
    return `<div class="card" style="${S.card}">
      <h3 style="margin-top:0">🏗️ 建築</h3>
      <p style="${S.muted};font-size:13px">還沒有命名的島嶼。先到下方「我的島嶼」命名一座，才能蓋建築。</p>
    </div>`;
  }
  const selId = document.getElementById("i-build-island")?.value || named[0].id;
  const isl = named.find(i => i.id === selId) || named[0];
  const built = {};
  (isl.buildings || []).forEach(b => { built[b.btype] = Number(b.level) || 0; });
  return `<div class="card" style="${S.card}">
    <h3 style="margin-top:0">🏗️ 建築</h3>
    <label for="i-build-island" style="${S.label}">選擇島嶼</label>
    <select id="i-build-island" style="${S.select}" aria-label="選擇島嶼">
      ${named.map(it => `<option value="${escapeHtml(it.id)}" ${it.id === isl.id ? "selected" : ""}>${escapeHtml(it.name || "無名島")}</option>`).join("")}
    </select>
    <div style="${S.slotGrid}">` +
    BUILDINGS.map(b => {
      const lv = built[b.type] || 0;
      const maxed = lv >= BUILD_MAX;
      const cost = 50 * (lv + 1);
      const pips = Array.from({ length: BUILD_MAX }, (_, i) =>
        `<span aria-hidden="true" style="color:${i < lv ? "var(--accent,#4f8cff)" : "var(--line)"}">●</span>`).join("");
      return `<div style="border:1px solid var(--line);border-radius:14px;padding:12px">
        <div style="font-size:28px" aria-hidden="true">${b.icon}</div>
        <strong>${b.type}</strong>
        <span style="font-size:12px;${S.muted}"> Lv.${lv}/${BUILD_MAX}</span>
        <div aria-label="${b.type}等級 ${lv}" style="font-size:10px;letter-spacing:2px">${pips}</div>
        <p style="font-size:12px;${S.muted};margin:6px 0">${b.desc}</p>
        ${maxed
          ? `<span style="font-size:13px;color:var(--accent,#4f8cff)">★ 已滿級</span>`
          : `<button class="btn ${lv === 0 ? "btn-primary" : "btn-ghost"}" data-build="${b.type}"
              data-island="${escapeHtml(isl.id)}" data-lv="${lv}" style="width:100%;margin-top:6px">
              ${lv === 0 ? "建造" : "升級"}（${cost} 星砂）</button>`}
      </div>`;
    }).join("") + `</div></div>`;
}

function tagsHtml() {
  const occupied = new Set(ST.status?.occupied_tags || []);
  const cloud = ST.tagCloud.length
    ? ST.tagCloud.map(t => {
        const on = occupied.has(t.code);
        return `<button style="${S.tag}${on ? ";" + S.tagOn : ""}" data-tag="${escapeHtml(t.code)}"
          aria-pressed="${on}" title="${escapeHtml(t.dim)}">${on ? "★ " : ""}${escapeHtml(t.label)}</button>`;
      }).join("")
    : `<span style="${S.muted};font-size:13px">標籤載入中…</span>`;
  return `<div class="card" style="${S.card}">
    <h3 style="margin-top:0">🚩 佔領標籤</h3>
    <p style="${S.muted};font-size:13px;margin:0 0 8px">點標籤直接佔領，已佔領的會高亮。佔領提升島嶼知識密度。</p>
    <div role="group" aria-label="標籤雲">${cloud}</div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <input id="i-tag-input" type="text" placeholder="自訂標籤，如 SUBJ:物理" aria-label="自訂標籤"
        style="flex:1;${S.input}">
      <button class="btn btn-primary" id="i-occupy-go">佔領</button>
    </div></div>`;
}

function namedHtml() {
  const named = ST.named;
  return `<div class="card" style="${S.card}">
    <h3 style="margin-top:0">🗺️ 我的島嶼</h3>
    ${named.length ? `<div class="i-grid">` + named.map(it =>
      `<div class="card" style="margin:0"><h4 style="margin:0 0 4px">${escapeHtml(it.name || "無名島")}</h4>
       <p style="${S.muted};font-size:13px;margin:0">${escapeHtml(it.topic || "")}
       ${(it.buildings?.length) ? ` · 🏗️ ${it.buildings.map(b => `${escapeHtml(b.btype)} Lv.${b.level}`).join("、")}` : ""}</p></div>`
    ).join("") + `</div>`
    : `<p style="${S.muted};font-size:13px">還沒有命名的島嶼</p>`}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <input id="i-island-name" type="text" placeholder="島嶼名稱" aria-label="島嶼名稱"
        maxlength="20" style="flex:1;min-width:140px;${S.input}">
      <input id="i-island-topic" type="text" placeholder="主題（選填）" aria-label="島嶼主題"
        maxlength="20" style="flex:1;min-width:110px;${S.input}">
      <button class="btn btn-primary" id="i-create-island">命名新島嶼</button>
    </div></div>`;
}

function logsHtml() {
  const logs = ST.logs;
  return `<div class="card" style="${S.card}">
    <h3 style="margin-top:0">📜 領土日誌</h3>
    ${logs.length ? `<ul style="${S.logs}">` + logs.slice(0, 10).map(l =>
      `<li style="${S.logRow}"><span>${escapeHtml(l.action || l.kind || l.text || "")}</span>
       <span style="${S.muted};font-size:12px">${escapeHtml((l.created_at || "").slice(0, 10))}</span></li>`
    ).join("") + `</ul>` : `<p style="${S.muted};font-size:13px">尚無領土紀錄，開疆拓土來寫下第一筆</p>`}
  </div>`;
}

function paint() {
  view.innerHTML = heroHtml() + dashboardHtml() + questsHtml()
    + buildSlotsHtml() + tagsHtml() + namedHtml() + logsHtml();
  bindAll();
  bindNamed();
  focusMain();
}

/* ================= 互動綁定 ================= */
function bindAll() {
  /* 喚醒（無狀態時） */
  document.getElementById("i-wake")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "喚醒中…";
    try {
      const r = await post(`/islands/${userId}/expand`, { action: "complete_quest" }, { idempotent: true });
      if (r.island) ST.status = r.island;
      toast(r.reason || "島嶼已喚醒！");
      paint();
    } catch (err) {
      toast(`喚醒失敗：${err.message}`);
      btn.disabled = false; btn.textContent = "開疆拓土，喚醒島嶼";
    }
  });

  /* 開疆拓土：樂觀更新 */
  view.querySelectorAll("[data-expand]").forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.expand;
      const delta = Number(btn.dataset.delta) || 0;
      const a = EXPAND_ACTIONS.find(x => x.key === action);
      /* 快照以便回滾 */
      const snap = JSON.parse(JSON.stringify(ST.status || {}));
      /* 樂觀：先漲領土、進度條，卡片轉圈 */
      if (ST.status) {
        ST.status.territory = (Number(ST.status.territory) || 0) + delta;
        ST.status.used_today = (Number(ST.status.used_today) || 0) + delta;
        paint();
        const fresh = view.querySelector(`[data-expand="${action}"]`);
        if (fresh) { fresh.disabled = true; fresh.style.opacity = ".55"; }
      } else {
        btn.disabled = true;
      }
      announce(`${a?.label || "開疆"}中，領土擴張動畫播放`);
      try {
        const r = await post(`/islands/${userId}/expand`, { action }, { idempotent: true });
        if (r.island) ST.status = r.island; /* 後端校正 */
        toast(r.reason || `${a?.label || "開疆"}成功！`);
        paint();
      } catch (e) {
        ST.status = snap; /* 回滾 */
        toast(`開疆失敗：${e.message}`);
        paint();
      }
    };
  });

  /* 建築島嶼切換 */
  document.getElementById("i-build-island")?.addEventListener("change", paint);

  /* 建造 / 升級：樂觀 */
  view.querySelectorAll("[data-build]").forEach(btn => {
    btn.onclick = async () => {
      const btype = btn.dataset.build;
      const islandId = btn.dataset.island;
      const lv = Number(btn.dataset.lv) || 0;
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "建造中…";
      announce(`正在${lv === 0 ? "建造" : "升級"}${btype}`);
      try {
        const r = await post("/world/build", { island_id: islandId, btype }, { idempotent: true });
        toast(r.reason || `${btype} Lv.${r.level} 完成！`);
        /* 重整命名島嶼（建築等級） */
        try {
          const nr = await swr("world:islands", "/world/islands");
          const d = nr.data;
          ST.named = d?.islands || (Array.isArray(d) ? d : []);
        } catch { /* 保持舊列表 */ }
        paint();
      } catch (e) {
        toast(`建造失敗：${e.message}`);
        btn.disabled = false; btn.textContent = old;
      }
    };
  });

  /* 標籤雲佔領 */
  view.querySelectorAll("[data-tag]").forEach(btn => {
    btn.onclick = () => occupyTag(btn.dataset.tag, btn);
  });
  document.getElementById("i-occupy-go")?.addEventListener("click", () => {
    const tag = document.getElementById("i-tag-input").value.trim();
    if (!tag) { announce("請先輸入標籤"); return; }
    occupyTag(tag, document.getElementById("i-occupy-go"));
  });
}

async function occupyTag(tag, btn) {
  if (btn) btn.disabled = true;
  /* 樂觀：先高亮 */
  const tags = new Set(ST.status?.occupied_tags || []);
  const had = tags.has(tag);
  if (!had && ST.status) {
    ST.status.occupied_tags = [...tags, tag];
    paint();
  }
  try {
    const r = await post(`/islands/${userId}/occupy`, { tag });
    if (r.island) ST.status = r.island;
    else if (ST.status && !had) ST.status.occupied_tags = [...new Set([...(ST.status.occupied_tags || []), tag])];
    toast(r.reason || `已佔領「${tag}」🚩`);
    paint();
  } catch (e) {
    /* 回滾樂觀高亮 */
    if (ST.status && !had) ST.status.occupied_tags = [...tags];
    toast(`佔領失敗：${e.message}`);
    paint();
  }
}

/* 命名新島嶼（session_id 必填，取書架最新戰役；無則時間戳） */
function bindNamed() {
  document.getElementById("i-create-island")?.addEventListener("click", async () => {
    const name = document.getElementById("i-island-name").value.trim();
    const topic = document.getElementById("i-island-topic").value.trim();
    if (!name) { announce("請先輸入島嶼名稱"); return; }
    const btn = document.getElementById("i-create-island");
    btn.disabled = true; btn.textContent = "命名中…";
    let session_id = `manual-${Date.now()}`;
    try {
      const hs = await swr("learn:sessions", "/learn/sessions").catch(() => null);
      const arr = hs?.data?.sessions || hs?.data || [];
      const first = Array.isArray(arr) ? arr[0] : arr?.items?.[0];
      const sid = first?.id || first?.sid || first?.session_id;
      if (sid) session_id = sid;
    } catch { /* 用預設值 */ }
    try {
      const r = await post("/world/islands", { name, topic, session_id }, { idempotent: true });
      toast(`「${r.island?.name || name}」已在星海中浮現 🗺️`);
      try {
        const nr = await swr("world:islands", "/world/islands");
        const d = nr.data;
        ST.named = d?.islands || (Array.isArray(d) ? d : []);
      } catch { /* 保持舊列表 */ }
      paint();
    } catch (e) {
      toast(`命名失敗：${e.message}`);
      btn.disabled = false; btn.textContent = "命名新島嶼";
    }
  });
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
  await loadAll();
  paint();
})();
