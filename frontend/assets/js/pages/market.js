/* 星海市集：錢包 + 市集列表（購買）+ 我的上架（下架）+ 上架表單 + 武器商店 + 武器庫（使用）。
 * 全調真實後端，零假數據。
 * 生命週期：init → 未登入檢查 → loading(skeleton) → api → render/empty/error
 */
import { swr, post, get, del } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("m-view");
const walletEl = document.getElementById("m-wallet");

/* 武器商店品項：id / 名稱 / 價格（2026-10-10 實測後端價格） */
const SHOP_ITEMS = [
  { id: "dart",   name: "星塵飛鏢", desc: "迅捷的單體攻擊", price: 20 },
  { id: "wave",   name: "潮汐巨浪", desc: "範圍傷害",       price: 20 },
  { id: "shield", name: "曙光護盾", desc: "抵擋一次傷害",   price: 30 },
];

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function skeleton(h = 160) {
  return `<div class="skeleton" style="height:${h}px"></div>
    <div class="skeleton" style="height:20px;margin-top:12px"></div>`;
}
function toast(msg) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  root.appendChild(el); announce(msg);
  setTimeout(() => el.remove(), 3000);
}
function fmt(n) { return Number(n || 0).toLocaleString(); }

/* ---- 錢包 ---- */
let myName = "", myId = "";
async function loadWallet() {
  try {
    const r = await swr("game:state", "/game/state");
    const d = r.data || {};
    const pts = d.points ?? d.stardust ?? 0;
    walletEl.textContent = `✦ 星砂 ${fmt(pts)}${r.stale ? "（更新中…）" : ""}`;
    return { points: pts, inventory: d.inventory || {} };
  } catch {
    walletEl.textContent = "錢包讀取失敗";
    return { points: 0, inventory: {} };
  }
}
async function loadMe() {
  try {
    const r = await swr("auth:me", "/auth/me");
    const d = r.data?.data || r.data || {};
    myName = d.name || ""; myId = String(d.id || "");
  } catch { /* 匿名 */ }
}
function isMine(listing) {
  const seller = listing.seller || listing.seller_name || listing.owner || "";
  const sid = String(listing.seller_id || listing.owner_id || "");
  return (myName && seller === myName) || (myId && sid === myId);
}
function listingId(l) { return l.lid || l.id; }

/* ---- 主渲染 ---- */
async function renderAll() {
  view.innerHTML = `
    <section aria-label="市集列表"><h2>市集列表</h2><div id="m-market">${skeleton()}</div></section>
    <section aria-label="我的上架" style="margin-top:24px"><h2>我的上架</h2><div id="m-mine">${skeleton(80)}</div></section>
    <section aria-label="上架物品" style="margin-top:24px"><h2>上架物品</h2><div id="m-listform">${skeleton(120)}</div></section>
    <section aria-label="武器商店" style="margin-top:24px"><h2>武器商店</h2><div id="m-shop" class="m-grid"></div></section>
    <section aria-label="我的武器庫" style="margin-top:24px"><h2>我的武器庫</h2><div id="m-inv">${skeleton(80)}</div></section>`;
  await loadMe();
  const [marketRes, wallet] = await Promise.allSettled([
    swr("world:market", "/world/market"),
    loadWallet(),
  ]);
  const listings = marketRes.status === "fulfilled"
    ? (marketRes.value.data?.listings || marketRes.value.data?.items || (Array.isArray(marketRes.value.data) ? marketRes.value.data : []))
    : null;
  renderMarket(listings);
  renderMine(listings || []);
  renderListForm();
  renderShop();
  renderInventory(wallet.status === "fulfilled" ? wallet.value.inventory : {});
  focusMain();
}

