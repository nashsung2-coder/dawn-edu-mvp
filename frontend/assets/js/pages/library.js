/* 知識星海圖書館
 * 探索 → 興趣星辰（AI 推薦）→ 我的庫 → 庫詳情（Google Sites 式編輯）→ 費曼調用
 * 全調真實後端，零假數據。
 */
import { get, post, patch, del } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain, toast } from "../core/a11y.js";

const view = document.getElementById("l-view");
const modal = document.getElementById("l-modal");

let currentLib = null;  // 正在看的庫

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function skeleton(n = 3) {
  return Array(n).fill('<div class="skeleton" style="height:120px;margin-bottom:12px"></div>').join("");
}

/* ============ 主視圖：探索＋星辰＋我的 ============ */

async function renderHome() {
  currentLib = null;
  view.innerHTML = skeleton(4);
  focusMain();

  try {
    const [libsRes, recRes] = await Promise.all([
      get("/kb/libraries?limit=30"),
      get("/kb/recommend?limit=6").catch(() => ({ libraries: [] })),
    ]);
    const libs = libsRes.libraries || libsRes.data?.libraries || [];
    const recs = recRes.libraries || recRes.data?.libraries || [];
    const mine = libs.filter(l => l.owner_id && l.is_owner !== false && isMine(l));

    view.innerHTML = `
      <div class="l-banner">
        <img src="../assets/img/emblem-library.webp?v=3.0.0" alt="知識星海圖書館" loading="lazy">
        <div class="l-banner-text">
          <h2>知識星海圖書館</h2>
          <p>探索他人的知識庫，用你的擅長建立自己的庫</p>
        </div>
      </div>

      ${recs.length ? `
      <section class="l-stars" aria-label="興趣星辰">
        <h2>興趣星辰</h2>
        <p class="l-sub">AI 依你的學習足跡推薦的知識庫</p>
        <div class="l-grid">${recs.map(starCard).join("")}</div>
      </section>` : ""}

      <section class="l-sec" aria-label="探索">
        <h2>探索知識庫 <span class="l-count">${libs.length} 個</span></h2>
        <div style="margin-bottom:12px">
          <input id="l-search" type="search" placeholder="搜尋庫名或簡介…"
            aria-label="搜尋知識庫"
            style="width:100%;max-width:400px;padding:10px 14px;border:1px solid var(--line);border-radius:999px;font-size:14px">
        </div>
        <div class="l-grid" id="l-explore-grid">${libs.map(libCard).join("") || emptyHtml("還沒有公開知識庫，來建第一個吧！")}</div>
      </section>

      ${mine.length ? `
      <section class="l-sec" aria-label="我的庫">
        <h2>我的知識庫 <span class="l-count">${mine.length} 個</span></h2>
        <div class="l-grid">${mine.map(libCard).join("")}</div>
      </section>` : ""}
    `;

    bindCards();
    const searchInput = document.getElementById("l-search");
    if (searchInput) {
      let t;
      searchInput.oninput = () => {
        clearTimeout(t);
        t = setTimeout(() => doSearch(searchInput.value.trim()), 400);
      };
    }
  } catch (e) {
    view.innerHTML = `<div class="state-error"><p>載入失敗：${escapeHtml(e.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">重試</button></div>`;
  }
}

function isMine(l) {
  // 後端 list_libraries 會帶 owner 資訊，這裡用啟發式：之後改進
  return l._mine === true;
}

function starCard(l) {
  return `<div class="l-card" data-lib="${escapeHtml(l.id)}" tabindex="0" role="button"
    aria-label="推薦：${escapeHtml(l.title)}">
    <h3>${escapeHtml(l.title)}</h3>
    <p>${escapeHtml(l.description || "暫無簡介")}</p>
    <div class="l-meta">
      ${l.match_score > 0 ? `<span class="l-match">匹配度 ${l.match_score}</span>` : ""}
      <span>${escapeHtml(l.owner_name || "")}</span>
      <span>${l.page_count ?? 0} 頁</span>
    </div>
  </div>`;
}

function libCard(l) {
  return `<div class="l-card" data-lib="${escapeHtml(l.id)}" tabindex="0" role="button"
    aria-label="知識庫：${escapeHtml(l.title)}">
    <h3>${escapeHtml(l.title)} ${l.visibility === "private" ? '<span class="l-private">(私人)</span>' : ""}</h3>
    <p>${escapeHtml(l.description || "暫無簡介")}</p>
    <div class="l-meta">
      ${(l.tags || []).slice(0, 3).map(t => `<span class="l-tag">${escapeHtml(t)}</span>`).join("")}
      <span>${escapeHtml(l.owner_name || "")}</span>
      <span>${l.page_count ?? 0} 頁</span>
    </div>
  </div>`;
}

