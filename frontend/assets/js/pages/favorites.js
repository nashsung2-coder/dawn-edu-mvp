/* 藏書閣：我的收藏 + 瀏覽知識湖。全調真實後端，零假數據。
 * 生命週期：init → 未登入檢查 → loading(skeleton) → api → render/empty/error
 */
import { swr, post, get, del } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("f-view");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function skeleton(h = 120) {
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

/* 後端 GET /favorites 回傳 {ok, favorites: ["1"]}（content_id 字串陣列） */
function normalizeFavs(data) {
  const raw = data?.favorites ?? (Array.isArray(data) ? data : []);
  return new Set(raw.map(f => String(typeof f === "object" ? (f.content_id ?? f.id ?? "") : f)).filter(Boolean));
}
function normalizeContents(data) {
  return data?.items || data?.contents || (Array.isArray(data) ? data : []);
}

let favIds = new Set();        // 已收藏的 content_id（字串）
let contentMap = new Map();    // content_id字串 → 內容物件

async function loadAll() {
  view.innerHTML = `<section aria-label="我的收藏"><h2>我的收藏</h2>${skeleton(80)}</section>
    <section aria-label="瀏覽知識湖" style="margin-top:24px"><h2>瀏覽知識湖</h2>${skeleton()}</section>`;
  try {
    const [favRes, conRes] = await Promise.all([
      swr("favorites:list", "/favorites"),
      swr("contents:list", "/contents"),
    ]);
    favIds = normalizeFavs(favRes.data);
    const items = normalizeContents(conRes.data);
    contentMap = new Map(items.map(it => [String(it.id ?? it.content_id), it]));
    renderAll();
  } catch (e) {
    view.innerHTML = `<div class="state-error">
      <img src="../assets/img/empty-error.webp?v=3.0.0" alt="燈籠插圖">
      <p>讀取失敗：${escapeHtml(e.message)}（${escapeHtml(e.code || "未知")}）</p>
      <button class="btn btn-primary" id="f-retry">重試</button></div>`;
    document.getElementById("f-retry").onclick = loadAll;
  }
}

function renderAll() {
  view.innerHTML = `
    <section aria-label="我的收藏">
      <h2>我的收藏 <span class="f-count">（${favIds.size}）</span></h2>
      <div id="f-mine" class="f-list"></div>
    </section>
    <section aria-label="瀏覽知識湖" style="margin-top:24px">
      <h2>瀏覽知識湖</h2>
      <div class="f-search">
        <input id="f-q" type="search" placeholder="搜尋知識湖…" aria-label="搜尋知識湖">
        <button class="btn btn-primary" id="f-go">搜尋</button>
      </div>
      <div class="f-tags" id="f-tags" role="group" aria-label="標籤篩選"></div>
      <div id="f-list" class="f-list"></div>
    </section>`;
  renderMine();
  renderTags();
  renderContents();
  document.getElementById("f-go").onclick = () =>
    renderContents(document.getElementById("f-q").value.trim());
  document.getElementById("f-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") renderContents(e.target.value.trim());
  });
}

/* ---- 我的收藏區：每項有取消收藏按鈕 ---- */
function renderMine() {
  const el = document.getElementById("f-mine");
  if (!favIds.size) {
    el.innerHTML = `<div class="state-empty">
      <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
      <p>還沒有收藏。去知識湖逛逛，把喜歡的內容收進來吧！</p></div>`;
    return;
  }
  el.innerHTML = [...favIds].map(cid => {
    const it = contentMap.get(cid);
    const title = it?.title || `內容 #${escapeHtml(cid)}`;
    const summary = it?.summary || it?.content || "";
    return `<div class="card f-item">
      <h3>${escapeHtml(title)}</h3>
      ${summary ? `<p>${escapeHtml(summary.slice(0, 120))}</p>` : ""}
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        ${it?.url ? `<a class="btn btn-ghost" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">閱讀原文</a>` : ""}
        <button class="btn btn-ghost" data-unfav="${escapeHtml(cid)}">取消收藏</button>
      </div>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-unfav]").forEach(btn => {
    btn.onclick = () => unfavorite(btn.dataset.unfav, btn);
  });
}

