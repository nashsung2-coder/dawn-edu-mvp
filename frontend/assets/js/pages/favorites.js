/* 藏書閣：知識湖內容 + 收藏 + 標籤搜尋。全調真實後端。 */
import { swr, post, del } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce } from "../core/a11y.js";

const view = document.getElementById("f-view");

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

let favIds = new Set();

async function loadFavs() {
  try {
    const r = await swr("favorites:list", "/favorites");
    const list = r.data?.favorites || (Array.isArray(r.data) ? r.data : []);
    favIds = new Set(list.map(f => f.content_id || f.id));
  } catch { /* 未登入或失敗就空集合 */ }
}

async function toggleFav(contentId, btn) {
  const isFav = favIds.has(contentId);
  btn.disabled = true;
  try {
    if (isFav) {
      await del(`/favorites/${contentId}`);
      favIds.delete(contentId);
      toast("已取消收藏");
    } else {
      await post("/favorites", { content_id: contentId });
      favIds.add(contentId);
      toast("已收藏");
    }
    btn.textContent = favIds.has(contentId) ? "★ 已收藏" : "☆ 收藏";
    btn.setAttribute("aria-pressed", String(favIds.has(contentId)));
  } catch (e) {
    toast(`操作失敗：${e.message}`);
  }
  btn.disabled = false;
}

async function renderContents(tag = "") {
  const listEl = document.getElementById("f-list");
  listEl.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
  try {
    const q = tag ? `?tag=${encodeURIComponent(tag)}` : "";
    // contents 不走 SWR 快取太久，用直接 GET（每次搜尋都是新的）
    const { get } = await import("../core/api.js");
    const data = await get(`/contents${q}`);
    const items = data?.items || data?.contents || (Array.isArray(data) ? data : []);
    if (!items.length) {
      listEl.innerHTML = `<div class="state-empty">
        <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空插圖">
        <p>沒有找到相關內容</p></div>`;
      return;
    }
    listEl.innerHTML = items.map(it => {
      const id = it.id || it.content_id;
      const faved = favIds.has(id);
      return `<div class="card f-item">
        <h3>${escapeHtml(it.title || "未命名")}</h3>
        <p>${escapeHtml((it.summary || it.content || "").slice(0, 120))}</p>
        <button class="btn btn-ghost" data-fav="${escapeHtml(id)}"
          aria-pressed="${faved}" style="margin-top:8px">${faved ? "★ 已收藏" : "☆ 收藏"}</button>
      </div>`;
    }).join("");
    listEl.querySelectorAll("[data-fav]").forEach(btn => {
      btn.onclick = () => toggleFav(btn.dataset.fav, btn);
    });
  } catch (e) {
    listEl.innerHTML = `<div class="state-error"><p>讀取失敗：${escapeHtml(e.message)}</p></div>`;
  }
}

(async function init() {
  view.innerHTML = `
    <div class="f-search">
      <input id="f-q" placeholder="搜尋知識湖…" aria-label="搜尋">
      <button class="btn btn-primary" id="f-go">搜尋</button>
    </div>
    <div class="f-tags" id="f-tags"></div>
    <div class="f-list" id="f-list"></div>`;

  // 標籤
  try {
    const t = await swr("tags", "/tags");
    const tags = t.data?.tags || (Array.isArray(t.data) ? t.data : []);
    document.getElementById("f-tags").innerHTML = tags.slice(0, 12).map(tag =>
      `<button class="f-tag" aria-pressed="false">${escapeHtml(tag.name || tag)}</button>`
    ).join("");
    document.querySelectorAll(".f-tag").forEach(b => {
      b.onclick = () => {
        document.querySelectorAll(".f-tag").forEach(x => x.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        renderContents(b.textContent);
      };
    });
  } catch { /* 標籤失敗不擋內容 */ }

  if (isLoggedIn()) await loadFavs();

  document.getElementById("f-go").onclick = () =>
    renderContents(document.getElementById("f-q").value.trim());
  document.getElementById("f-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") renderContents(e.target.value.trim());
  });

  renderContents();
})();
