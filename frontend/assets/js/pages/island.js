/* 島嶼世界：動森式家園 ＋ 部落衝突式開拓
 * 英雄圖（按領土等級）→ 儀表板 → 開疆任務卡 → 建築槽位 → 標籤雲 → 我的島嶼 → 領土日誌
 * v4.0：直讀 Supabase（islands 表；領土/建築/標籤以 JSON 存於 style 欄位）＋ pets 表，不再經 Render 後端
 * 生命週期：init → loading → api → render / empty / error
 */
import { supabase, getUser } from "../core/supabase.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("i-view");
const sub = document.getElementById("i-sub");
const LOG_KEY_PREFIX = "dawn:island:logs:";

/* ---- 真實獎勵表（沿用原設計） ---- */
const EXPAND_ACTIONS = [
  { key: "complete_topic", label: "完成主題", desc: "完成一個學習主題",
    reward: "領土 +1.0 · 好奇種子 ×1 · 星砂 ×10", delta: 1.0 },
  { key: "fix_myth", label: "破除迷思", desc: "修正一個錯誤觀念",
    reward: "領土 +1.0 · 觀察之眼 ×1 · 星砂 ×10", delta: 1.0 },
  { key: "ask_question", label: "提出好問題", desc: "提出一個新問題",
    reward: "領土 +0.5 · 好奇種子 ×1 · 星砂 ×10", delta: 0.5 },
  { key: "complete_quest", label: "完成任務", desc: "完成一個任務委託",
    reward: "領土 +2.0 · 變因齒輪 ×1 · 心流之泉 ×1 · 星砂 ×10", delta: 2.0 },
  { key: "co_study", label: "共學", desc: "與夥伴完成共修任務",
    reward: "領土 +1.5 · 連結之網 ×1 · 星砂 ×10", delta: 1.5 },
];

const BUILDINGS = [
  { type: "圖書館", desc: "加速文獻理解：測驗前可多看一次提示" },
  { type: "訓練場", desc: "提升武器默契成長速度" },
  { type: "瞭望塔", desc: "探索加成：劇情選項多一條線索" },
];
const BUILD_MAX = 5;
const DAILY_CAP = 5;

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
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* ---- 島嶼 style JSON 解析/序列化（領土/建築/標籤存於 style 欄位） ---- */
function parseIsland(row) {
  let meta = {};
  try { meta = JSON.parse(row.style || "{}"); } catch (e) {}
  const isToday = meta.last_expand_date === todayStr();
  return {
    id: row.id,
    name: row.name || "無名島",
    territory: Number(meta.territory) || 0,
    buildings: meta.buildings || {},
    occupied_tags: meta.tags || [],
    used_today: isToday ? (Number(meta.used_today) || 0) : 0,
    daily_cap: DAILY_CAP,
    resources: meta.resources || {},
    created_at: row.created_at,
  };
}
function dumpStyle(st) {
  return JSON.stringify({
    territory: st.territory,
    buildings: st.buildings || {},
    tags: st.occupied_tags || [],
    resources: st.resources || {},
    last_expand_date: todayStr(),
    used_today: st.used_today,
  });
}
async function persistStatus() {
  if (!ST.status?.id) return;
  try {
    const { error } = await supabase.from("islands").update({ style: dumpStyle(ST.status) }).eq("id", ST.status.id);
    if (error) throw error;
  } catch (e) {
    console.warn("[island] persist failed:", e.message);
  }
}

