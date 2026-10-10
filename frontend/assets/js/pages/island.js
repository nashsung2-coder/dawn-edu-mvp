/* 島嶼世界：寵物 + 島嶼列表。全調真實後端。 */
import { swr, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce } from "../core/a11y.js";

const view = document.getElementById("i-view");
const sub = document.getElementById("i-sub");

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

async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty"><p>請先登入</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    sub.textContent = "未登入";
    return;
  }
  view.innerHTML = `<div class="skeleton" style="height:160px"></div>`;

  // 寵物
  let petHtml = "";
  try {
    const r = await swr("world:pet", "/world/pet");
    const pet = r.data?.pet || r.data;
    if (pet && (pet.hatched || pet.name)) {
      petHtml = `<div class="card i-pet">
        <h3>${escapeHtml(pet.name || "小夥伴")}</h3>
        <p style="color:var(--muted)">Lv.${pet.level ?? 1}</p></div>`;
      sub.textContent = `${pet.name || "小夥伴"} 陪著你`;
    } else {
      petHtml = `<div class="card i-pet">
        <p style="color:var(--muted);margin-bottom:12px">你的寵物蛋還沒孵化</p>
        <button class="btn btn-primary" id="i-hatch">孵化</button></div>`;
    }
  } catch {
    petHtml = `<div class="card i-pet"><p style="color:var(--muted)">寵物讀取失敗</p></div>`;
  }

  // 島嶼
  let islandsHtml = "";
  try {
    const r = await swr("world:islands", "/world/islands");
    const list = r.data?.islands || (Array.isArray(r.data) ? r.data : []);
    islandsHtml = list.length
      ? `<div class="i-grid">` + list.map(it =>
          `<div class="card"><h3>${escapeHtml(it.name || "無名島")}</h3>
           <p style="color:var(--muted);font-size:13px">Lv.${it.level ?? 1}</p></div>`).join("") + `</div>`
      : `<div class="state-empty">
          <img src="../assets/img/empty-neon.webp?v=3.0.0" alt="空插圖">
          <p>還沒有島嶼，去探索吧</p>
          <a class="btn btn-primary" href="#" id="i-explore-link">探索</a></div>`;
  } catch (e) {
    islandsHtml = `<div class="state-error"><p>島嶼讀取失敗：${escapeHtml(e.message)}</p></div>`;
  }

  view.innerHTML = petHtml + islandsHtml;

  document.getElementById("i-hatch")?.addEventListener("click", async (e) => {
    const btn = e.target;
    btn.disabled = true; btn.textContent = "孵化中…";
    try {
      const r = await post("/world/pet/hatch", {});
      toast(`孵化成功！${r.pet?.name || "小夥伴"} 誕生了`);
      init();
    } catch (err) { toast(`孵化失敗：${err.message}`); btn.disabled = false; btn.textContent = "孵化"; }
  });
}

init();
