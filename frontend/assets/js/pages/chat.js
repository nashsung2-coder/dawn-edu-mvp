/* 即時通訊 v2.0（重構版）
 * 統一使用 core/api.js，登入狀態由後端驗證
 * 功能：搜尋用戶 → 開始對話 → 發送訊息 → 自動刷新
 */
import { get, post } from "../core/api.js";
import { isLoggedIn, clearAuth } from "../core/auth.js";
import { toast } from "../core/a11y.js";

const view = document.getElementById("c-view");
if (!view) throw new Error("找不到 #c-view");

let currentChat = null; // { type: 'dm'|'group', id, name }
let pollTimer = null;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function showLogin(msg) {
  stopPolling();
  view.innerHTML = '<div style="text-align:center;padding:40px">'
    + '<p style="color:#666">' + esc(msg || "請先登入再使用即時通訊") + '</p>'
    + '<a href="settings.html" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:#fff;border-radius:8px;text-decoration:none;margin-top:12px">去登入</a>'
    + '</div>';
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/* ---- 主畫面：聊天列表 ---- */
async function showHome() {
  stopPolling();
  view.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">'
    + '<button id="c-new-dm" class="btn-primary" style="padding:20px;font-size:16px">＋ 找人聊天</button>'
    + '<button id="c-new-group" class="btn-primary" style="padding:20px;font-size:16px">＋ 發起群聊</button>'
    + '</div>'
    + '<div id="c-form-area"></div>'
    + '<h3 style="margin:16px 0 8px">我的聊天</h3>'
    + '<div id="c-list"><p style="color:#999">載入中…</p></div>';

  document.getElementById("c-new-dm").onclick = showDmForm;
  document.getElementById("c-new-group").onclick = showGroupForm;
  await loadList();
}

function showDmForm() {
  document.getElementById("c-form-area").innerHTML = '<div class="card" style="padding:16px;margin-bottom:16px">'
    + '<h4 style="margin:0 0 12px">找人聊天</h4>'
    + '<div style="display:flex;gap:8px">'
    + '<input id="c-dm-name" placeholder="輸入對方暱稱" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px">'
    + '<button id="c-dm-search" class="btn-primary">搜尋</button></div>'
    + '<div id="c-dm-result" style="margin-top:12px"></div></div>';

  document.getElementById("c-dm-search").onclick = async () => {
    const name = document.getElementById("c-dm-name").value.trim();
    if (!name) { toast("請輸入暱稱"); return; }
    const resultEl = document.getElementById("c-dm-result");
    resultEl.innerHTML = '<p style="color:#999">搜尋中…</p>';
    try {
      const r = await get("/chat/search?name=" + encodeURIComponent(name));
      const user = r.user || r.data?.user;
      if (user) {
        resultEl.innerHTML = '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f5f5f5;border-radius:8px">'
          + '<span>找到：<strong>' + esc(user.name || user.username) + '</strong></span>'
          + '<button id="c-dm-start" class="btn-primary" data-uid="' + esc(user.id) + '" data-name="' + esc(user.name || user.username) + '">開始聊天</button></div>';
        document.getElementById("c-dm-start").onclick = async (e) => {
          const btn = e.target;
          try {
            const cr = await post("/chat/conversations", { target_user_id: btn.dataset.uid });
            const conv = cr.conversation || cr.data?.conversation || cr;
            openChat("dm", conv.id || btn.dataset.uid, btn.dataset.name);
          } catch (err) {
            // 如果沒有這個 API，直接用 user id 開聊天
            openChat("dm", btn.dataset.uid, btn.dataset.name);
          }
        };
      } else {
        resultEl.innerHTML = '<p style="color:#999">找不到這個人，檢查一下暱稱拼對了嗎？</p>';
      }
    } catch (e) {
      resultEl.innerHTML = '<p style="color:#c0392b">搜尋失敗：' + esc(e.message) + '</p>';
    }
  };
}

function showGroupForm() {
  document.getElementById("c-form-area").innerHTML = '<div class="card" style="padding:16px;margin-bottom:16px">'
    + '<h4 style="margin:0 0 12px">發起群聊</h4>'
    + '<input id="c-group-name" placeholder="群聊名稱" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;margin-bottom:8px">'
    + '<button id="c-group-create" class="btn-primary">建立群聊</button>'
    + '<div id="c-group-result" style="margin-top:12px"></div></div>';

  document.getElementById("c-group-create").onclick = async () => {
    const name = document.getElementById("c-group-name").value.trim();
    if (!name) { toast("請輸入群聊名稱"); return; }
    try {
      const r = await post("/chat/groups", { name });
      const g = r.group || r.data?.group || r;
      toast("群聊建立成功！");
      openChat("group", g.id, name);
    } catch (e) {
      document.getElementById("c-group-result").innerHTML = '<p style="color:#c0392b">' + esc(e.message) + '</p>';
    }
  };
}

async function loadList() {
  const listEl = document.getElementById("c-list");
  if (!listEl) return;
  try {
    const [convs, groups] = await Promise.all([
      get("/chat/conversations").catch(() => ({ conversations: [] })),
      get("/chat/groups").catch(() => ({ groups: [] })),
    ]);
    const c = convs.conversations || convs.data?.conversations || [];
    const g = groups.groups || groups.data?.groups || [];
    if (!c.length && !g.length) {
      listEl.innerHTML = '<p style="color:#999;text-align:center;padding:20px">還沒有聊天，點上面開始第一個對話吧！</p>';
      return;
    }
    let html = "";
    for (const conv of c) {
      const name = conv.name || conv.target_name || "未知";
      html += '<div class="chat-item" data-type="dm" data-id="' + esc(conv.id) + '" data-name="' + esc(name) + '"'
        + ' style="padding:12px;border:1px solid #eee;border-radius:8px;margin-bottom:8px;cursor:pointer">'
        + '<strong>' + esc(name) + '</strong>'
        + (conv.last_message ? '<p style="margin:4px 0 0;font-size:13px;color:#666">' + esc(conv.last_message.slice(0, 30)) + '</p>' : "")
        + '</div>';
    }
    for (const grp of g) {
      html += '<div class="chat-item" data-type="group" data-id="' + esc(grp.id) + '" data-name="' + esc(grp.name) + '"'
        + ' style="padding:12px;border:1px solid #eee;border-radius:8px;margin-bottom:8px;cursor:pointer;background:#f9f9f9">'
        + '<strong>👥 ' + esc(grp.name) + '</strong></div>';
    }
    listEl.innerHTML = html;
    listEl.querySelectorAll(".chat-item").forEach(el => {
      el.onclick = () => openChat(el.dataset.type, el.dataset.id, el.dataset.name);
    });
  } catch (e) {
    listEl.innerHTML = '<p style="color:#c0392b">載入失敗：' + esc(e.message) + '</p>';
  }
}

/* ---- 聊天室 ---- */
async function openChat(type, id, name) {
  currentChat = { type, id, name };
  stopPolling();
  view.innerHTML = '<div style="margin-bottom:12px">'
    + '<button id="c-back" style="padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer">← 返回</button>'
    + '<h3 style="display:inline;margin-left:12px">' + esc(name) + '</h3></div>'
    + '<div id="c-messages" style="height:400px;overflow-y:auto;border:1px solid #eee;border-radius:8px;padding:12px;margin-bottom:12px;background:#fafafa">'
    + '<p style="color:#999;text-align:center">載入訊息中…</p></div>'
    + '<div style="display:flex;gap:8px">'
    + '<input id="c-input" placeholder="輸入訊息…" style="flex:1;padding:12px;border:1px solid #ddd;border-radius:8px">'
    + '<button id="c-send" class="btn-primary" style="padding:12px 24px">發送</button></div>';

  document.getElementById("c-back").onclick = () => showHome();
  document.getElementById("c-send").onclick = sendMessage;
  document.getElementById("c-input").onkeypress = (e) => {
    if (e.key === "Enter") sendMessage();
  };

  await loadMessages();
  // 每 5 秒自動刷新
  pollTimer = setInterval(loadMessages, 5000);
}

async function loadMessages() {
  if (!currentChat) return;
  const msgEl = document.getElementById("c-messages");
  if (!msgEl) return;
  try {
    const url = currentChat.type === "dm"
      ? "/chat/conversations/" + currentChat.id + "/messages"
      : "/chat/groups/" + currentChat.id + "/messages";
    const r = await get(url);
    const msgs = r.messages || r.data?.messages || [];
    if (!msgs.length) {
      msgEl.innerHTML = '<p style="color:#999;text-align:center">還沒有訊息，打個招呼吧！</p>';
      return;
    }
    // 記住滾動位置
    const wasAtBottom = msgEl.scrollHeight - msgEl.scrollTop <= msgEl.clientHeight + 50;
    msgEl.innerHTML = msgs.map(m => {
      const mine = m.is_mine || m.mine;
      return '<div style="margin-bottom:8px;text-align:' + (mine ? "right" : "left") + '">'
        + '<div style="display:inline-block;max-width:70%;padding:8px 12px;border-radius:12px;'
        + (mine ? "background:#1a1a1a;color:#fff" : "background:#fff;border:1px solid #eee") + '">'
        + esc(m.content || m.text || "") + '</div></div>';
    }).join("");
    if (wasAtBottom) msgEl.scrollTop = msgEl.scrollHeight;
  } catch (e) {
    // 靜默失敗，不打擾用戶
  }
}

async function sendMessage() {
  const input = document.getElementById("c-input");
  const text = input.value.trim();
  if (!text || !currentChat) return;
  input.value = "";
  input.disabled = true;
  try {
    const url = currentChat.type === "dm"
      ? "/chat/conversations/" + currentChat.id + "/messages"
      : "/chat/groups/" + currentChat.id + "/messages";
    await post(url, { content: text });
    await loadMessages();
  } catch (e) {
    toast("發送失敗：" + e.message);
    input.value = text; // 恢復輸入
  } finally {
    input.disabled = false;
    input.focus();
  }
}

/* ---- 初始化：用後端驗證登入 ---- */
(async function init() {
  if (!isLoggedIn()) {
    showLogin();
    return;
  }
  try {
    await get("/auth/me"); // 驗證 token 有效
    await showHome();
  } catch (e) {
    clearAuth(); // token 過期，清掉
    showLogin("登入已過期，請重新登入");
  }
})();
