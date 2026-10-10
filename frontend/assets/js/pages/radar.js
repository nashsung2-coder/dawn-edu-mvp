/* 三維雷達：能力星圖。全調真實後端，無假數據。 */
import { swr } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";

const view = document.getElementById("r-view");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty"><p>請先登入</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  view.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
  try {
    // 先拿 me 取得 user id，再查 radar
    const me = await swr("auth:me", "/auth/me");
    const uid = me.data?.id;
    if (!uid) throw new Error("無法取得使用者 ID");
    const r = await swr(`radar:${uid}`, `/radar/${uid}`);
    const dims = r.data?.dimensions || r.data?.stats || r.data || {};

    const entries = Object.entries(dims).filter(([, v]) => typeof v === "number");
    if (!entries.length) {
      view.innerHTML = `<div class="state-empty">
        <img src="../assets/img/empty-neon.webp?v=3.0.0" alt="空插圖">
        <p>還沒有雷達數據，去試煉場累積戰績吧</p>
        <a class="btn btn-primary" href="quiz.html">去試煉</a></div>`;
      return;
    }
    const names = { attack: "攻擊", defense: "防禦", speed: "速度", wisdom: "智慧", luck: "運氣" };
    view.innerHTML = entries.map(([k, v]) => {
      const pct = Math.max(0, Math.min(100, Math.round(v * 100)));
      return `<div class="r-bar">
        <label><span>${escapeHtml(names[k] || k)}</span><span>${pct}</span></label>
        <div class="r-track"><div class="r-fill" style="width:${pct}%"></div></div></div>`;
    }).join("") + (r.stale ? `<p style="color:var(--muted);font-size:12px">顯示快取，更新中…</p>` : "");
  } catch (e) {
    view.innerHTML = `<div class="state-error">
      <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
      <p>雷達讀取失敗：${escapeHtml(e.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">重試</button></div>`;
  }
})();