function renderMarket(listings) {
  const el = document.getElementById("m-market");
  if (listings === null) {
    el.innerHTML = `<div class="state-error"><p>市集讀取失敗</p>
      <button class="btn btn-primary" id="m-retry">重試</button></div>`;
    document.getElementById("m-retry").onclick = renderAll;
    return;
  }
  if (!listings.length) {
    el.innerHTML = `<div class="state-empty">
      <img src="../assets/img/empty-neon.webp?v=3.0.0" alt="空市集插圖">
      <p>市集目前沒有上架物品</p></div>`;
    return;
  }
  el.innerHTML = `<div class="m-grid">` + listings.map(l => {
    const lid = listingId(l);
    const mine = isMine(l);
    const name = l.item_name || l.name || l.title || `${l.item_type || ""} ${l.item_id || ""}`.trim() || "未命名物品";
    const price = l.price ?? 0;
    const seller = l.seller || l.seller_name || "—";
    const kind = l.trade_kind === "barter" ? `以物易物：${escapeHtml(l.want_text || "詳談")}` : `✦ ${fmt(price)}`;
    return `<div class="card m-item">
      <h3>${escapeHtml(name)}</h3>
      <p class="m-seller">賣家 ${escapeHtml(seller)}${mine ? "（我）" : ""}</p>
      <p class="m-price">${kind}</p>
      ${mine
        ? `<button class="btn btn-ghost" data-delist="${escapeHtml(lid)}">下架</button>`
        : `<button class="btn btn-primary" data-buy="${escapeHtml(lid)}" data-price="${price}">購買</button>`}
    </div>`;
  }).join("") + `</div>`;
  el.querySelectorAll("[data-buy]").forEach(b => b.onclick = () => buyListing(b.dataset.buy, +b.dataset.price, b));
  el.querySelectorAll("[data-delist]").forEach(b => b.onclick = () => delist(b.dataset.delist, b));
}