async function unfavorite(contentId, btn) {
  btn.disabled = true;
  try {
    await del(`/favorites/${encodeURIComponent(contentId)}`);
    favIds.delete(contentId);
    toast("已取消收藏");
    renderMine();
    // 同步瀏覽區的按鈕狀態
    const browseBtn = view.querySelector(`[data-fav="${CSS.escape(contentId)}"]`);
    if (browseBtn) setFavBtn(browseBtn, false);
    updateCount();
  } catch (e) {
    toast(`取消收藏失敗：${e.message}`);
    btn.disabled = false;
  }
}

function updateCount() {
  const c = view.querySelector(".f-count");
  if (c) c.textContent = `（${favIds.size}）`;
}

/* ---- 瀏覽區：搜尋 + 標籤 + 收藏切換 ---- */
async function renderTags() {
  const el = document.getElementById("f-tags");
  try {
    const t = await swr("tags", "/tags");
    const tags = t.data?.tags || (Array.isArray(t.data) ? t.data : []);
    el.innerHTML = tags.slice(0, 12).map(tag => {
      const name = tag.name || tag;
      return `<button class="f-tag" aria-pressed="false" data-tag="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
    }).join("");
    el.querySelectorAll(".f-tag").forEach(b => {
      b.onclick = () => {
        el.querySelectorAll(".f-tag").forEach(x => x.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        renderContents("", b.dataset.tag);
      };
    });
  } catch { /* 標籤失敗不擋內容 */ }
}

async function renderContents(keyword = "", tag = "") {
  const listEl = document.getElementById("f-list");
  listEl.innerHTML = skeleton();
  announce("載入內容中");
  try {
    const params = new URLSearchParams();
    if (tag) params.set("tag", tag);
    if (keyword) params.set("q", keyword);
    const qs = params.toString() ? `?${params}` : "";
    // 搜尋參數每次不同，不走 SWR
    const data = await get(`/contents${qs}`);
    const items = normalizeContents(data);
    contentMap = new Map(items.map(it => [String(it.id ?? it.content_id), it]));
    const shown = keyword
      ? items.filter(it => (it.title || "").includes(keyword) || (it.summary || "").includes(keyword))
      : items;
    if (!shown.length) {
      listEl.innerHTML = `<div class="state-empty">
        <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
        <p>沒有找到相關內容</p></div>`;
      return;
    }
    listEl.innerHTML = shown.map(it => {
      const id = String(it.id ?? it.content_id ?? "");
      const faved = favIds.has(id);
      const meta = [it.source_type, it.duration_min ? `${it.duration_min} 分鐘` : ""].filter(Boolean).join(" · ");
      return `<div class="card f-item">
        <h3>${escapeHtml(it.title || "未命名")}</h3>
        ${meta ? `<p class="f-meta">${escapeHtml(meta)}</p>` : ""}
        <p>${escapeHtml((it.summary || it.content || "").slice(0, 120))}</p>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ${faved ? "btn-ghost" : "btn-primary"}" data-fav="${escapeHtml(id)}"
            aria-pressed="${faved}">${faved ? "★ 已收藏" : "☆ 收藏"}</button>
          ${it.url ? `<a class="btn btn-ghost" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">閱讀原文</a>` : ""}
        </div>
      </div>`;
    }).join("");
    listEl.querySelectorAll("[data-fav]").forEach(btn => {
      btn.onclick = () => toggleFav(btn.dataset.fav, btn);
    });
  } catch (e) {
    listEl.innerHTML = `<div class="state-error"><p>讀取失敗：${escapeHtml(e.message)}</p>
      <button class="btn btn-primary" id="f-list-retry">重試</button></div>`;
    document.getElementById("f-list-retry").onclick = () => renderContents(keyword, tag);
  }
}

function setFavBtn(btn, faved) {
  btn.setAttribute("aria-pressed", String(faved));
  btn.textContent = faved ? "★ 已收藏" : "☆ 收藏";
  btn.className = `btn ${faved ? "btn-ghost" : "btn-primary"}`;
}

async function toggleFav(contentId, btn) {
  const isFav = favIds.has(contentId);
  btn.disabled = true;
  try {
    if (isFav) {
      await del(`/favorites/${encodeURIComponent(contentId)}`);
      favIds.delete(contentId);
      toast("已取消收藏");
    } else {
      await post("/favorites", { content_id: contentId });
      favIds.add(contentId);
      toast("已收藏");
    }
    setFavBtn(btn, favIds.has(contentId));
    renderMine();
    updateCount();
  } catch (e) {
    toast(`操作失敗：${e.message}`);
  }
  btn.disabled = false;
}

/* ---- 啟動 ---- */
(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再使用藏書閣</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  await loadAll();
  focusMain();
})();
