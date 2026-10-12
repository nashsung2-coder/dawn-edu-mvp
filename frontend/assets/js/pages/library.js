/* 知識星海圖書館
 * 探索 → 興趣星辰（AI 推薦）→ 我的庫 → 庫詳情（Google Sites 式編輯）→ 費曼調用
 * 全調真實後端，零假數據。
 */
/* 知識星海圖書館（IIFE 零依賴版） */
(function() {
"use strict";
function getToken() {
  return localStorage.getItem('dawn:v1:auth-token') || localStorage.getItem('dawn.token');
}
function apiFetch(method, path, body) {
  var token = getToken();
  var opts = { method: method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  return fetch('https://dawn-edu-mvp.onrender.com/api/v1' + path, opts).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}
function get(p) { return apiFetch('GET', p); }
function post(p, b) { return apiFetch('POST', p, b); }
function patch(p, b) { return apiFetch('PATCH', p, b); }
function del(p) { return apiFetch('DELETE', p); }
function isLoggedIn() { return !!getToken(); }
function announce(msg) {}
function focusMain() {}
function toast(msg) {
  try {
    var el = document.getElementById('l-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'l-toast';
      el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 20px;border-radius:8px;z-index:9999;max-width:80%';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(function(){ el.style.display = 'none'; }, 2500);
  } catch(e) {}
}


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
    // 友善錯誤訊息 + 自動重試一次（Render 可能在休眠喚醒）
    var msg = e.message || '';
    var friendly = msg.includes('Failed to fetch') || msg.includes('Network')
      ? '連線有點慢，正在重試…'
      : '載入失敗：' + msg;
    view.innerHTML = `<div class="state-error"><p>${escapeHtml(friendly)}</p>
      <button class="btn btn-primary" onclick="location.reload()">重試</button></div>`;
    // 自動重試一次
    setTimeout(function() {
      if (view.innerHTML.indexOf('連線有點慢') !== -1) {
        renderHome();
      }
    }, 3000);
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
      // 算還差多少到下一級
      let nextHint = "";
      for (const m of milestones) {
        if (prog < m.threshold) {
          const need = Math.ceil((m.threshold - prog) / 8); // 每頁 8%
          nextHint = `再讀約 ${need} 頁可達「${m.label}」`;
          break;
        }
      }
      expHtml = `<div class="l-explore" style="margin:16px 0;padding:16px;background:var(--surface);border-radius:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong>探索進度</strong><span>${prog}%</span>
        </div>
        <div style="height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin-bottom:12px">
          <div style="height:100%;width:${prog}%;background:var(--accent);border-radius:4px;transition:width .3s"></div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px">
          已讀 ${exp.pages_read || 0} 頁 · 提問 ${exp.questions_asked || 0} 次
          ${nextHint ? ` · <span style="color:var(--accent)">${nextHint}</span>` : " · 已達最高級！"}
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
  // 用 modal 代替 prompt（手機友善）
  var title = null;
  // 建立臨時 modal
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:20px;max-width:400px;width:100%">'
    + '<h3 style="margin:0 0 12px">新增頁面</h3>'
    + '<input id="lp-title" type="text" placeholder="頁面標題" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:16px">'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">'
    + '<button id="lp-cancel" style="padding:10px 20px;border:1px solid #ddd;background:#fff;border-radius:8px">取消</button>'
    + '<button id="lp-ok" style="padding:10px 20px;border:none;background:#1a1a1a;color:#fff;border-radius:8px">新增</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  
  return new Promise(function(resolve) {
    var input = overlay.querySelector('#lp-title');
    input.focus();
    overlay.querySelector('#lp-cancel').onclick = function() {
      document.body.removeChild(overlay);
      resolve();
    };
    overlay.querySelector('#lp-ok').onclick = async function() {
      title = input.value.trim();
      if (!title) { input.focus(); return; }
      var btn = overlay.querySelector('#lp-ok');
      btn.disabled = true; btn.textContent = '新增中…';
      try {
        await post("/kb/libraries/" + libId + "/pages", { title: title, content: "" });
        document.body.removeChild(overlay);
        toast("已新增頁面，點進去開始寫吧！");
        renderDetail(libId);
      } catch (e) {
        toast("新增失敗：" + e.message);
        btn.disabled = false; btn.textContent = '新增';
      }
      resolve();
    };
    overlay.onclick = function(e) {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        resolve();
      }
    };
  });
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
          \`\`\`python … \`\`\` 程式碼區塊
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
  modal.style.display = 'block';

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
    // 預設：建立（防止重複點擊）
    okBtn.disabled = true;
    okBtn.textContent = "建立中…";
    try {
      const r = await post("/kb/libraries", data);
      const newLib = r.library || r.data?.library;
      closeModal();
      toast(`「${data.title}」建立成功！`);
      if (newLib?.id) renderDetail(newLib.id);
      else renderHome();
    } catch (e) { toast(`建立失敗：${e.message}`); }
    finally {
      okBtn.disabled = false;
      okBtn.textContent = "建立";
    }
  };
  document.getElementById("l-m-title").focus();
}

function closeModal() { modal.hidden = true; modal.style.display = 'none'; }

/* ============ 初始化 ============ */

(function init() {
  // 先綁按鈕（未登入時點了會提示去登入）
  var createBtn = document.getElementById("l-create-btn");
  if (createBtn) {
    createBtn.onclick = function() {
      if (!isLoggedIn()) { toast("請先登入再建庫"); location.href = "settings.html"; return; }
      openModal("建立知識庫");
    };
  }
  var cancelBtn = document.getElementById("l-m-cancel");
  if (cancelBtn) cancelBtn.onclick = closeModal;
  if (modal) modal.addEventListener("click", function(e) { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", function(e) { if (e.key === "Escape") closeModal(); });

  // 不再前端預判登入，直接嘗試載入，401 時再顯示登入提示
  // （避免 localStorage 誤判導致已登入用戶看到「請先登入」）
  var params = new URLSearchParams(location.search);
  var libId = params.get("lib");
  // 先顯示載入中
  view.innerHTML = '<p style="text-align:center;color:var(--muted);padding:40px">載入中…</p>';
  // 嘗試用 API 驗證登入
  apiFetch('GET', '/auth/me').then(function() {
    // 登入有效，正常渲染
    if (libId) renderDetail(libId);
    else renderHome();
  }).catch(function(e) {
    // 401 或無 token，顯示登入提示
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再使用知識星海圖書館</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
  });
  return;
})();
})();