function renderMine(listings) {
  const el = document.getElementById("m-mine");
  const mine = listings.filter(isMine);
  if (!mine.length) {
    el.innerHTML = `<div class="state-empty"><p>你還沒有上架任何物品</p></div>`;
    return;
  }
  el.innerHTML = mine.map(l => {
    const lid = listingId(l);
    const name = l.item_name || l.name || l.title || `${l.item_type || ""} ${l.item_id || ""}`.trim();
    return `<div class="card m-item">
      <h3>${escapeHtml(name)}</h3>
      <p class="m-price">✦ ${fmt(l.price ?? 0)}</p>
      <button class="btn btn-ghost" data-delist="${escapeHtml(lid)}">下架</button>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-delist]").forEach(b => b.onclick = () => delist(b.dataset.delist, b));
}

/* ---- 購買 / 下架 ---- */
async function buyListing(lid, price, btn) {
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "購買中…";
  try {
    await post(`/world/market/${encodeURIComponent(lid)}/buy`, {});
    toast(`購買成功！✦ -${fmt(price)}`);
    await refreshAll();
  } catch (e) {
    btn.disabled = false; btn.textContent = original;
    toast(`購買失敗：${e.message}`);
  }
}

async function delist(lid, btn) {
  btn.disabled = true;
  try {
    await del(`/world/market/${encodeURIComponent(lid)}`);
    toast("已下架");
    await refreshAll();
  } catch (e) {
    toast(`下架失敗：${e.message}`);
    btn.disabled = false;
  }
}

async function refreshAll() {
  await renderAll();
}

/* ---- 上架表單：從我的徽章選可上架物品 ---- */
async function renderListForm() {
  const el = document.getElementById("m-listform");
  let badges = [];
  try {
    const r = await get("/learn/badges");
    badges = r?.badges || (Array.isArray(r) ? r : []);
  } catch (e) {
    el.innerHTML = `<div class="state-error"><p>讀取可上架物品失敗：${escapeHtml(e.message)}</p></div>`;
    return;
  }
  if (!badges.length) {
    el.innerHTML = `<div class="state-empty">
      <p>還沒有可上架的技能章。去<a href="quiz.html">費曼戰役</a>授勳，拿到技能章就能上架販售！</p></div>`;
    return;
  }
  el.innerHTML = `<div class="card">
    <label>選擇物品
      <select id="m-lf-item" aria-label="選擇上架物品" style="width:100%;padding:10px;margin-top:4px">
        ${badges.map(b => {
          const bid = b.id || b.badge_id || b.name;
          const bname = b.name || b.badge_name || bid;
          return `<option value="${escapeHtml(bid)}" data-type="${escapeHtml(b.item_type || "badge")}">${escapeHtml(bname)}</option>`;
        }).join("")}
      </select></label>
    <label style="display:block;margin-top:12px">定價（星砂）
      <input id="m-lf-price" type="number" min="0" value="10" aria-label="定價星砂"
        style="width:100%;padding:10px;margin-top:4px"></label>
    <button class="btn btn-primary" id="m-lf-go" style="width:100%;margin-top:12px">上架</button>
  </div>`;
  document.getElementById("m-lf-go").onclick = async () => {
    const sel = document.getElementById("m-lf-item");
    const itemId = sel.value;
    const itemType = sel.selectedOptions[0]?.dataset.type || "badge";
    const price = Math.max(0, parseInt(document.getElementById("m-lf-price").value, 10) || 0);
    const btn = document.getElementById("m-lf-go");
    btn.disabled = true;
    try {
      await post("/world/market", { item_type: itemType, item_id: itemId, price });
      toast("上架成功！");
      await refreshAll();
    } catch (e) {
      toast(`上架失敗：${e.message}`);
      btn.disabled = false;
    }
  };
}

/* ---- 武器商店 ---- */
function renderShop() {
  const el = document.getElementById("m-shop");
  el.innerHTML = SHOP_ITEMS.map(w => `<div class="card m-item">
    <h3>${escapeHtml(w.name)}</h3>
    <p class="m-seller">${escapeHtml(w.desc)}</p>
    <p class="m-price">✦ ${fmt(w.price)}</p>
    <button class="btn btn-primary" data-shop="${w.id}" data-price="${w.price}">購買</button>
  </div>`).join("");
  el.querySelectorAll("[data-shop]").forEach(b =>
    b.onclick = () => buyWeapon(b.dataset.shop, b));
}

async function buyWeapon(itemId, btn) {
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "購買中…";
  try {
    const r = await post("/game/shop/buy", { item_id: itemId });
    toast(`獲得「${r.name || itemId}」！`);
    await refreshAll();
  } catch (e) {
    btn.disabled = false; btn.textContent = original;
    toast(`購買失敗：${e.message}`);
  }
}

/* ---- 武器庫：可使用 ---- */
function renderInventory(inventory) {
  const el = document.getElementById("m-inv");
  const entries = Object.entries(inventory).filter(([, n]) => n > 0);
  if (!entries.length) {
    el.innerHTML = `<div class="state-empty"><p>武器庫是空的，去商店買幾件防身吧！</p></div>`;
    return;
  }
  const names = Object.fromEntries(SHOP_ITEMS.map(w => [w.id, w.name]));
  el.innerHTML = entries.map(([id, n]) => `<div class="card m-item">
    <h3>${escapeHtml(names[id] || id)}</h3>
    <p class="m-seller">數量 × ${n}</p>
    <button class="btn btn-ghost" data-use="${escapeHtml(id)}">使用一個</button>
  </div>`).join("");
  el.querySelectorAll("[data-use]").forEach(b =>
    b.onclick = () => useWeapon(b.dataset.use, b));
}

async function useWeapon(itemId, btn) {
  btn.disabled = true;
  try {
    const r = await post("/game/use", { item_id: itemId });
    toast("已使用一個武器");
    const inv = r.inventory || {};
    renderInventory(inv);
    await loadWallet();
  } catch (e) {
    toast(`使用失敗：${e.message}`);
    btn.disabled = false;
  }
}

/* ---- 啟動 ---- */
(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty"><p>請先登入再逛市集</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    walletEl.textContent = "未登入";
    return;
  }
  view.innerHTML = skeleton(200);
  try {
    await renderAll();
  } catch (e) {
    view.innerHTML = `<div class="state-error">
      <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
      <p>市集讀取失敗：${escapeHtml(e.message)}</p>
      <button class="btn btn-primary" id="m-retry">重試</button></div>`;
    document.getElementById("m-retry").onclick = () => init();
  }
})();
