/* 三維雷達：能力星圖。全調真實後端，零假數據。
 * 流程：著陸 → 載入自己的三維座標（SVG 雷達三角＋數值條）→ 輸入對方 ID 比較距離
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

/* 三軸中文名＋公式說明（公式文字來自後端 formula 欄位） */
const AXES = [
  { key: "x", name: "知識廣度" },
  { key: "y", name: "認知深度" },
  { key: "z", name: "社會連結" },
];

/* 簡易雷達三角：SVG 三軸 120°，數值 0–100 映射半徑 */
function radarSvg(data) {
  const cx = 110, cy = 105, R = 80;
  const pt = (angleDeg, v) => {
    const r = R * Math.max(0, Math.min(100, v)) / 100;
    const a = (angleDeg - 90) * Math.PI / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  };
  const angles = [0, 120, 240];
  const verts = angles.map((a, i) => pt(a, data[AXES[i].key] ?? 0)).join(" ");
  const grid = [25, 50, 75, 100].map(pct =>
    `<polygon points="${angles.map(a => pt(a, pct)).join(" ")}"
      fill="none" stroke="var(--line)" stroke-width="1" opacity="0.6"/>`
  ).join("");
  const spokes = angles.map(a =>
    `<line x1="${cx}" y1="${cy}" x2="${pt(a, 100).split(",")[0]}" y2="${pt(a, 100).split(",")[1]}"
      stroke="var(--line)" stroke-width="1"/>`
  ).join("");
  const labels = angles.map((a, i) => {
    const p = pt(a, 118).split(",");
    return `<text x="${p[0]}" y="${p[1]}" text-anchor="middle" font-size="11"
      fill="var(--muted)">${AXES[i].name}</text>`;
  }).join("");
  return `<svg viewBox="0 0 220 210" role="img" style="width:100%;max-width:320px;display:block;margin:0 auto"
    aria-label="雷達圖：${AXES.map(ax => `${ax.name}${Math.round(data[ax.key] ?? 0)}`).join("、")}">${grid}${spokes}
    <polygon points="${verts}" fill="var(--accent)" fill-opacity="0.25"
      stroke="var(--accent)" stroke-width="2"/>${labels}</svg>`;
}

function coordBars(data, formula) {
  return AXES.map(ax => {
    const v = Math.max(0, Math.min(100, Math.round(data[ax.key] ?? 0)));
    const f = formula?.[ax.key] || "";
    return `<div class="r-bar" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span><strong>${ax.name}</strong></span><span aria-label="${ax.name}數值">${v}</span>
      </div>
      <div class="r-track" role="progressbar" aria-valuenow="${v}" aria-valuemin="0"
        aria-valuemax="100" aria-label="${ax.name}"
        style="height:10px;border-radius:999px;background:var(--line);overflow:hidden;margin-top:6px">
        <div class="r-fill" style="width:${v}%;height:100%;background:var(--accent)"></div>
      </div>
      ${f ? `<p style="color:var(--muted);font-size:12px;margin:4px 0 0">${escapeHtml(f)}</p>` : ""}
    </div>`;
  }).join("");
}

function detailHtml(detail) {
  if (!detail) return "";
  const subjects = detail.subjects || [];
  return `<div class="card" style="margin-top:16px">
    <h2>座標明細</h2>
    <p>跨學科標籤：${subjects.length ? subjects.map(escapeHtml).join("、") : "尚無"}</p>
    <p>完成的高難度內容：${detail.high_diff_completed ?? 0} 篇</p>
    <p>共修次數：${detail.co_study_count ?? 0} 次</p>
  </div>`;
}

/* ---- 主畫面：我的雷達＋比較 ---- */
function renderMain(uid, radar) {
  const data = radar || {};
  const isEmpty = (data.x ?? 0) === 0 && (data.y ?? 0) === 0 && (data.z ?? 0) === 0;

  view.innerHTML = `<div class="card" style="margin-bottom:16px">
      <h2>我的能力星圖</h2>
      ${isEmpty
        ? `<div class="state-empty" style="padding:12px">
             <p>雷達還是原點——去試煉場、佔領標籤、參與共修，<br>讓星圖亮起來吧！</p>
             <a class="btn btn-primary" href="quiz.html">去試煉</a></div>`
        : radarSvg(data)}
      ${coordBars(data, data.formula)}
    </div>
    ${detailHtml(data.detail)}
    <div class="card" style="margin-top:16px">
      <h2>距離比較</h2>
      <p style="color:var(--muted);font-size:13px">輸入另一位旅人的使用者 ID，看看你們的知識距離。</p>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input id="r-other" type="text" placeholder="對方使用者 ID（例如 u_xxxx）"
          aria-label="對方使用者 ID"
          style="flex:1;padding:12px 16px;border:1px solid var(--line);border-radius:12px;font-size:14px">
        <button class="btn btn-primary" id="r-compare">比較</button>
      </div>
      <div id="r-compare-result" aria-live="polite" style="margin-top:12px"></div>
    </div>`;

  document.getElementById("r-compare").onclick = () => compare(uid);
  focusMain();
}

async function compare(uid) {
  const other = document.getElementById("r-other").value.trim();
  const box = document.getElementById("r-compare-result");
  if (!other) { announce("請輸入對方使用者 ID"); return; }
  if (other === uid) { announce("不能跟自己比較"); return; }
  box.innerHTML = `<div class="skeleton" style="height:80px" aria-hidden="true"></div>`;
  announce("正在計算雷達距離");
  try {
    const r = await get(`/radar/compare?me=${encodeURIComponent(uid)}&other=${encodeURIComponent(other)}`);
    const dist = r.distance_percent ?? r.distance ?? null;
    const relation = r.relation || "";
    const reason = r.reason || "";
    const me = r.me || {}, ot = r.other || {};
    box.innerHTML = `<div class="card" style="border-left:4px solid var(--accent)">
      <h3>距離比較結果</h3>
      ${dist !== null ? `<p style="font-size:28px;font-weight:800" aria-label="雷達距離 ${dist}%">
        ${escapeHtml(String(dist))}%</p>` : ""}
      ${relation ? `<p><strong>關係：${escapeHtml(relation)}</strong></p>` : ""}
      ${reason ? `<p style="color:var(--muted);font-size:13px">${escapeHtml(reason)}</p>` : ""}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;font-size:13px">
        <div><strong>我</strong><br>${AXES.map(ax => `${ax.name} ${Math.round(me[ax.key] ?? 0)}`).map(escapeHtml).join("<br>")}</div>
        <div><strong>對方</strong><br>${AXES.map(ax => `${ax.name} ${Math.round(ot[ax.key] ?? 0)}`).map(escapeHtml).join("<br>")}</div>
      </div>
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
