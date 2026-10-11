/* 知識網絡：瀏覽共享的知識節點 */
import { get, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { focusMain, toast } from "../core/a11y.js";

const view = document.getElementById("k-view");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function render() {
  view.innerHTML = `
    <div style="margin-bottom:16px">
      <input id="k-search" type="text" placeholder="搜尋概念，如：光合作用…" aria-label="搜尋概念"
        style="width:100%;padding:10px;font-size:15px">
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-primary" id="k-tab-public">學習網絡</button>
      <button class="btn btn-ghost" id="k-tab-mine">我的節點</button>
    </div>
    <div id="k-list"><p style="color:var(--muted)">載入中…</p></div>`;

  let tab = "public";
  const searchInput = document.getElementById("k-search");
  const pubBtn = document.getElementById("k-tab-public");
  const mineBtn = document.getElementById("k-tab-mine");

  async function load() {
    const list = document.getElementById("k-list");
    list.innerHTML = `<p style="color:var(--muted)">載入中…</p>`;
    try {
      const concept = searchInput.value.trim();
      let url = tab === "public" ? "/knowledge/nodes" : "/knowledge/nodes/mine";
      if (tab === "public" && concept) url += `?concept=${encodeURIComponent(concept)}`;
      const r = await get(url);
      const nodes = r.nodes || r.data?.nodes || [];
      if (!nodes.length) {
        list.innerHTML = `<p style="color:var(--muted);text-align:center;padding:24px">
          ${tab === "public" ? "還沒有公開的知識節點，成為第一個分享的人吧！" : "你還沒有建立知識節點，去複習時點「存入知識倉庫」吧！"}</p>`;
        return;
      }
      list.innerHTML = nodes.map(n => `
        <article class="card" style="margin-bottom:12px;padding:16px">
          <h3 style="margin:0 0 8px">${escapeHtml(n.question)}</h3>
          ${n.answer ? `<p style="color:var(--accent)"><strong>答：</strong>${escapeHtml(n.answer)}</p>` : ""}
          ${n.explanation && n.explanation !== n.answer ? `<p style="font-size:14px;color:var(--muted)">${escapeHtml(n.explanation)}</p>` : ""}
          ${(n.concepts || []).length ? `<div style="margin:8px 0">` +
            n.concepts.map(c => `<span class="k-tag" data-concept="${escapeHtml(c)}"
              style="display:inline-block;background:var(--surface);padding:4px 10px;border-radius:12px;font-size:12px;margin:2px;cursor:pointer">${escapeHtml(c)}</span>`).join("") + `</div>` : ""}
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted)">
            <span>${escapeHtml(n.owner_name || "匿名")} · ${escapeHtml((n.created_at || "").slice(0, 10))}</span>
            <button class="btn btn-ghost k-upvote" data-id="${escapeHtml(n.id)}"
              style="font-size:12px;padding:4px 10px">讚 ${n.upvotes || 0}</button>
          </div>
        </article>`).join("");

      list.querySelectorAll(".k-upvote").forEach(b => {
        b.onclick = async () => {
          try { await post(`/knowledge/nodes/${b.dataset.id}/upvote`, {}); load(); }
          catch (e) { toast(`按讚失敗：${e.message}`); }
        };
      });
      list.querySelectorAll(".k-tag").forEach(t => {
        t.onclick = () => { searchInput.value = t.dataset.concept; tab = "public"; load(); };
      });
    } catch (e) {
      list.innerHTML = `<p>載入失敗：${escapeHtml(e.message)}</p>`;
    }
  }

  pubBtn.onclick = () => {
    tab = "public";
    pubBtn.classList.add("btn-primary"); pubBtn.classList.remove("btn-ghost");
    mineBtn.classList.remove("btn-primary"); mineBtn.classList.add("btn-ghost");
    load();
  };
  mineBtn.onclick = () => {
    tab = "mine";
    mineBtn.classList.add("btn-primary"); mineBtn.classList.remove("btn-ghost");
    pubBtn.classList.remove("btn-primary"); pubBtn.classList.add("btn-ghost");
    load();
  };
  searchInput.onkeydown = e => { if (e.key === "Enter") load(); };

  await load();
  focusMain();
}

(function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">
      <p>請先登入再瀏覽知識網絡</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  render();
})();
