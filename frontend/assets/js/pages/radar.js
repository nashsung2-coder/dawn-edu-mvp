/* 三維雷達：天賦盤式能力星圖。全調真實後端，零假數據。
 * 流程：著陸 → 我的天賦盤（漸層雷達＋三軸卡片）→ 距離比較（並排對照）
 * 生命週期：init → loading(skeleton) → api → render / empty / error
 */
import { swr, get } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("r-view");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function skeleton(h = 200) {
  view.innerHTML = `<div class="skeleton" style="height:${h}px" aria-hidden="true"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="r-retry">重試</button></div>`;
  document.getElementById("r-retry").onclick = retry;
}
function loginView() {
  view.innerHTML = `<div class="state-empty">
    <p>請先登入再查看三維雷達</p>
    <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
}

/* 三軸：中文名＋介面說明（數值與公式來自後端） */
const AXES = [
  { key: "x", name: "知識廣度", desc: "跨學科標籤的覆蓋情形", hue: "#4da3ff" },
  { key: "y", name: "認知深度", desc: "高難度內容的完成情形", hue: "#b678ff" },
  { key: "z", name: "社會連結", desc: "共修與旅人互動的情形", hue: "#4ce0b3" },
];

let __radarStyleInjected = false;
function radarStyle() {
  if (__radarStyleInjected) return "";
  __radarStyleInjected = true;
  return `<style>
    @keyframes rExpand { from { transform: scale(.12); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    .r-expand { transform-box: fill-box; transform-origin: center; animation: rExpand .9s cubic-bezier(.2,.8,.25,1); }
    @keyframes rPulse { 0%,100% { opacity:.5; } 50% { opacity:1; } }
    .r-node { animation: rPulse 2.4s ease-in-out infinite; }
  </style>`;
}

/* 天賦盤雷達：SVG 三軸 120°，漸層填充＋展開動畫＋頂點數值 */
function radarSvg(data, gid, small) {
  const cx = 110, cy = 105, R = small ? 80 : 84;
  const size = small ? "220 210" : "220 215";
  const maxW = small ? "240px" : "330px";
  const pt = (angleDeg, v) => {
    const r = R * Math.max(0, Math.min(100, v)) / 100;
    const a = (angleDeg - 90) * Math.PI / 180;
    return [(cx + r * Math.cos(a)).toFixed(1), (cy + r * Math.sin(a)).toFixed(1)];
  };
  const angles = [0, 120, 240];
  const vals = AXES.map(ax => Math.max(0, Math.min(100, Math.round(data[ax.key] ?? 0))));
  const verts = angles.map((a, i) => pt(a, vals[i]).join(",")).join(" ");
  const grid = [25, 50, 75, 100].map(pct =>
    `<polygon points="${angles.map(a => pt(a, pct).join(",")).join(" ")}"
      fill="none" stroke="var(--line)" stroke-width="1" opacity="0.55"/>`
  ).join("");
  const spokes = angles.map((a, i) => {
    const end = pt(a, 100);
    return `<line x1="${cx}" y1="${cy}" x2="${end[0]}" y2="${end[1]}"
      stroke="${AXES[i].hue}" stroke-width="1.2" opacity="0.5"/>`;
  }).join("");
  const labels = angles.map((a, i) => {
    const p = pt(a, small ? 122 : 120);
    return `<text x="${p[0]}" y="${p[1]}" text-anchor="middle" font-size="11" font-weight="700"
      fill="${AXES[i].hue}">${AXES[i].name}</text>`;
  }).join("");
  const nodes = angles.map((a, i) => {
    const p = pt(a, vals[i]);
    return `<g class="r-node" style="animation-delay:${i * 0.4}s">
      <circle cx="${p[0]}" cy="${p[1]}" r="5.5" fill="${AXES[i].hue}" opacity="0.3"/>
      <circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${AXES[i].hue}"/>
      <text x="${p[0]}" y="${(+p[1] - 10).toFixed(1)}" text-anchor="middle"
        font-size="12" font-weight="800" fill="${AXES[i].hue}">${vals[i]}</text>
    </g>`;
  }).join("");
  const aria = AXES.map((ax, i) => `${ax.name}${vals[i]}`).join("、");
  return `<svg viewBox="0 0 ${size}" role="img" style="width:100%;max-width:${maxW};display:block;margin:0 auto"
    aria-label="雷達圖：${aria}">
    <defs>
      <radialGradient id="rg-${gid}" cx="50%" cy="50%" r="65%">
        <stop offset="0%" stop-color="#ffd97a" stop-opacity="0.55"/>
        <stop offset="55%" stop-color="var(--accent)" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.06"/>
      </radialGradient>
    </defs>
    ${grid}${spokes}${labels}
    <g class="r-expand">
      <polygon points="${verts}" fill="url(#rg-${gid})" stroke="#ffd97a" stroke-width="2"
        stroke-linejoin="round"/>
    </g>${nodes}</svg>`;
}

/* 三軸天賦卡：名稱＋數值＋漸層條＋計算公式 */
function axisCards(data, formula) {
  return `<div style="display:grid;gap:12px;margin-top:16px">` + AXES.map(ax => {
    const v = Math.max(0, Math.min(100, Math.round(data[ax.key] ?? 0)));
    const f = formula?.[ax.key] || "";
    return `<div class="card" style="border-left:5px solid ${ax.hue};margin:0">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div><strong style="font-size:16px">${ax.name}</strong>
          <span style="color:var(--muted);font-size:12px;margin-left:8px">${ax.desc}</span></div>
        <span style="font-size:26px;font-weight:900;color:${ax.hue}" aria-label="${ax.name}數值">${v}</span>
      </div>
      <div role="progressbar" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100"
        aria-label="${ax.name}進度"
        style="height:12px;border-radius:999px;background:var(--line);overflow:hidden;margin-top:10px">
        <div style="width:${v}%;height:100%;border-radius:999px;
          background:linear-gradient(90deg,${ax.hue}55,${ax.hue});transition:width .8s ease"></div>
      </div>
      ${f ? `<p style="color:var(--muted);font-size:12px;margin:8px 0 0">
        <span style="border:1px solid var(--line);border-radius:6px;padding:1px 7px;font-size:11px">計算公式</span>
        ${escapeHtml(f)}</p>` : ""}
    </div>`;
  }).join("") + `</div>`;
}

function detailHtml(detail) {
  if (!detail) return "";
  const subjects = detail.subjects || [];
  return `<div class="card" style="margin-top:16px">
    <h2 style="margin-top:0">📊 座標明細</h2>
    <p>跨學科標籤：${subjects.length ? subjects.map(escapeHtml).join("、") : "尚無"}</p>
    <p>完成的高難度內容：${detail.high_diff_completed ?? 0} 篇</p>
    <p>共修次數：${detail.co_study_count ?? 0} 次</p>
  </div>`;
}

/* ---- 主畫面：我的天賦盤＋距離比較 ---- */
function renderMain(uid, radar) {
  const data = radar || {};
  const isEmpty = (data.x ?? 0) === 0 && (data.y ?? 0) === 0 && (data.z ?? 0) === 0;

  view.innerHTML = radarStyle() + `
    <div class="card" style="margin-bottom:16px;text-align:center;
      background:linear-gradient(180deg,rgba(20,12,40,.35),transparent)">
      <p style="color:#ffd97a;letter-spacing:6px;font-size:12px;margin:0 0 4px">✦ TALENT RADAR ✦</p>
      <h2 style="margin:0 0 4px">我的能力星圖</h2>
      ${isEmpty
        ? `<div class="state-empty" style="padding:12px">
             <p>雷達還是原點——去試煉場、佔領標籤、參與共修，<br>讓星圖亮起來吧！</p>
             <a class="btn btn-primary" href="quiz.html">去試煉</a></div>`
        : radarSvg(data, "me", false)}
    </div>
    ${isEmpty ? "" : axisCards(data, data.formula)}
    ${detailHtml(data.detail)}
    <div class="card" style="margin-top:16px">
      <h2 style="margin-top:0">🔭 距離比較</h2>
      <p style="color:var(--muted);font-size:13px">輸入另一位旅人的使用者 ID，並排對照你們的天賦盤。</p>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input id="r-other" type="text" placeholder="對方使用者 ID（例如 u_xxxx）"
          aria-label="對方使用者 ID" autocomplete="off"
          style="flex:1;padding:12px 16px;border:1px solid var(--line);border-radius:12px;font-size:14px">
        <button class="btn btn-primary" id="r-compare">比較</button>
      </div>
      <div id="r-compare-result" aria-live="polite" style="margin-top:12px"></div>
    </div>`;

  document.getElementById("r-compare").onclick = () => compare(uid);
  focusMain();
}

/* 並排對照：雙方雷達＋距離＋關係＋三軸差值 */
async function compare(uid) {
  const other = document.getElementById("r-other").value.trim();
  const box = document.getElementById("r-compare-result");
  if (!other) { announce("請輸入對方使用者 ID"); return; }
  if (other === uid) { announce("不能跟自己比較"); return; }
  box.innerHTML = `<div class="skeleton" style="height:120px" aria-hidden="true"></div>`;
  announce("正在計算雷達距離");
  try {
    const r = await get(`/radar/compare?me=${encodeURIComponent(uid)}&other=${encodeURIComponent(other)}`);
    const dist = r.distance_percent ?? r.distance ?? null;
    const relation = r.relation || "";
    const reason = r.reason || "";
    const meD = r.me || {}, otD = r.other || {};
    const relColor = /合作|夥伴/.test(relation) ? "#4caf50"
      : /互補/.test(relation) ? "#4da3ff" : "#b678ff";

    const deltaRows = AXES.map(ax => {
      const a = Math.round(meD[ax.key] ?? 0), b = Math.round(otD[ax.key] ?? 0);
      const d = b - a;
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">
        <span style="width:76px;color:${ax.hue};font-weight:700">${ax.name}</span>
        <span style="flex:1;text-align:right">我 <strong>${a}</strong></span>
        <span style="flex:1;text-align:right">對方 <strong>${b}</strong></span>
        <span style="width:64px;text-align:right;font-weight:800;
          color:${d > 0 ? "#f44336" : d < 0 ? "#4caf50" : "var(--muted)"}">
          ${d > 0 ? `+${d}` : d < 0 ? `${d}` : "—"}</span>
      </div>`;
    }).join("");

    box.innerHTML = `
      <div style="border-radius:14px;padding:20px 16px;margin-bottom:12px;text-align:center;
        background:linear-gradient(135deg,rgba(20,12,40,.9),rgba(60,30,90,.9));
        border:1px solid ${relColor}">
        <p style="color:var(--muted);font-size:12px;letter-spacing:4px;margin:0 0 6px">KNOWLEDGE DISTANCE</p>
        ${dist !== null ? `<p style="font-size:44px;font-weight:900;margin:0;color:#fff"
          aria-label="雷達距離 ${dist}%">${escapeHtml(String(dist))}<span style="font-size:20px">%</span></p>` : ""}
        ${relation ? `<p style="display:inline-block;margin:10px 0 0;padding:6px 18px;border-radius:999px;
          background:${relColor}22;border:1px solid ${relColor};color:${relColor};font-weight:800;font-size:14px">
          ${escapeHtml(relation)}</p>` : ""}
        ${reason ? `<p style="color:#d9cdf0;font-size:13px;margin:10px 0 0">${escapeHtml(reason)}</p>` : ""}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div class="card" style="margin:0;text-align:center">
          <p style="font-weight:800;margin:0 0 8px;color:#4da3ff">🔵 我</p>
          ${radarSvg(meD, "cmp-me", true)}
        </div>
        <div class="card" style="margin:0;text-align:center">
          <p style="font-weight:800;margin:0 0 8px;color:#ff5a5a">🔴 對方</p>
          ${radarSvg(otD, "cmp-ot", true)}
        </div>
      </div>
      <div class="card" style="margin:0">
        <h3 style="margin-top:0">三軸對照 <span style="color:var(--muted);font-size:12px;font-weight:400">（差值＝對方−我）</span></h3>
        ${deltaRows}
      </div>`;
    announce(`比較完成，雷達距離 ${dist !== null ? dist + "%" : "未知"}，關係${relation}`);
  } catch (e) {
    box.innerHTML = `<div class="state-error" style="padding:12px">
      <p>比較失敗：${escapeHtml(e.message)}（${e.code || "未知"}）</p></div>`;
  }
}

/* ---- 啟動 ---- */
(async function init() {
  if (!isLoggedIn()) { loginView(); return; }
  skeleton();
  announce("載入三維雷達");
  try {
    const me = await swr("auth:me", "/auth/me");
    const user = me.data?.user || me.data;
    const uid = user?.id;
    if (!uid) throw new Error("無法取得使用者 ID");
    const r = await swr(`radar:${uid}`, `/radar/${uid}`);
    const radar = r.data || {};
    renderMain(uid, radar);
    if (r.stale) announce("顯示的是快取資料，正在更新");
  } catch (e) {
    errorView(`雷達讀取失敗：${e.message}（${e.code || "未知"}）`, init);
  }
})();
