/* 星海市集：動物森友會商店風
 * 市集街道橫幅＋大字星砂 → 商品卡片（樂觀購買）→ 我的上架 → 武器圖鑑 → 上架表單
 * v4.0：直讀 Supabase（shop_items 商品、inventory 背包、profiles 星砂），
 * 購買經 transfer_starsand 原子扣款＋記帳，不再經 Render 後端。
 * 生命週期：init → 未登入檢查 → loading(skeleton) → api → render/empty/error
 */
import { supabase, getUser } from "../core/supabase.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("m-view");
const walletEl = document.getElementById("m-wallet");
const IMG = "../assets/img/game";

/* 商店品項：從 Supabase shop_items 即時取得 */
let SHOP_ITEMS = [];
const TYPE_ICONS = { weapon: "🗡️", food: "🍪", decoration: "🏠" };

async function loadShopItems() {
  try {
    const { data, error } = await supabase.from("shop_items")
      .select("id, name, description, price, type").order("price", { ascending: true });
    if (error) throw error;
    if (data?.length) {
      SHOP_ITEMS = data.map(w => ({
        id: w.id, name: w.name, desc: w.description,
        price: w.price ?? 0, icon: TYPE_ICONS[w.type] || "🎁", type: w.type,
      }));
      return;
    }
  } catch (e) { console.warn("[market] shop_items failed:", e.message); }
  // 取不到時的保底
  console.warn("[market] 無法從 Supabase 取得商店目錄，使用保底價格");
  SHOP_ITEMS = [
    { id: "dart", name: "星塵飛鏢", desc: "迅捷的單體攻擊", price: 20, icon: "🗡️" },
    { id: "wave", name: "潮汐巨浪", desc: "範圍傷害", price: 50, icon: "🌊" },
    { id: "shield", name: "曙光護盾", desc: "抵擋一次傷害", price: 30, icon: "🛡️" },
  ];
}

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
    const { data: profile, error } = await supabase.from("profiles")
      .select("points").eq("id", myId).single();
    if (error) throw error;
    walletPts = profile?.points ?? 0;
    renderBanner();
    return { points: walletPts, inventory: await loadInventoryRows() };
  } catch (e) {
    console.warn("[market] wallet failed:", e.message);
    walletEl.textContent = "錢包讀取失敗";
    return { points: 0, inventory: [] };
  }
}
async function loadInventoryRows() {
  try {
    const { data, error } = await supabase.from("inventory")
      .select("quantity, shop_items(id, name, description, type)")
      .eq("user_id", myId);
    if (error) throw error;
    return (data || []).filter(r => (r.quantity || 0) > 0).map(r => ({
      id: r.shop_items?.id, name: r.shop_items?.name || "未知物品",
      desc: r.shop_items?.description || "", type: r.shop_items?.type,
      qty: r.quantity,
    }));
  } catch (e) {
    console.warn("[market] inventory failed:", e.message);
    return [];
  }
}
function renderBanner() {
  walletEl.innerHTML = `<div class="m-banner">
    <img src="${IMG}/market-street.webp?v=3.0.0" alt="星際市集街道" loading="lazy">
    <div class="m-banner-wallet">
      <span class="m-label">我的星砂</span>
      <span class="m-coins">${fmt(walletPts)} 星砂</span>
    </div>
  </div>`;
}
async function loadMe() {
  try {
    const user = await getUser();
    if (!user) return;
    myId = user.id;
    const { data: profile } = await supabase.from("profiles").select("name").eq("id", user.id).single();
    myName = profile?.name || "";
  } catch { /* 匿名 */ }
}

/* ---- 主渲染 ---- */
const MARKET_CATS = ["全部", "weapon", "food", "decoration"];
const CAT_LABEL = { "全部": "全部", "weapon": "武器", "food": "食物", "decoration": "裝飾" };
let marketCat = "全部";

async function renderAll() {
  view.innerHTML = `
    <section aria-label="商店">
      <div class="m-sec-title"><h2>商店</h2><span class="m-count" id="m-count-market"></span></div>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap" role="group" aria-label="分類篩選">
        ${MARKET_CATS.map(c => `<button class="btn ${c === marketCat ? "btn-primary" : "btn-ghost"} m-cat" data-cat="${c}" style="font-size:13px;padding:6px 14px">${CAT_LABEL[c]}</button>`).join("")}
      </div>
      <div id="m-market">${skeleton()}</div>
    </section>
    <section aria-label="旅人市集">
      <div class="m-sec-title"><h2>旅人市集</h2><span class="m-count">即將開放</span></div>
      <div id="m-p2p"></div>
    </section>
    <section aria-label="我的背包">
      <div class="m-sec-title"><h2>我的背包</h2></div>
      <div id="m-inv">${skeleton(80)}</div>
    </section>`;
  await loadMe();
  const wallet = await loadWallet().catch(() => ({ points: 0, inventory: [] }));
  renderMarket();
  renderP2P();
  renderInventory(wallet.inventory);
  view.querySelectorAll(".m-cat").forEach(btn => {
    btn.onclick = () => { marketCat = btn.dataset.cat; renderAll(); };
  });
  focusMain();
}

