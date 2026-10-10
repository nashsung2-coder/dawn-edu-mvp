/* 星海市集：動物森友會商店風
 * 市集街道橫幅＋大字星砂 → 商品卡片（樂觀購買）→ 我的上架 → 武器圖鑑 → 上架表單
 * 全調真實後端，零假數據。
 * 生命週期：init → 未登入檢查 → loading(skeleton) → api → render/empty/error
 */
import { swr, post, get, del } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("m-view");
const walletEl = document.getElementById("m-wallet");
const IMG = "../assets/img/game";

/* 武器商店品項：id / 名稱 / 價格（2026-10-10 實測後端價格）/ 效果 */
const SHOP_ITEMS = [
  { id: "dart",   name: "星塵飛鏢", desc: "迅捷的單體攻擊，對決中先手加成", price: 20, icon: "🗡️" },
  { id: "wave",   name: "潮汐巨浪", desc: "範圍傷害，適合據點攻防",       price: 20, icon: "🌊" },
  { id: "shield", name: "曙光護盾", desc: "抵擋一次傷害，關鍵時刻保命",   price: 30, icon: "🛡️" },
];

/* 注入商店風樣式（只用裸名 token） */
function ensureStyle() {
  if (document.getElementById("m-shop-style")) return;
  const st = document.createElement("style");
  st.id = "m-shop-style";
  st.textContent = `
.m-banner{position:relative;border-radius:var(--r-lg);overflow:hidden;margin-bottom:var(--sp-6);border:1px solid var(--line)}
.m-banner img{width:100%;height:180px;object-fit:cover;display:block}
.m-banner-wallet{position:absolute;left:0;right:0;bottom:0;padding:var(--sp-5);background:linear-gradient(transparent,rgba(0,0,0,.7));color:#fff;display:flex;align-items:baseline;justify-content:space-between}
.m-banner-wallet .m-coins{font-size:var(--fs-32);font-weight:800;font-variant-numeric:tabular-nums}
.m-banner-wallet .m-label{font-size:var(--fs-13);opacity:.85}
.m-sec-title{display:flex;align-items:center;gap:var(--sp-2);margin:var(--sp-8) 0 var(--sp-4)}
.m-sec-title h2{font-size:var(--fs-20)}
.m-sec-title .m-count{font-size:var(--fs-12);color:var(--muted);background:var(--bg-soft);border-radius:var(--r-full);padding:2px 10px}
.m-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:var(--sp-4)}
.m-card{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--card);padding:var(--sp-5);text-align:center;transition:transform .2s var(--ease),box-shadow .2s var(--ease)}
.m-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.12)}
.m-card .m-icon{font-size:var(--fs-32)}
.m-card h3{font-size:var(--fs-16);margin:var(--sp-2) 0}
.m-card .m-desc{font-size:var(--fs-12);color:var(--muted);min-height:2.4em;margin-bottom:var(--sp-2)}
.m-card .m-price{color:var(--accent);font-weight:800;font-size:var(--fs-22);font-variant-numeric:tabular-nums;margin-bottom:var(--sp-3)}
.m-card .btn{width:100%}
.m-card .btn:disabled{opacity:.55;cursor:wait}
.m-card.bought{border-color:var(--accent);background:var(--bg-soft)}
.m-seller{font-size:var(--fs-12);color:var(--muted);margin-bottom:var(--sp-2)}
.m-tag{display:inline-block;font-size:var(--fs-11);border:1px solid var(--line);border-radius:var(--r-full);padding:2px 8px;margin-bottom:var(--sp-2);color:var(--muted)}
.m-form{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);padding:var(--sp-6)}
.m-form label{display:block;margin-bottom:var(--sp-4);font-size:var(--fs-14);font-weight:700}
.m-form select,.m-form input{width:100%;padding:12px;margin-top:6px;border:1px solid var(--line);border-radius:var(--r-md);font-size:var(--fs-14);background:var(--bg)}
@keyframes m-bounce{0%{transform:scale(.9)}50%{transform:scale(1.05)}100%{transform:scale(1)}}
.m-bounce{animation:m-bounce .35s var(--ease)}}`;
  document.head.appendChild(st);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function skeleton(h = 160) {
  return `<div class="skeleton" style="height:${h}px;border-radius:var(--r-lg)"></div>
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
let walletPts = 0;
async function loadWallet() {
  try {
    const r = await swr("game:state", "/game/state");
    const d = r.data || {};
    walletPts = d.points ?? d.stardust ?? 0;
    renderBanner();
    return { points: walletPts, inventory: d.inventory || {} };
  } catch {
    walletEl.textContent = "錢包讀取失敗";
    return { points: 0, inventory: {} };
  }
}
function renderBanner() {
  walletEl.innerHTML = `<div class="m-banner">
    <img src="${IMG}/market-street.webp?v=3.0.0" alt="星際市集街道" loading="lazy">
    <div class="m-banner-wallet">
      <span class="m-label">🪙 我的星砂</span>
      <span class="m-coins">✦ ${fmt(walletPts)}</span>
    </div>
  </div>`;
}
async function loadMe() {
  try {
    const r = await swr("auth:me", "/auth/me");
    const d = r.data?.user || r.data?.data || r.data || {};
    myName = d.name || ""; myId = String(d.id || "");
  } catch { /* 匿名 */ }
}
function isMine(listing) {
  const seller = listing.seller || listing.seller_name || listing.owner || "";
  const sid = String(listing.seller_id || listing.owner_id || "");
  return (myName && seller === myName) || (myId && sid === myId);
}
function listingId(l) { return l.lid || l.id; }
function listingName(l) {
  return l.item_name || l.name || l.title || `${l.item_type || ""} ${l.item_id || ""}`.trim() || "未命名物品";
}

/* ---- 主渲染 ---- */
async function renderAll() {
  view.innerHTML = `
    <section aria-label="市集列表">
      <div class="m-sec-title"><h2>🏪 市集攤位</h2><span class="m-count" id="m-count-market"></span></div>
      <div id="m-market">${skeleton()}</div>
    </section>
    <section aria-label="我的上架">
      <div class="m-sec-title"><h2>📦 我的上架</h2><span class="m-count" id="m-count-mine"></span></div>
      <div id="m-mine">${skeleton(80)}</div>
    </section>
    <section aria-label="上架物品">
      <div class="m-sec-title"><h2>🛒 上架物品</h2></div>
      <div id="m-listform">${skeleton(120)}</div>
    </section>
    <section aria-label="武器商店">
      <div class="m-sec-title"><h2>⚔️ 武器商店</h2><span class="m-count">常駐</span></div>
      <div id="m-shop" class="m-cards"></div>
    </section>
    <section aria-label="我的武器庫">
      <div class="m-sec-title"><h2>🎒 我的武器庫</h2></div>
      <div id="m-inv">${skeleton(80)}</div>
    </section>`;
  await loadMe();
  const [marketRes, wallet] = await Promise.allSettled([
    swr("world:market", "/world/market"),
    loadWallet(),
  ]);
  const d = marketRes.status === "fulfilled" ? (marketRes.value.data || {}) : null;
  const listings = d === null ? null
    : (d.listings || d.items || (Array.isArray(d) ? d : []));
  renderMarket(listings);
  renderMine(listings || []);
  renderListForm();
  renderShop();
  renderInventory(wallet.status === "fulfilled" ? wallet.value.inventory : {});
  focusMain();
}

/* ---- 市集攤位：樂觀購買 ---- */
function renderMarket(listings) {
  const el = document.getElementById("m-market");
  const cnt = document.getElementById("m-count-market");
  if (listings === null) {
    el.innerHTML = `<div class="state-error"><p>市集讀取失敗</p>
      <button class="btn btn-primary" id="m-retry">重試</button></div>`;
    document.getElementById("m-retry").onclick = renderAll;
    return;
  }
  const others = listings.filter(l => !isMine(l));
  cnt.textContent = `${others.length} 件`;
  if (!others.length) {
    el.innerHTML = `<div class="state-empty">
      <img src="../assets/img/empty-neon.webp?v=3.0.0" alt="空市集插圖">
      <p>市集目前沒有其他旅人的上架物品</p></div>`;
    return;
  }
  el.innerHTML = `<div class="m-cards">` + others.map(l => {
    const lid = listingId(l);
    const price = l.price ?? 0;
    const seller = l.seller || l.seller_name || "—";
    const kind = l.trade_kind === "barter" ? `以物易物：${escapeHtml(l.want_text || "詳談")}` : "";
    return `<div class="m-card" data-card="${escapeHtml(String(lid))}">
      <div class="m-icon" aria-hidden="true">🏷️</div>
      <h3>${escapeHtml(listingName(l))}</h3>
      <p class="m-seller">賣家 ${escapeHtml(seller)}</p>
      ${kind ? `<p class="m-desc">${kind}</p>` : ""}
      <p class="m-price">✦ ${fmt(price)}</p>
      <button class="btn btn-primary" data-buy="${escapeHtml(String(lid))}" data-price="${price}">購買</button>
    </div>`;
  }).join("") + `</div>`;
  el.querySelectorAll("[data-buy]").forEach(b => b.onclick = () => buyListing(b.dataset.buy, +b.dataset.price, b));
}

function renderMine(listings) {
  const el = document.getElementById("m-mine");
  const cnt = document.getElementById("m-count-mine");
  const mine = listings.filter(isMine);
  cnt.textContent = `${mine.length} 件`;
  if (!mine.length) {
    el.innerHTML = `<div class="state-empty"><p>你還沒有上架任何物品</p></div>`;
    return;
  }
  el.innerHTML = `<div class="m-cards">` + mine.map(l => {
    const lid = listingId(l);
    return `<div class="m-card" data-card="${escapeHtml(String(lid))}">
      <div class="m-icon" aria-hidden="true">📦</div>
      <h3>${escapeHtml(listingName(l))}</h3>
      <p class="m-price">✦ ${fmt(l.price ?? 0)}</p>
      <button class="btn btn-ghost" data-delist="${escapeHtml(String(lid))}">下架</button>
    </div>`;
  }).join("") + `</div>`;
  el.querySelectorAll("[data-delist]").forEach(b => b.onclick = () => delist(b.dataset.delist, b));
}

/* ---- 購買：樂觀更新，失敗回滾 ---- */
async function buyListing(lid, price, btn) {
  const card = btn.closest(".m-card");
  // 樂觀：立即標記已購買
  btn.disabled = true;
  btn.textContent = "✓ 已購買";
  if (card) card.classList.add("bought", "m-bounce");
  announce("購買中…");
  try {
    await post(`/world/market/${encodeURIComponent(lid)}/buy`, {});
    toast(`購買成功！✦ -${fmt(price)}`);
    await renderAll();
  } catch (e) {
    // 回滾
    btn.disabled = false; btn.textContent = "購買";
    if (card) card.classList.remove("bought", "m-bounce");
    toast(`購買失敗：${e.message}`);
  }
}

async function delist(lid, btn) {
  btn.disabled = true; btn.textContent = "下架中…";
  try {
    await del(`/world/market/${encodeURIComponent(lid)}`);
    toast("已下架");
    await renderAll();
  } catch (e) {
    toast(`下架失敗：${e.message}`);
    btn.disabled = false; btn.textContent = "下架";
  }
}

/* ---- 上架表單 ---- */
async function renderListForm() {
  const el = document.getElementById("m-listform");
  let badges = [];
  try {
    const r = await get("/learn/badges");
    const d = r || {};
    badges = d.badges || (Array.isArray(d) ? d : []);
  } catch (e) {
    el.innerHTML = `<div class="state-error"><p>讀取可上架物品失敗：${escapeHtml(e.message)}</p></div>`;
    return;
  }
  if (!badges.length) {
    el.innerHTML = `<div class="state-empty">
      <p>還沒有可上架的技能章。去<a href="quiz.html">費曼戰役</a>授勳，拿到技能章就能上架販售！</p></div>`;
    return;
  }
  el.innerHTML = `<div class="m-form">
    <label>選擇物品
      <select id="m-lf-item" aria-label="選擇上架物品">
        ${badges.map(b => {
          const bid = b.id || b.badge_id || b.name;
          const bname = b.name || b.badge_name || bid;
          return `<option value="${escapeHtml(String(bid))}" data-type="${escapeHtml(b.item_type || "badge")}">${escapeHtml(bname)}${b.rarity ? ` · ${escapeHtml(b.rarity)}` : ""}</option>`;
        }).join("")}
      </select></label>
    <label>定價（星砂）
      <input id="m-lf-price" type="number" min="0" value="10" aria-label="定價星砂"></label>
    <button class="btn btn-primary" id="m-lf-go" style="width:100%">上架販售</button>
  </div>`;
  document.getElementById("m-lf-go").onclick = async () => {
    const sel = document.getElementById("m-lf-item");
    const itemId = sel.value;
    const itemType = sel.selectedOptions[0]?.dataset.type || "badge";
    const price = Math.max(0, parseInt(document.getElementById("m-lf-price").value, 10) || 0);
    const btn = document.getElementById("m-lf-go");
    btn.disabled = true; btn.textContent = "上架中…";
    try {
      await post("/world/market", { item_type: itemType, item_id: itemId, price });
      toast("上架成功！");
      await renderAll();
    } catch (e) {
      toast(`上架失敗：${e.message}`);
      btn.disabled = false; btn.textContent = "上架販售";
    }
  };
}

/* ---- 武器商店：圖鑑卡片 ---- */
function renderShop() {
  const el = document.getElementById("m-shop");
  el.innerHTML = SHOP_ITEMS.map(w => `<div class="m-card">
    <div class="m-icon" aria-hidden="true">${w.icon}</div>
    <span class="m-tag">常駐商品</span>
    <h3>${escapeHtml(w.name)}</h3>
    <p class="m-desc">${escapeHtml(w.desc)}</p>
    <p class="m-price">✦ ${fmt(w.price)}</p>
    <button class="btn btn-primary" data-shop="${w.id}">購買</button>
  </div>`).join("");
  el.querySelectorAll("[data-shop]").forEach(b =>
    b.onclick = () => buyWeapon(b.dataset.shop, b));
}

async function buyWeapon(itemId, btn) {
  btn.disabled = true; btn.textContent = "購買中…";
  try {
    const r = await post("/game/shop/buy", { item_id: itemId });
    toast(`獲得「${r.name || itemId}」！`);
    await renderAll();
  } catch (e) {
    btn.disabled = false; btn.textContent = "購買";
    toast(`購買失敗：${e.message}`);
  }
}

/* ---- 武器庫 ---- */
function renderInventory(inventory) {
  const el = document.getElementById("m-inv");
  const entries = Object.entries(inventory).filter(([, n]) => n > 0);
  if (!entries.length) {
    el.innerHTML = `<div class="state-empty"><p>武器庫是空的，去商店買幾件防身吧！</p></div>`;
    return;
  }
  const meta = Object.fromEntries(SHOP_ITEMS.map(w => [w.id, w]));
  el.innerHTML = `<div class="m-cards">` + entries.map(([id, n]) => {
    const m = meta[id] || {};
    return `<div class="m-card">
      <div class="m-icon" aria-hidden="true">${m.icon || "🎒"}</div>
      <h3>${escapeHtml(m.name || id)}</h3>
      <p class="m-seller">數量 × ${n}</p>
      ${m.desc ? `<p class="m-desc">${escapeHtml(m.desc)}</p>` : ""}
      <button class="btn btn-ghost" data-use="${escapeHtml(id)}">使用一個</button>
    </div>`;
  }).join("") + `</div>`;
  el.querySelectorAll("[data-use]").forEach(b =>
    b.onclick = () => useWeapon(b.dataset.use, b));
}

async function useWeapon(itemId, btn) {
  btn.disabled = true; btn.textContent = "使用中…";
  try {
    const r = await post("/game/use", { item_id: itemId });
    toast("已使用一個武器");
    const inv = r.inventory || {};
    renderInventory(inv);
    await loadWallet();
  } catch (e) {
    toast(`使用失敗：${e.message}`);
    btn.disabled = false; btn.textContent = "使用一個";
  }
}

/* ---- 啟動 ---- */
(async function init() {
  ensureStyle();
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
