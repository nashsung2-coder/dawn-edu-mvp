/* 市集：錢包餘額 + 商品列表 + 購買（樂觀更新 + 明確反饋）。
 * 上次被罵「購買零反饋」——這次買下去立刻有 toast，失敗自動回滾。
 */
import { swr, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce } from "../core/a11y.js";

const view = document.getElementById("m-view");
const walletEl = document.getElementById("m-wallet");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  root.appendChild(el);
  announce(msg);
  setTimeout(() => el.remove(), 3000);
}

async function loadWallet() {
  try {
    const r = await swr("game:state", "/game/state");
    const pts = r.data?.points ?? r.data?.stardust ?? 0;
    walletEl.textContent = `✦ 星砂 ${Number(pts).toLocaleString()}${r.stale ? "（更新中…）" : ""}`;
    return pts;
  } catch {
    walletEl.textContent = "錢包讀取失敗";
    return 0;
  }
}

async function renderMarket() {
  view.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
  try {
    const r = await swr("world:market", "/world/market");
    const items = r.data?.items || r.data?.listings || (Array.isArray(r.data) ? r.data : []);
    if (!items.length) {
      view.innerHTML = `<div class="state-empty">
        <img src="../assets/img/empty-neon.webp?v=3.0.0" alt="空市集插圖">
        <p>市集目前沒有上架物品${r.stale ? "（顯示快取）" : ""}</p></div>`;
      return;
    }
    view.innerHTML = `<div class="m-grid">` + items.map(it => {
      const id = it.id || it.lid;
      const price = it.price ?? 0;
      return `<div class="card m-item" data-id="${escapeHtml(id)}">
        <h3>${escapeHtml(it.name || it.title || "未命名")}</h3>
        <p class="m-seller">賣家 ${escapeHtml(it.seller || it.seller_name || "—")}</p>
        <p class="m-price">✦ ${Number(price).toLocaleString()}</p>
        <button class="btn btn-primary" data-buy="${escapeHtml(id)}" data-price="${price}">購買</button>
      </div>`;
    }).join("") + `</div>`;

    view.querySelectorAll("[data-buy]").forEach(btn => {
      btn.onclick = () => buyItem(btn.dataset.buy, +btn.dataset.price, btn);
    });
  } catch (e) {
    view.innerHTML = `<div class="state-error">
      <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
      <p>市集讀取失敗：${escapeHtml(e.message)}</p>
      <button class="btn btn-primary" id="m-retry">重試</button></div>`;
    document.getElementById("m-retry").onclick = renderMarket;
  }
}

/* 購買：樂觀更新 → 成功 toast + 餘額刷新 → 失敗回滾 + 明確錯誤 */
async function buyItem(lid, price, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "購買中…";
  try {
    await post(`/world/market/${lid}/buy`, {});
    toast(`購買成功！✦ -${price.toLocaleString()}`);
    await loadWallet();   // 餘額已由 INVALIDATION_MAP + 廣播失效，這裡重讀
    btn.textContent = "已購買";
  } catch (e) {
    btn.disabled = false;
    btn.textContent = original;
    toast(`購買失敗：${e.message}`);
  }
}

(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty"><p>請先登入再逛市集</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    walletEl.textContent = "未登入";
    return;
  }
  await loadWallet();
  renderMarket();
})();