/* ---- 商店：購買（原子扣款＋入庫） ---- */
function renderMarket() {
  const el = document.getElementById("m-market");
  const cnt = document.getElementById("m-count-market");
  let items = SHOP_ITEMS;
  if (marketCat !== "全部") items = items.filter(w => (w.type || "") === marketCat);
  cnt.textContent = `${items.length} 件`;
  if (!items.length) {
    el.innerHTML = `<div class="state-empty">
      <img src="../assets/img/empty-neon.webp?v=3.0.0" alt="空市集插圖">
      <p>這個分類還沒有商品</p></div>`;
    return;
  }
  el.innerHTML = `<div class="m-cards">` + items.map(w => `
    <div class="m-card" data-card="${escapeHtml(String(w.id))}">
      <div class="m-icon" aria-hidden="true">${w.icon}</div>
      <span class="m-tag">${escapeHtml(CAT_LABEL[w.type] || "商品")}</span>
      <h3>${escapeHtml(w.name)}</h3>
      <p class="m-desc">${escapeHtml(w.desc || "")}</p>
      <p class="m-price">✦ ${fmt(w.price)}</p>
      <button class="btn btn-primary" data-shop="${escapeHtml(String(w.id))}">購買</button>
    </div>`).join("") + `</div>`;
  el.querySelectorAll("[data-shop]").forEach(b =>
    b.onclick = () => buyWeapon(b.dataset.shop, b));
}

async function buyWeapon(itemId, btn) {
  const item = SHOP_ITEMS.find(w => String(w.id) === String(itemId));
  const price = item?.price ?? 0;
  const card = btn.closest(".m-card");
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = "購買中…";
  try {
    // 原子扣款＋記帳（餘額不足時 RPC 會報錯）
    const { error: payErr } = await supabase.rpc("transfer_starsand", {
      p_user_id: myId, p_amount: -price, p_reason: `購買：${item?.name || itemId}`,
    });
    if (payErr) throw new Error(payErr.message.includes("餘額不足") ? `星砂不足（需要 ${fmt(price)} 星砂）` : payErr.message);
    // 入庫（upsert）
    const { data: existing } = await supabase.from("inventory")
      .select("id, quantity").eq("user_id", myId).eq("item_id", itemId).maybeSingle();
    if (existing) {
      const { error } = await supabase.from("inventory")
        .update({ quantity: (existing.quantity || 0) + 1 }).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("inventory")
        .insert({ user_id: myId, item_id: itemId, quantity: 1 });
      if (error) throw error;
    }
    if (card) card.classList.add("bought", "m-bounce");
    toast(`獲得「${item?.name || itemId}」！✦ -${fmt(price)}`);
    announce(`購買成功：${item?.name || itemId}`);
    await renderAll();
  } catch (e) {
    btn.disabled = false; btn.textContent = oldLabel;
    if (card) card.classList.remove("bought", "m-bounce");
    toast(`購買失敗：${e.message}`);
  }
}

/* ---- 旅人市集（P2P）：尚無對應表，顯示即將開放 ---- */
function renderP2P() {
  document.getElementById("m-p2p").innerHTML = `<div class="state-empty">
    <p>旅人間的交易市集即將開放，敬請期待！</p></div>`;
}

/* ---- 背包 ---- */
function renderInventory(items) {
  const el = document.getElementById("m-inv");
  if (!items.length) {
    el.innerHTML = `<div class="state-empty"><p>背包是空的，去商店買幾件防身吧！</p></div>`;
    return;
  }
  el.innerHTML = `<div class="m-cards">` + items.map(it => `
    <div class="m-card">
      <div class="m-icon" aria-hidden="true">${TYPE_ICONS[it.type] || "🎁"}</div>
      <h3>${escapeHtml(it.name)}</h3>
      <p class="m-seller">數量 × ${it.qty}</p>
      ${it.desc ? `<p class="m-desc">${escapeHtml(it.desc)}</p>` : ""}
      <button class="btn btn-ghost" data-use="${escapeHtml(String(it.id))}">使用一個</button>
    </div>`).join("") + `</div>`;
  el.querySelectorAll("[data-use]").forEach(b =>
    b.onclick = () => useWeapon(b.dataset.use, b));
}

async function useWeapon(itemId, btn) {
  btn.disabled = true; btn.textContent = "使用中…";
  try {
    const { data: existing } = await supabase.from("inventory")
      .select("id, quantity").eq("user_id", myId).eq("item_id", itemId).maybeSingle();
    if (!existing || (existing.quantity || 0) <= 0) throw new Error("背包裡沒有這個物品");
    if (existing.quantity <= 1) {
      const { error } = await supabase.from("inventory").delete().eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("inventory")
        .update({ quantity: existing.quantity - 1 }).eq("id", existing.id);
      if (error) throw error;
    }
    toast("已使用一個物品");
    await renderAll();
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
    await loadShopItems();
    await renderAll();
  } catch (e) {
    view.innerHTML = `<div class="state-error">
      <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
      <p>市集讀取失敗：${escapeHtml(e.message)}</p>
      <button class="btn btn-primary" id="m-retry">重試</button></div>`;
    document.getElementById("m-retry").onclick = () => location.reload();
  }
})();
