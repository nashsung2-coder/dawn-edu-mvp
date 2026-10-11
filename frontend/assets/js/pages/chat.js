/* 即時通訊 MVP */
import { get, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain, toast } from "../core/a11y.js";

const view = document.getElementById("c-view");
let currentChat = null;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function renderList() {
  view.innerHTML = `<div id="c-new">
      <input id="c-new-name" type="text" placeholder="輸入好友名字開始聊天…" aria-label="好友名字">
      <button class="btn btn-primary" id="c-new-go">開始</button>
    </div>
    <div id="c-conv-list"><p style="color:var(--muted)">載入中…</p></div>
    <div id="c-chat" hidden>
      <div style="padding:12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <strong id="c-chat-title"></strong>
        <button class="btn btn-ghost" id="c-chat-close" style="font-size:13px">關閉</button>
      </div>
      <div id="c-msgs"></div>
      <div id="c-input-row">
        <input id="c-input" type="text" placeholder="輸入訊息…" aria-label="訊息內容" maxlength="2000">
        <button class="btn btn-primary" id="c-send">送出</button>
      </div>
    </div>`;

  document.getElementById("c-new-go").onclick = () => {
    const name = document.getElementById("c-new-name").value.trim();
    if (!name) { toast("請輸入好友名字"); return; }
    openChat(name);
  };
  document.getElementById("c-new-name").onkeydown = e => {
    if (e.key === "Enter") document.getElementById("c-new-go").click();
  };

  try {
    const r = await get("/chat/conversations");
    const convs = r.conversations || r.data?.conversations || [];
    const list = document.getElementById("c-conv-list");
    if (!convs.length) {
      list.innerHTML = `<p style="color:var(--muted)">還沒有對話，在上方輸入好友名字開始吧！</p>`;
    } else {
      list.innerHTML = convs.map(c => `
        <div class="c-conv" data-name="${escapeHtml(c.other_name)}" tabindex="0" role="button">
          <strong>${escapeHtml(c.other_name)}</strong>
          <span style="font-size:12px;color:var(--muted)">${escapeHtml((c.last_at || "").slice(0, 10))}</span>
        </div>`).join("");
      list.querySelectorAll(".c-conv").forEach(el => {
        el.onclick = () => openChat(el.dataset.name);
        el.onkeydown = e => { if (e.key === "Enter") openChat(el.dataset.name); };
      });
    }
  } catch (e) {
    document.getElementById("c-conv-list").innerHTML = `<p>載入失敗</p>`;
  }
  focusMain();
}

async function openChat(name) {
  currentChat = name;
  document.getElementById("c-chat").hidden = false;
  document.getElementById("c-chat-title").textContent = name;
  document.getElementById("c-chat-close").onclick = () => {
    document.getElementById("c-chat").hidden = true;
    currentChat = null;
  };
  await loadMessages();

  const send = async () => {
    const input = document.getElementById("c-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      await post("/chat/send", { receiver_name: name, content: text });
      await loadMessages();
    } catch (e) { toast(`發送失敗：${e.message}`); }
  };
  document.getElementById("c-send").onclick = send;
  document.getElementById("c-input").onkeydown = e => { if (e.key === "Enter") send(); };

  // 每 5 秒自動刷新
  if (window.__chatTimer) clearInterval(window.__chatTimer);
  window.__chatTimer = setInterval(() => { if (currentChat) loadMessages(true); }, 5000);
}

async function loadMessages(silent = false) {
  if (!currentChat) return;
  try {
    const r = await get(`/chat/with/${encodeURIComponent(currentChat)}`);
    const msgs = r.messages || r.data?.messages || [];
    const box = document.getElementById("c-msgs");
    box.innerHTML = msgs.map(m => `
      <div class="c-msg ${m.is_mine ? "mine" : "theirs"}">
        ${escapeHtml(m.content)}
        <span class="c-time">${escapeHtml((m.created_at || "").slice(11, 16))}</span>
      </div>`).join("") || `<p style="color:var(--muted);text-align:center">開始聊天吧！</p>`;
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    if (!silent) toast(`載入失敗：${e.message}`);
  }
}

(function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">
      <p>請先登入再使用即時通訊</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  renderList();
})();