function emptyHtml(msg) {
  return `<div class="state-empty"><p>${escapeHtml(msg)}</p></div>`;
}

function bindCards() {
  view.querySelectorAll("[data-lib]").forEach(el => {
    const go = () => renderDetail(el.dataset.lib);
    el.onclick = go;
    el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
  });
}

async function doSearch(q) {
  const grid = document.getElementById("l-explore-grid");
  if (!grid) return;
  grid.innerHTML = skeleton(3);
  try {
    const r = await get(`/kb/libraries?limit=30&search=${encodeURIComponent(q)}`);
    const libs = r.libraries || r.data?.libraries || [];
    grid.innerHTML = libs.map(libCard).join("") || emptyHtml("沒有找到相關知識庫");
    bindCards();
  } catch (e) {
    grid.innerHTML = `<div class="state-error"><p>搜尋失敗</p></div>`;
  }
}

/* ============ 庫詳情（Google Sites 式） ============ */

async function renderDetail(libId) {
  view.innerHTML = skeleton(4);
  focusMain();
  try {
    const r = await get(`/kb/libraries/${libId}`);
    const lib = r.library || r.data?.library;
    if (!lib) throw new Error("找不到這個庫");
    currentLib = lib;

    const pages = lib.pages || [];
    // 探索進度
    let expHtml = "";
    try {
      const er = await get(`/libraries/${libId}/exploration`);
      const exp = er.exploration || {};
      const prog = Math.round(exp.progress || 0);
      const milestones = exp.milestones || [];
      expHtml = `<div class="l-explore" style="margin:16px 0;padding:16px;background:var(--surface);border-radius:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong>探索進度</strong><span>${prog}%</span>
        </div>
        <div style="height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin-bottom:12px">
          <div style="height:100%;width:${prog}%;background:var(--accent);border-radius:4px;transition:width .3s"></div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px">
          已讀 ${exp.pages_read || 0} 頁 · 提問 ${exp.questions_asked || 0} 次
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${milestones.map(m => `
            <span style="font-size:12px;padding:4px 10px;border-radius:12px;
              background:${prog >= m.threshold ? "var(--accent)" : "var(--line)"};
              color:${prog >= m.threshold ? "#fff" : "var(--muted)"}">
              ${m.label} ${m.threshold}%${(exp.weapon_claimed_lv || 0) >= m.level ? " · 已領取" : ""}
            </span>`).join("")}
        </div>
        <button class="btn btn-primary" id="l-claim-weapon" style="margin-top:12px;font-size:13px">領取探索武器</button>
        <div style="margin-top:12px">
          <button class="btn btn-ghost" id="l-guide-q" style="font-size:13px">不知道問什麼？讓 AI 引導你</button>
          <div id="l-guide-box" style="margin-top:8px"></div>
        </div>
      </div>`;
    } catch (e) { /* 未登入或無記錄就不顯示 */ }

    view.innerHTML = `
      <button class="btn btn-ghost" id="l-back" style="margin-bottom:12px">‹ 返回探索</button>
      <div class="l-detail-head">
        <h2>${escapeHtml(lib.title)}</h2>
        <p>${escapeHtml(lib.description || "暫無簡介")}</p>
        <div class="l-meta" style="font-size:12px;color:var(--muted);display:flex;gap:8px;flex-wrap:wrap">
          ${(lib.tags || []).map(t => `<span class="l-tag">${escapeHtml(t)}</span>`).join("")}
          <span>${lib.visibility === "private" ? "私人" : "公開"}</span>
          <span>${pages.length} 頁</span>
        </div>
        ${expHtml}
        ${lib.is_owner ? `
        <div class="l-detail-actions">
          <button class="btn btn-primary" id="l-add-page" style="font-size:13px">＋ 新增頁面</button>
          <button class="btn btn-ghost" id="l-edit-lib" style="font-size:13px">編輯庫資訊</button>
          <button class="btn btn-ghost" id="l-feynman-lib" style="font-size:13px">費曼挑戰這個庫</button>
        </div>` : `
        <div class="l-detail-actions">
          <button class="btn btn-primary" id="l-feynman-lib" style="font-size:13px">費曼挑戰這個庫</button>
        </div>`}
      </div>
      <div id="l-pages">
        ${pages.length ? pages.map((p, i) => pageHtml(p, i, lib.is_owner)).join("") : emptyHtml("這個庫還沒有頁面" + (lib.is_owner ? "，來新增第一頁吧！" : ""))}
      </div>
    `;

    document.getElementById("l-back").onclick = renderHome;
    if (lib.is_owner) {
      document.getElementById("l-add-page").onclick = () => addPageUI(libId);
      document.getElementById("l-edit-lib").onclick = () => editLibUI(lib);
    }
    document.getElementById("l-feynman-lib").onclick = () => feynmanForLib(lib);

    // 領取探索武器
    const claimBtn = document.getElementById("l-claim-weapon");
    if (claimBtn) {
      claimBtn.onclick = async () => {
        try {
          const r = await post(`/libraries/${libId}/claim-weapon`, {});
          toast(`獲得「${r.weapon_name}」Lv.${r.level}（${r.label}）！`);
          renderDetail(libId);
        } catch (e) { toast(e.message); }
      };
    }

    // 提問鷹架：不知道問什麼時，AI 給引導問題
    const guideBtn = document.getElementById("l-guide-q");
    if (guideBtn) {
      guideBtn.onclick = async () => {
        guideBtn.disabled = true; guideBtn.textContent = "生成中…";
        try {
          const r = await post("/feynman/guiding-questions", {
            topic: lib.title, context: lib.description || "" });
          const qs = r.questions || [];
          const box = document.getElementById("l-guide-box");
          box.innerHTML = qs.map((q, i) => `
            <button class="btn btn-ghost l-guide-q" data-q="${escapeHtml(q)}"
              style="display:block;width:100%;text-align:left;margin:6px 0;font-size:14px">
              ${i + 1}. ${escapeHtml(q)}
            </button>`).join("");
          box.querySelectorAll(".l-guide-q").forEach(b => {
            b.onclick = () => {
              // 點問題 → 去費曼說服
              location.href = `feynman.html?topic=${encodeURIComponent(b.dataset.q)}&lib=${libId}`;
            };
          });
        } catch (e) { toast(e.message); }
        guideBtn.disabled = false; guideBtn.textContent = "不知道問什麼？讓 AI 引導你";
      };
    }

    // 頁面展開/收合（展開時記錄閱讀）
    view.querySelectorAll(".l-page-head").forEach(head => {
      head.onclick = async () => {
        const body = head.nextElementSibling;
        const open = body.hidden;
        body.hidden = !open;
        head.querySelector(".l-toggle").textContent = open ? "收合" : "展開";
        if (open) {
          // 記錄讀了一頁
          try { await post(`/libraries/${libId}/read`, {}); } catch (e) {}
        }
      };
    });
    // 擁有者：編輯/刪除頁面
    if (lib.is_owner) {
      view.querySelectorAll("[data-edit-page]").forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); editPageUI(btn.dataset.editPage); };
      });
      view.querySelectorAll("[data-del-page]").forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          if (!confirm("確定刪除這個頁面？")) return;
          try {
            await del(`/kb/pages/${btn.dataset.delPage}`);
            toast("已刪除");
            renderDetail(libId);
          } catch (err) { toast(`刪除失敗：${err.message}`); }
        };
      });
      view.querySelectorAll("[data-feynman-page]").forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); feynmanForPage(btn.dataset.feynmanPage); };
      });
    }
  } catch (e) {
    view.innerHTML = `<div class="state-error"><p>${escapeHtml(e.message)}</p>
      <button class="btn btn-ghost" onclick="location.reload()">返回</button></div>`;
  }
}