/* ---- 領土日誌（localStorage 簡化版） ---- */
function loadLogs() {
  try {
    const raw = localStorage.getItem(LOG_KEY_PREFIX + userId);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function pushLog(action) {
  try {
    const arr = loadLogs();
    arr.unshift({ action, created_at: new Date().toISOString() });
    localStorage.setItem(LOG_KEY_PREFIX + userId, JSON.stringify(arr.slice(0, 30)));
    ST.logs = arr.slice(0, 30);
  } catch (e) {}
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
  const [islandsR, tagsR] = await Promise.allSettled([
    supabase.from("islands").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
    supabase.from("knowledge_nodes").select("title").eq("user_id", userId).limit(30),
  ]);

  if (islandsR.status === "fulfilled" && !islandsR.value.error) {
    const rows = islandsR.value.data || [];
    ST.named = rows;
    ST.status = rows.length ? parseIsland(rows[0]) : null;
    ST.statusErr = null;
  } else {
    ST.status = null;
    ST.statusErr = islandsR.status === "rejected" ? islandsR.reason : islandsR.value.error;
    console.warn("[island] islands failed:", ST.statusErr?.message);
  }
  ST.logs = loadLogs();
  if (tagsR.status === "fulfilled" && !tagsR.value.error) {
    ST.tagCloud = (tagsR.value.data || []).slice(0, 24).map((n, i) => ({
      code: `NOTE:${i}:${(n.title || "").slice(0, 12)}`,
      label: (n.title || "未命名").slice(0, 12),
      dim: "我的知識",
    }));
  } else {
    ST.tagCloud = [];
    console.warn("[island] tags failed");
  }
}

/* ================= 渲染 ================= */
function heroHtml() {
  const st = ST.status;
  if (!st) return "";
  return `<img src="${heroImg(st.territory)}" alt="${heroAlt(st.territory)}"
    style="${S.hero}" loading="eager">`;
}

/* 中央家園：寵物＋領地＋探索進度＋傳送門 */
let HOME_PET = null;

async function loadHomePet() {
  try {
    const { data, error } = await supabase.from("pets")
      .select("*").eq("owner_id", userId).order("created_at", { ascending: false }).limit(1);
    if (error) throw error;
    HOME_PET = (data && data[0]) || null;
  } catch (e) { HOME_PET = null; }
}

function homeHtml() {
  const st = ST.status;
  if (!st) return "";
  const territory = Number(st.territory) || 0;
  const pet = HOME_PET;
  const explorePct = Math.min(100, Math.round((territory / 50) * 100));

  return `<div class="card" style="${S.card};text-align:center;position:relative;overflow:hidden">
    <h2 style="margin:0 0 12px">我的家</h2>
    <div style="display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap">
      ${pet ? `
      <div style="text-align:center">
        <img src="${petImgForHome(pet.level)}" alt="${escapeHtml(pet.name || "靈獸")}"
          style="width:100px;height:100px;object-fit:cover;border-radius:50%;border:2px solid var(--line)">
        <div style="font-size:13px;margin-top:6px"><strong>${escapeHtml(pet.name || "無名")}</strong> Lv.${pet.level || 1}</div>
        <a href="pet.html" style="font-size:12px;color:var(--accent)">去看靈獸 →</a>
      </div>` : `
      <div style="text-align:center;color:var(--muted);font-size:13px">
        <img src="../assets/img/game/pet-egg.webp?v=3.0.0" alt="靈獸蛋" style="width:64px;height:64px;object-fit:contain">
        <p>還沒有靈獸<br><a href="pet.html" style="color:var(--accent)">去孵化 →</a></p>
      </div>`}
      <div style="text-align:center;min-width:140px">
        <div style="font-size:32px;font-weight:800">${territory}</div>
        <div style="font-size:12px;color:var(--muted)">領土單位</div>
      </div>
      <div style="text-align:center;min-width:140px">
        <div style="font-size:13px;color:var(--muted);margin-bottom:4px">探索進度</div>
        <div style="${S.barWrap};width:120px;margin:0 auto">
          <div style="${S.barFill};width:${explorePct}%"></div>
        </div>
        <div style="font-size:12px;margin-top:4px">${explorePct}%</div>
      </div>
    </div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line)">
      <h3 style="margin:0 0 8px;font-size:15px">傳送門</h3>
      <p style="font-size:13px;color:var(--muted);margin:0 0 8px">拜訪好友的島嶼，看看他們的領地（啟動需 20 星砂）</p>
      <div style="display:flex;gap:8px;justify-content:center;max-width:400px;margin:0 auto">
        <input id="i-portal-name" type="text" placeholder="好友的名字"
          aria-label="好友名字"
          style="flex:1;padding:10px 14px;border:1px solid var(--line);border-radius:999px;font-size:14px">
        <button class="btn btn-primary" id="i-portal-go" style="white-space:nowrap">拜訪好友</button>
      </div>
      <div id="i-portal-result" style="margin-top:12px"></div>
    </div>
  </div>`;
}

function petImgForHome(level) {
  const lv = Number(level) || 1;
  if (lv >= 10) return "../assets/img/game/pet-adult.webp?v=3.0.0";
  if (lv >= 5) return "../assets/img/game/pet-baby.webp?v=3.0.0";
  return "../assets/img/game/pet-egg.webp?v=3.0.0";
}

function dashboardHtml() {
  const st = ST.status;
  if (!st) {
    return `<div class="state-empty" style="${S.card}">
      <img src="../assets/img/empty-neon.webp?v=3.0.0" alt="空島插圖" style="width:120px">
      <p>${ST.statusErr ? `島嶼狀態讀取失敗：${escapeHtml(ST.statusErr.message || "未知錯誤")}` : "你的島嶼還在星海中沉睡"}</p>
      <button class="btn btn-primary" id="i-wake">開疆拓土，喚醒島嶼</button>
    </div>`;
  }
  const used = Number(st.used_today) || 0;
  const cap = Number(st.daily_cap) || DAILY_CAP;
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const res = st.resources || {};
  const resChips = Object.keys(res).length
    ? Object.entries(res).map(([k, v]) =>
        `<span style="${S.tag};cursor:default">${escapeHtml(k)} ×${escapeHtml(String(v))}</span>`).join("")
    : `<span style="${S.muted};font-size:13px">開疆拓土可獲得資源</span>`;
  return `<div class="card" style="${S.card}">
    <h2 style="margin:0 0 4px">${escapeHtml(st.name || "無名島")}</h2>
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
  const cap = Number(st?.daily_cap) || DAILY_CAP;
  return `<div class="card" style="${S.card}">
    <h3 style="margin-top:0">開疆拓土</h3>
    <p style="${S.muted};font-size:13px;margin:0">選一個學習行動，島嶼立即擴張。點下去馬上有效果！</p>
    <div style="${S.questGrid}" role="group" aria-label="開疆任務">` +
    EXPAND_ACTIONS.map(a => {
      const capped = used + a.delta > cap + 1e-9;
      return `<button class="i-quest" data-expand="${a.key}" data-delta="${a.delta}"
        ${capped || !st ? "disabled" : ""}
        aria-label="${a.label}：${a.reward}${capped ? "（今日額度已滿）" : ""}"
        style="${S.questCard}${capped || !st ? ";opacity:.45" : ""}">
        <strong style="font-size:15px">${a.label}</strong>
        <span style="font-size:12px;${S.muted}">${a.desc}</span>
        <span style="font-size:12px;color:var(--accent,#4f8cff)">${a.reward}</span>
        ${capped ? `<span style="font-size:12px;color:var(--muted)">今日額度已滿</span>` : ""}
      </button>`;
    }).join("") + `</div></div>`;
}

function buildSlotsHtml() {
  const named = ST.named;
  if (!named.length) {
    return `<div class="card" style="${S.card}">
      <h3 style="margin-top:0">建築</h3>
      <p style="${S.muted};font-size:13px">還沒有命名的島嶼。先到下方「我的島嶼」命名一座，才能蓋建築。</p>
    </div>`;
  }
  const selId = document.getElementById("i-build-island")?.value || named[0].id;
  const row = named.find(i => i.id === selId) || named[0];
  const isl = parseIsland(row);
  const built = isl.buildings || {};
  return `<div class="card" style="${S.card}">
    <h3 style="margin-top:0">建築</h3>
    <label for="i-build-island" style="${S.label}">選擇島嶼</label>
    <select id="i-build-island" style="${S.select}" aria-label="選擇島嶼">
      ${named.map(it => `<option value="${escapeHtml(it.id)}" ${it.id === isl.id ? "selected" : ""}>${escapeHtml(it.name || "無名島")}</option>`).join("")}
    </select>
    <div style="${S.slotGrid}">` +
    BUILDINGS.map(b => {
      const lv = Number(built[b.type]) || 0;
      const maxed = lv >= BUILD_MAX;
      const cost = 50 * (lv + 1);
      const pips = Array.from({ length: BUILD_MAX }, (_, i) =>
        `<span aria-hidden="true" style="color:${i < lv ? "var(--accent,#4f8cff)" : "var(--line)"}">●</span>`).join("");
      return `<div style="border:1px solid var(--line);border-radius:14px;padding:12px">
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
          aria-pressed="${on}" title="${escapeHtml(t.dim)}">${escapeHtml(t.label)}</button>`;
      }).join("")
    : `<span style="${S.muted};font-size:13px">多建立一些知識節點，這裡會出現可佔領的標籤</span>`;
  return `<div class="card" style="${S.card}">
    <h3 style="margin-top:0">佔領標籤</h3>
    <p style="${S.muted};font-size:13px;margin:0 0 8px">點標籤直接佔領，已佔領的會高亮。佔領提升島嶼知識密度。</p>
    <div role="group" aria-label="標籤雲">${cloud}</div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <input id="i-tag-input" type="text" placeholder="自訂標籤，如 物理：力學" aria-label="自訂標籤"
        style="flex:1;${S.input}">
      <button class="btn btn-primary" id="i-occupy-go">佔領</button>
    </div></div>`;
}

function namedHtml() {
  const named = ST.named;
  return `<div class="card" style="${S.card}">
    <h3 style="margin-top:0">我的島嶼</h3>
    ${named.length ? `<div class="i-grid">` + named.map(it => {
      const p = parseIsland(it);
      const bNames = Object.entries(p.buildings || {}).map(([t, lv]) => `${escapeHtml(t)} Lv.${lv}`).join("、");
      return `<div class="card" style="margin:0"><h4 style="margin:0 0 4px">${escapeHtml(it.name || "無名島")}</h4>
       <p style="${S.muted};font-size:13px;margin:0">領土 ${p.territory}${bNames ? ` · ${bNames}` : ""}</p></div>`;
    }).join("") + `</div>`
    : `<p style="${S.muted};font-size:13px">還沒有命名的島嶼</p>`}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <input id="i-island-name" type="text" placeholder="島嶼名稱" aria-label="島嶼名稱"
        maxlength="20" style="flex:1;min-width:140px;${S.input}">
      <button class="btn btn-primary" id="i-create-island">命名新島嶼</button>
    </div></div>`;
}

function logsHtml() {
  const logs = ST.logs;
  return `<div class="card" style="${S.card}">
    <h3 style="margin-top:0">領土日誌</h3>
    ${logs.length ? `<ul style="${S.logs}">` + logs.slice(0, 10).map(l =>
      `<li style="${S.logRow}"><span>${escapeHtml(l.action || "")}</span>
       <span style="${S.muted};font-size:12px">${escapeHtml((l.created_at || "").slice(0, 10))}</span></li>`
    ).join("") + `</ul>` : `<p style="${S.muted};font-size:13px">尚無領土紀錄，開疆拓土來寫下第一筆</p>`}
  </div>`;
}

function paint() {
  view.innerHTML = heroHtml() + homeHtml() + dashboardHtml() + questsHtml()
    + buildSlotsHtml() + tagsHtml() + namedHtml() + logsHtml();
  bindAll();
  bindNamed();
  bindPortal();
  focusMain();
}

function bindPortal() {
  const btn = document.getElementById("i-portal-go");
  if (!btn) return;
  btn.onclick = async () => {
    const nameInput = document.getElementById("i-portal-name");
    const resultDiv = document.getElementById("i-portal-result");
    const name = nameInput.value.trim();
    if (!name) { toast("請輸入好友的名字"); return; }
    btn.disabled = true;
    btn.textContent = "傳送中…";
    resultDiv.innerHTML = "";
    try {
      // 找好友的 profile
      const { data: profiles, error: pErr } = await supabase.from("profiles")
        .select("id, name").ilike("name", `%${name}%`).limit(5);
      if (pErr) throw pErr;
      if (!profiles?.length) throw new Error("找不到這位旅人");
      const host = profiles[0];
      if (host.id === userId) throw new Error("不能拜訪自己的島嶼");
      // 好友的島嶼
      const { data: islands, error: iErr } = await supabase.from("islands")
        .select("*").eq("owner_id", host.id).order("created_at", { ascending: false }).limit(1);
      if (iErr) throw iErr;
      if (!islands?.length) throw new Error(`${host.name} 還沒有島嶼`);
      const isl = parseIsland(islands[0]);
      // 扣傳送費 20 星砂
      const { error: payErr } = await supabase.rpc("transfer_starsand", {
        p_user_id: userId, p_amount: -20, p_reason: `拜訪 ${host.name} 的島嶼`,
      });
      if (payErr) throw new Error(payErr.message.includes("餘額不足") ? "星砂不足（需要 20 星砂）" : payErr.message);
      resultDiv.innerHTML = `<div style="border:1px solid var(--line);border-radius:12px;padding:14px;text-align:left;background:var(--bg-soft)">
        <h4 style="margin:0 0 8px">${escapeHtml(host.name)} 的島嶼</h4>
        <p style="margin:4px 0;font-size:14px">島名：${escapeHtml(isl.name || "無名島")}</p>
        <p style="margin:4px 0;font-size:14px">領土：${escapeHtml(String(isl.territory ?? 0))} 單位</p>
        <p style="margin:8px 0 0;font-size:12px;color:var(--muted)">傳送消耗 20 星砂</p>
      </div>`;
      toast(`已拜訪 ${host.name} 的島嶼！`);
    } catch (e) {
      resultDiv.innerHTML = `<p style="color:var(--danger,#ef4444);font-size:14px">${escapeHtml(e.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "拜訪好友";
    }
  };
}

/* ================= 互動綁定 ================= */
function bindAll() {
  /* 喚醒（無狀態時）：建立第一座島 */
  document.getElementById("i-wake")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "喚醒中…";
    try {
      const { data, error } = await supabase.from("islands").insert({
        owner_id: userId, name: "無名島",
        style: JSON.stringify({ territory: 2, buildings: {}, tags: [], resources: {} }),
      }).select().single();
      if (error) throw error;
      await supabase.rpc("transfer_starsand", {
        p_user_id: userId, p_amount: 10, p_reason: "喚醒島嶼",
      }).catch(() => {});
      ST.named.unshift(data);
      ST.status = parseIsland(data);
      pushLog("喚醒島嶼");
      toast("島嶼已喚醒！");
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
      const snap = JSON.parse(JSON.stringify(ST.status || {}));
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
        // 發放星砂獎勵（原子記帳）
        await supabase.rpc("transfer_starsand", {
          p_user_id: userId, p_amount: 10, p_reason: `開疆拓土：${a?.label || action}`,
        });
        await persistStatus();
        pushLog(`${a?.label || "開疆"}（領土 +${delta}）`);
        toast(`${a?.label || "開疆"}成功！+10 星砂`);
        paint();
      } catch (e) {
        ST.status = snap;
        toast(`開疆失敗：${e.message}`);
        paint();
      }
    };
  });

  /* 建築島嶼切換 */
  document.getElementById("i-build-island")?.addEventListener("change", paint);

  /* 建造 / 升級 */
  view.querySelectorAll("[data-build]").forEach(btn => {
    btn.onclick = async () => {
      const btype = btn.dataset.build;
      const islandId = btn.dataset.island;
      const lv = Number(btn.dataset.lv) || 0;
      const cost = 50 * (lv + 1);
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "建造中…";
      announce(`正在${lv === 0 ? "建造" : "升級"}${btype}`);
      try {
        const { error: payErr } = await supabase.rpc("transfer_starsand", {
          p_user_id: userId, p_amount: -cost, p_reason: `${lv === 0 ? "建造" : "升級"}${btype}`,
        });
        if (payErr) throw new Error(payErr.message.includes("餘額不足") ? `星砂不足（需要 ${cost} 星砂）` : payErr.message);
        // 更新該島嶼的建築等級
        const row = ST.named.find(i => i.id === islandId);
        if (row) {
          const p = parseIsland(row);
          p.buildings = p.buildings || {};
          p.buildings[btype] = lv + 1;
          const { error } = await supabase.from("islands").update({
            style: JSON.stringify({
              territory: p.territory, buildings: p.buildings,
              tags: p.occupied_tags, resources: p.resources,
              last_expand_date: todayStr(), used_today: p.used_today,
            }),
          }).eq("id", islandId);
          if (error) throw error;
          const { data: fresh } = await supabase.from("islands").select("*").eq("id", islandId).single();
          if (fresh) {
            const idx = ST.named.findIndex(i => i.id === islandId);
            ST.named[idx] = fresh;
            if (ST.status?.id === islandId) ST.status = parseIsland(fresh);
          }
        }
        pushLog(`${lv === 0 ? "建造" : "升級"}${btype} Lv.${lv + 1}`);
        toast(`${btype} Lv.${lv + 1} 完成！`);
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
  const tags = new Set(ST.status?.occupied_tags || []);
  const had = tags.has(tag);
  if (!had && ST.status) {
    ST.status.occupied_tags = [...tags, tag];
    paint();
  }
  try {
    await persistStatus();
    if (!had) pushLog(`佔領標籤「${tag}」`);
    toast(had ? `「${tag}」已經佔領過了` : `已佔領「${tag}」`);
    paint();
  } catch (e) {
    if (ST.status && !had) ST.status.occupied_tags = [...tags];
    toast(`佔領失敗：${e.message}`);
    paint();
  }
}

/* 命名新島嶼 */
function bindNamed() {
  document.getElementById("i-create-island")?.addEventListener("click", async () => {
    const name = document.getElementById("i-island-name").value.trim();
    if (!name) { announce("請先輸入島嶼名稱"); return; }
    const btn = document.getElementById("i-create-island");
    btn.disabled = true; btn.textContent = "命名中…";
    try {
      const { data, error } = await supabase.from("islands").insert({
        owner_id: userId, name,
        style: JSON.stringify({ territory: 0, buildings: {}, tags: [], resources: {} }),
      }).select().single();
      if (error) throw error;
      ST.named.unshift(data);
      if (!ST.status) ST.status = parseIsland(data);
      pushLog(`命名新島嶼「${name}」`);
      toast(`「${name}」已在星海中浮現`);
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
    const user = await getUser();
    if (!user) throw new Error("無法取得使用者");
    userId = user.id;
    const { data: profile } = await supabase.from("profiles").select("name").eq("id", user.id).single();
    sub.textContent = `旅人 ${profile?.name || ""} 的島嶼世界`;
  } catch (e) {
    errorView(`載入失敗：${e.message}`, () => location.reload());
    return;
  }
  await loadAll();
  await loadHomePet();
  paint();
})();
