/* 即時通訊：個人聊天 + 群聊。輸入暱稱即可找到對方。 */
import { get, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain, toast } from "../core/a11y.js";

const view = document.getElementById("c-view");
let current = null; // {type:'dm'|'group', id, name}
let timer = null;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function msgHtml(m) {
  return `<div style="margin-bottom:10px;text-align:${m.is_mine ? "right" : "left"}">
    <div style="display:inline-block;max-width:75%;padding:8px 12px;border-radius:12px;
      background:${m.is_mine ? "var(--accent)" : "var(--card)"};
      color:${m.is_mine ? "#fff" : "inherit"};
      border:${m.is_mine ? "none" : "1px solid var(--line)"}">
      ${!m.is_mine && m.sender_name ? `<div style="font-size:11px;opacity:.7;margin-bottom:2px">${escapeHtml(m.sender_name)}</div>` : ""}
      <div style="font-size:14px;word-break:break-word">${escapeHtml(m.content)}</div>
    </div></div>`;
}

/* ---- 主畫面：兩個大按鈕 ---- */
function renderHome() {
  stopTimer();
  current = null;
  view.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
      <button class="btn btn-primary" id="c-go-dm" style="padding:32px 16px;font-size:18px;font-weight:800">
        個人聊天<br><span style="font-size:13px;font-weight:400;opacity:.8">輸入對方暱稱即可找到</span>
      </button>
      <button class="btn btn-primary" id="c-go-group" style="padding:32px 16px;font-size:18px;font-weight:800">
        發起群聊<br><span style="font-size:13px;font-weight:400;opacity:.8">建立多人聊天室</span>
      </button>
    </div>
    <div id="c-form-area"></div>
    <h3 style="margin:24px 0 12px">我的聊天</h3>
    <div id="c-list"><p style="color:var(--muted)">載入中…</p></div>`;

  document.getElementById("c-go-dm").onclick = renderDmForm;
  document.getElementById("c-go-group").onclick = renderGroupForm;
  loadList();
  focusMain();
}

/* ---- 個人聊天：輸入暱稱 ---- */
function renderDmForm() {
  const area = document.getElementById("c-form-area");
  area.innerHTML = `
    <div class="card" style="padding:20px">
      <h3 style="margin-top:0">個人聊天</h3>
      <div style="display:flex;gap:8px">
        <input id="c-dm-name" type="text" placeholder="輸入對方暱稱…" aria-label="對方暱稱"
          style="flex:1;padding:10px 14px;border:1px solid var(--line);border-radius:8px;font-size:14px">
        <button class="btn btn-primary" id="c-dm-go">開始聊天</button>
      </div>
      <p id="c-dm-msg" style="font-size:13px;color:var(--muted);margin:8px 0 0"></p>
    </div>`;
  const input = document.getElementById("c-dm-name");
  const go = async () => {
    const name = input.value.trim();
    if (!name) { toast("請輸入對方暱稱"); return; }
    const msgEl = document.getElementById("c-dm-msg");
    msgEl.textContent = "搜尋中…";
    try {
      const r = await get(`/chat/search?name=${encodeURIComponent(name)}`);
      if (!r.user) { msgEl.textContent = `找不到「${name}」，請確認暱稱是否正確。`; return; }
      openDm(r.user.name);
    } catch (e) { msgEl.textContent = "搜尋失敗：" + e.message; }
  };
  document.getElementById("c-dm-go").onclick = go;
  input.onkeydown = e => { if (e.key === "Enter") go(); };
  input.focus();
}

/* ---- 發起群聊 ---- */
function renderGroupForm() {
  const area = document.getElementById("c-form-area");
  area.innerHTML = `
    <div class="card" style="padding:20px">
      <h3 style="margin-top:0">發起群聊</h3>
      <input id="c-g-name" type="text" placeholder="群聊名稱…" aria-label="群聊名稱" maxlength="50"
        style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:8px;font-size:14px;margin-bottom:8px;box-sizing:border-box">
      <input id="c-g-members" type="text" placeholder="成員暱稱，用逗號分隔（可留空稍後邀請）…" aria-label="成員暱稱"
        style="width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box">
      <button class="btn btn-primary" id="c-g-go" style="width:100%">建立群聊</button>
    </div>`;
  document.getElementById("c-g-go").onclick = async () => {
    const name = document.getElementById("c-g-name").value.trim();
    if (!name) { toast("請輸入群聊名稱"); return; }
    const members = document.getElementById("c-g-members").value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const btn = document.getElementById("c-g-go");
    btn.disabled = true; btn.textContent = "建立中…";
    try {
      const r = await post("/chat/groups", { name, member_names: members });
      toast(`群聊「${r.name}」已建立` + (r.added?.length ? `，已加入：${r.added.join("、")}` : ""));
      openGroup(r.id, r.name);
    } catch (e) {
      toast(e.message);
      btn.disabled = false; btn.textContent = "建立群聊";
    }
  };
}

/* ---- 聊天列表（個人 + 群組） ---- */
async function loadList() {
  const el = document.getElementById("c-list");
  try {
    const [dms, groups] = await Promise.all([
      get("/chat/conversations").catch(() => ({ conversations: [] })),
      get("/chat/groups").catch(() => ({ groups: [] })),
    ]);
    const dmList = dms.conversations || [];
    const grpList = groups.groups || [];
    if (!dmList.length && !grpList.length) {
      el.innerHTML = `<p style="color:var(--muted)">還沒有聊天，用上方按鈕開始吧！</p>`;
      return;
    }
    el.innerHTML =
      grpList.map(g => `
        <div class="card c-item" data-type="group" data-id="${escapeHtml(g.id)}" data-name="${escapeHtml(g.name)}"
          tabindex="0" role="button" style="padding:14px 16px;margin-bottom:8px;cursor:pointer">
          <strong>[群] ${escapeHtml(g.name)}</strong>
          <span style="font-size:12px;color:var(--muted);margin-left:8px">${g.member_count || ""} 人</span>
        </div>`).join("") +
      dmList.map(c => `
        <div class="card c-item" data-type="dm" data-name="${escapeHtml(c.other_name)}"
          tabindex="0" role="button" style="padding:14px 16px;margin-bottom:8px;cursor:pointer">
          <strong>${escapeHtml(c.other_name)}</strong>
        </div>`).join("");
    el.querySelectorAll(".c-item").forEach(item => {
      const open = () => {
        if (item.dataset.type === "group") openGroup(item.dataset.id, item.dataset.name);
        else openDm(item.dataset.name);
      };
      item.onclick = open;
      item.onkeydown = e => { if (e.key === "Enter") open(); };
    });
  } catch (e) {
    el.innerHTML = `<p>載入失敗：${escapeHtml(e.message)}</p>`;
  }
}

/* ---- 開啟個人聊天 ---- */
async function openDm(name) {
  current = { type: "dm", name };
  renderChatShell(`與 ${name} 的對話`);
  await loadDmMessages();
  startTimer();
}

/* ---- 開啟群聊 ---- */
async function openGroup(id, name) {
  current = { type: "group", id, name };
  renderChatShell(`[群] ${name}`);
  await loadGroupMessages();
  startTimer();
}

function renderChatShell(title) {
  view.innerHTML = `
    <button class="btn btn-ghost" id="c-back" style="margin-bottom:12px">← 返回</button>
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid var(--line)">
        <strong>${escapeHtml(title)}</strong>
        <div id="c-members" style="font-size:12px;color:var(--muted)"></div>
      </div>
      <div id="c-msgs" style="padding:16px;min-height:200px;max-height:50vh;overflow-y:auto"></div>
      <div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--line)">
        <input id="c-input" type="text" placeholder="輸入訊息…" aria-label="訊息內容" maxlength="2000"
          style="flex:1;padding:10px 14px;border:1px solid var(--line);border-radius:8px;font-size:14px">
        <button class="btn btn-primary" id="c-send">送出</button>
      </div>
    </div>`;
  document.getElementById("c-back").onclick = renderHome;
  const input = document.getElementById("c-input");
  document.getElementById("c-send").onclick = sendCurrent;
  input.onkeydown = e => { if (e.key === "Enter") sendCurrent(); };
  input.focus();
}

async function loadDmMessages(silent) {
  if (!current || current.type !== "dm") return;
  try {
    const r = await get(`/chat/with/${encodeURIComponent(current.name)}?limit=50`);
    const box = document.getElementById("c-msgs");
    if (!box) return;
    const msgs = r.messages || [];
    box.innerHTML = msgs.length ? msgs.map(msgHtml).join("") : `<p style="color:var(--muted);text-align:center">還沒有訊息，打個招呼吧！</p>`;
    if (!silent) box.scrollTop = box.scrollHeight;
  } catch (e) { /* 靜默 */ }
}

async function loadGroupMessages(silent) {
  if (!current || current.type !== "group") return;
  try {
    const r = await get(`/chat/groups/${encodeURIComponent(current.id)}/messages?limit=50`);
    const box = document.getElementById("c-msgs");
    if (!box) return;
    const msgs = r.messages || [];
    box.innerHTML = msgs.length ? msgs.map(msgHtml).join("") : `<p style="color:var(--muted);text-align:center">還沒有訊息，打個招呼吧！</p>`;
    if (!silent) box.scrollTop = box.scrollHeight;
    const memEl = document.getElementById("c-members");
    if (memEl && r.members) memEl.textContent = "成員：" + r.members.join("、");
  } catch (e) { /* 靜默 */ }
}

async function sendCurrent() {
  if (!current) return;
  const input = document.getElementById("c-input");
  const content = input.value.trim();
  if (!content) return;
  input.value = "";
  input.disabled = true;
  try {
    if (current.type === "dm") {
      await post("/chat/send", { receiver_name: current.name, content });
      await loadDmMessages();
    } else {
      await post(`/chat/groups/${encodeURIComponent(current.id)}/messages`, { content });
      await loadGroupMessages();
    }
    const box = document.getElementById("c-msgs");
    if (box) box.scrollTop = box.scrollHeight;
  } catch (e) {
    toast(e.message);
    input.value = content;
  }
  input.disabled = false;
  input.focus();
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    if (!current) return;
    if (current.type === "dm") loadDmMessages(true);
    else loadGroupMessages(true);
  }, 5000);
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

/* ---- 初始化 ---- */
(function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">
      <p>請先登入再使用即時通訊</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  renderHome();
  window.addEventListener("beforeunload", stopTimer);
})();