function pageHtml(p, i, isOwner) {
  // 簡易 Markdown 渲染：標題、粗體、列表
  const html = renderMarkdown(p.content || "");
  return `<div class="l-page">
    <div class="l-page-head" tabindex="0" role="button" aria-expanded="false">
      <h3>${escapeHtml(p.title)}</h3>
      <span class="l-toggle" style="font-size:12px;color:var(--muted)">展開</span>
    </div>
    <div class="l-page-body" hidden>
      <div class="l-content">${html}</div>
      <div class="l-page-actions">
        <button class="btn btn-ghost" data-feynman-page="${escapeHtml(p.id)}" style="font-size:13px">費曼挑戰這一頁</button>
        ${isOwner ? `
        <button class="btn btn-ghost" data-edit-page="${escapeHtml(p.id)}" style="font-size:13px">編輯</button>
        <button class="btn btn-ghost" data-del-page="${escapeHtml(p.id)}" style="font-size:13px;color:var(--danger,#ef4444)">刪除</button>` : ""}
      </div>
    </div>
  </div>`;
}

function renderMarkdown(src) {
  // 支援：# ## ### 標題、**粗體**、- 列表
  // Google Sites 式嵌入：
  //   !youtube[VIDEO_ID] → YouTube 影片
  //   !link[URL] → 連結卡片
  //   !code[語言] → 程式碼區塊（接續多行，``` 結束）
  const lines = src.split("\n");
  let html = "", inList = false, inCode = false, codeLang = "", codeBuf = [];
  for (const line of lines) {
    const t = line.trim();

    // 程式碼區塊
    if (/^```/.test(t)) {
      if (inCode) {
        html += `<pre class="l-code"><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join("\n"))}</code></pre>`;
        inCode = false; codeBuf = [];
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        inCode = true; codeLang = t.slice(3).trim() || "text"; codeBuf = [];
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    // YouTube 嵌入
    const yt = t.match(/^!youtube\[([\w-]{11})\]/);
    if (yt) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<div class="l-embed"><iframe width="100%" height="315"
        src="https://www.youtube.com/embed/${yt[1]}"
        frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen title="YouTube 影片"></iframe></div>`;
      continue;
    }
    // 連結卡片
    const lk = t.match(/^!link\[(https?:\/\/[^\]]+)\]/);
    if (lk) {
      if (inList) { html += "</ul>"; inList = false; }
      const url = lk[1];
      let host = "";
      try { host = new URL(url).hostname; } catch (e) {}
      html += `<a class="l-linkcard" href="${escapeHtml(url)}" target="_blank" rel="noopener">
        <span class="l-linkcard-host">${escapeHtml(host)}</span>
        <span class="l-linkcard-url">${escapeHtml(url.length > 60 ? url.slice(0, 60) + "…" : url)}</span>
      </a>`;
      continue;
    }

    if (/^###\s/.test(t)) { if (inList) { html += "</ul>"; inList = false; } html += `<h4>${escInline(t.slice(4))}</h4>`; }
    else if (/^##\s/.test(t)) { if (inList) { html += "</ul>"; inList = false; } html += `<h3>${escInline(t.slice(3))}</h3>`; }
    else if (/^#\s/.test(t)) { if (inList) { html += "</ul>"; inList = false; } html += `<h2>${escInline(t.slice(2))}</h2>`; }
    else if (/^[-*]\s/.test(t)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${escInline(t.slice(2))}</li>`; }
    else if (t === "") { if (inList) { html += "</ul>"; inList = false; } }
    else { if (inList) { html += "</ul>"; inList = false; } html += `<p>${escInline(t)}</p>`; }
  }
  if (inList) html += "</ul>";
  if (inCode) html += `<pre class="l-code"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`;
  return html || '<p style="color:var(--muted)">（空頁面）</p>';
}

function escInline(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/* ---- 新增/編輯頁面 ---- */

async function addPageUI(libId) {
  const title = prompt("頁面標題：");
  if (!title || !title.trim()) return;
  try {
    await post(`/kb/libraries/${libId}/pages`, { title: title.trim(), content: "" });
    toast("已新增頁面，點進去開始寫吧！");
    renderDetail(libId);
  } catch (e) { toast(`新增失敗：${e.message}`); }
}

async function editPageUI(pageId) {
  try {
    const r = await get(`/kb/pages/${pageId}`);
    const page = r.page || r.data?.page;
    if (!page) throw new Error("找不到頁面");

    // 找到對應的 page body，換成編輯器
    const bodies = view.querySelectorAll(".l-page-body");
    let targetBody = null;
    view.querySelectorAll(`[data-edit-page="${pageId}"]`).forEach(btn => {
      targetBody = btn.closest(".l-page");
    });
    if (!targetBody) return;
    const body = targetBody.querySelector(".l-page-body");
    body.hidden = false;

    body.innerHTML = `
      <label style="display:block;margin:12px 0 4px;font-size:13px">標題
        <input id="l-ep-title" type="text" value="${escapeHtml(page.title)}"
          style="width:100%;margin-top:4px;padding:10px;border:1px solid var(--line);border-radius:8px;font-size:14px">
      </label>
      <label style="display:block;margin:12px 0 4px;font-size:13px">內容（支援 Markdown＋嵌入）
        <div style="font-size:12px;color:var(--muted);margin:4px 0 8px;line-height:1.8">
          # 大標題　## 中標題　**粗體**　- 列表<br>
          !youtube[影片ID] 嵌入 YouTube　!link[網址] 連結卡片<br>
          ```python … ``` 程式碼區塊
        </div>
        <textarea id="l-ep-content" class="l-page-edit">${escapeHtml(page.content || "")}</textarea>
      </label>
      <div class="l-page-actions">
        <button class="btn btn-primary" id="l-ep-save">儲存</button>
        <button class="btn btn-ghost" id="l-ep-cancel">取消</button>
      </div>`;

    document.getElementById("l-ep-cancel").onclick = () => renderDetail(currentLib.id);
    document.getElementById("l-ep-save").onclick = async () => {
      const nt = document.getElementById("l-ep-title").value.trim();
      const nc = document.getElementById("l-ep-content").value;
      if (!nt) { toast("標題不能為空"); return; }
      try {
        await patch(`/kb/pages/${pageId}`, { title: nt, content: nc });
        toast("已儲存");
        renderDetail(currentLib.id);
      } catch (e) { toast(`儲存失敗：${e.message}`); }
    };
  } catch (e) { toast(`載入失敗：${e.message}`); }
}

/* ---- 編輯庫資訊 ---- */

function editLibUI(lib) {
  openModal("編輯知識庫", lib, async (data) => {
    try {
      await patch(`/kb/libraries/${lib.id}`, data);
      toast("已更新");
      closeModal();
      renderDetail(lib.id);
    } catch (e) { toast(`更新失敗：${e.message}`); }
  });
}

/* ============ 費曼調用 ============ */

function feynmanForLib(lib) {
  const topic = `${lib.title}：${lib.description || ""}`.slice(0, 200);
  goFeynman(topic, lib.title);
}

async function feynmanForPage(pageId) {
  try {
    const r = await get(`/kb/pages/${pageId}`);
    const page = r.page || r.data?.page;
    if (!page) throw new Error("找不到頁面");
    const topic = `${page.title}\n${(page.content || "").slice(0, 500)}`.slice(0, 300);
    goFeynman(topic, page.title);
  } catch (e) { toast(`載入失敗：${e.message}`); }
}

function goFeynman(topic, label) {
  // 跳到費曼說服頁，帶上主題
  location.href = `feynman.html?topic=${encodeURIComponent(topic)}`;
}

/* ============ 建庫 ============ */

function openModal(title, lib = null, onOk = null) {
  document.getElementById("l-modal-title").textContent = title;
  document.getElementById("l-m-title").value = lib?.title || "";
  document.getElementById("l-m-desc").value = lib?.description || "";
  document.getElementById("l-m-tags").value = (lib?.tags || []).join(", ");
  document.getElementById("l-m-vis").value = lib?.visibility || "public";
  modal.hidden = false;

  const okBtn = document.getElementById("l-m-ok");
  okBtn.onclick = async () => {
    const data = {
      title: document.getElementById("l-m-title").value.trim(),
      description: document.getElementById("l-m-desc").value.trim(),
      tags: document.getElementById("l-m-tags").value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      visibility: document.getElementById("l-m-vis").value,
    };
    if (!data.title) { toast("庫名不能為空"); return; }
    if (onOk) { onOk(data); return; }
    // 預設：建立
    try {
      const r = await post("/kb/libraries", data);
      const newLib = r.library || r.data?.library;
      toast(`「${data.title}」建立成功！`);
      closeModal();
      if (newLib?.id) renderDetail(newLib.id);
      else renderHome();
    } catch (e) { toast(`建立失敗：${e.message}`); }
  };
  document.getElementById("l-m-title").focus();
}

function closeModal() { modal.hidden = true; }

/* ============ 初始化 ============ */

(function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再使用知識星海圖書館</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  document.getElementById("l-create-btn").onclick = () => openModal("建立知識庫");
  document.getElementById("l-m-cancel").onclick = closeModal;
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

  // 如果是從庫詳情返回（帶 lib 參數）
  const params = new URLSearchParams(location.search);
  const libId = params.get("lib");
  if (libId) renderDetail(libId);
  else renderHome();
})();
