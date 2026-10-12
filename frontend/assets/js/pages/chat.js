/* 即時通訊 v3.0（Supabase 直連版）
 * 不再經 Render 後端，直接讀寫 Supabase
 * 功能：搜尋用戶 → 開始對話 → 發送訊息 → 自動刷新
 */
import { supabase, getUser } from "../core/supabase.js";
import { isLoggedIn } from "../core/auth.js";
import { toast } from "../core/a11y.js";

const view = document.getElementById("c-view");
if (!view) throw new Error("找不到 #c-view");

let currentChat = null; // { type: 'dm'|'group', id, name }
let pollTimer = null;
let myUserId = null;

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
      // 直查 profiles 表
      const { data: users, error } = await supabase
        .from("profiles")
        .select("id, name")
        .ilike("name", `%${name}%`)
        .neq("id", myUserId)
        .limit(5);
      if (error) throw error;
      if (users && users.length) {
        resultEl.innerHTML = users.map(u =>
          '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f5f5f5;border-radius:8px;margin-bottom:8px">'
          + '<span>找到：<strong>' + esc(u.name || "無名") + '</strong></span>'
          + '<button class="btn-primary c-dm-start" data-uid="' + esc(u.id) + '" data-name="' + esc(u.name || "無名") + '">開始聊天</button></div>'
        ).join("");
        resultEl.querySelectorAll(".c-dm-start").forEach(btn => {
          btn.onclick = () => startDm(btn.dataset.uid, btn.dataset.name);
        });
      } else {
        resultEl.innerHTML = '<p style="color:#999">找不到這個人，檢查一下暱稱拼對了嗎？</p>';
      }
    } catch (e) {
      resultEl.innerHTML = '<p style="color:#c0392b">搜尋失敗：' + esc(e.message) + '</p>';
    }
  };
}

/* 開始 1 對 1 聊天：找現有對話或建立新的 */
async function startDm(targetUserId, targetName) {
  try {
    // 找兩人已有的 dm 對話
    const { data: myConvs } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", myUserId);
    const myConvIds = (myConvs || []).map(m => m.conversation_id);
    if (myConvIds.length) {
      const { data: shared } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", targetUserId)
        .in("conversation_id", myConvIds);
      if (shared && shared.length) {
        // 檢查是否為 dm（非群組）
        const { data: conv } = await supabase
          .from("conversations")
          .select("id")
          .eq("id", shared[0].conversation_id)
          .eq("is_group", false)
          .single();
        if (conv) {
          openChat("dm", conv.id, targetName);
          return;
        }
      }
    }
    // 建立新對話
    const { data: newConv, error: cErr } = await supabase
      .from("conversations")
      .insert({ is_group: false, title: targetName })
      .select("id")
      .single();
    if (cErr) throw cErr;
    const { error: mErr } = await supabase
      .from("conversation_members")
      .insert([
        { conversation_id: newConv.id, user_id: myUserId },
        { conversation_id: newConv.id, user_id: targetUserId },
      ]);
    if (mErr) throw mErr;
    openChat("dm", newConv.id, targetName);
  } catch (e) {
    toast("建立對話失敗：" + e.message);
  }
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
      const { data: newGroup, error: gErr } = await supabase
        .from("conversations")
        .insert({ is_group: true, title: name })
        .select("id")
        .single();
      if (gErr) throw gErr;
      const { error: mErr } = await supabase
        .from("conversation_members")
        .insert({ conversation_id: newGroup.id, user_id: myUserId });
      if (mErr) throw mErr;
      toast("群聊建立成功！");
      openChat("group", newGroup.id, name);
    } catch (e) {
      document.getElementById("c-group-result").innerHTML = '<p style="color:#c0392b">' + esc(e.message) + '</p>';
    }
  };
}

async function loadList() {
  const listEl = document.getElementById("c-list");
  if (!listEl) return;
  try {
    // 我的所有對話
    const { data: memberships, error: mErr } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", myUserId);
    if (mErr) throw mErr;
    const convIds = (memberships || []).map(m => m.conversation_id);
    if (!convIds.length) {
      listEl.innerHTML = '<p style="color:#999;text-align:center;padding:20px">還沒有聊天，點上面開始第一個對話吧！</p>';
      return;
    }
    const { data: convs, error: cErr } = await supabase
      .from("conversations")
      .select("id, is_group, title, created_at")
      .in("id", convIds)
      .order("created_at", { ascending: false });
    if (cErr) throw cErr;

    if (!convs || !convs.length) {
      listEl.innerHTML = '<p style="color:#999;text-align:center;padding:20px">還沒有聊天，點上面開始第一個對話吧！</p>';
      return;
    }

    // 為每個 dm 找出對方名稱
    let html = "";
    for (const conv of convs) {
      let displayName = conv.title || "群聊";
      if (!conv.is_group) {
        try {
          const { data: members } = await supabase
            .from("conversation_members")
            .select("user_id")
            .eq("conversation_id", conv.id)
            .neq("user_id", myUserId)
            .limit(1);
          if (members && members.length) {
            const { data: prof } = await supabase
              .from("profiles")
              .select("name")
              .eq("id", members[0].user_id)
              .single();
            if (prof) displayName = prof.name || conv.title || "未知";
          }
        } catch (e) { /* 用預設名稱 */ }
      }
      html += '<div class="chat-item" data-type="' + (conv.is_group ? "group" : "dm") + '" data-id="' + esc(conv.id) + '" data-name="' + esc(displayName) + '"'
        + ' style="padding:12px;border:1px solid #eee;border-radius:8px;margin-bottom:8px;cursor:pointer'
        + (conv.is_group ? ";background:#f9f9f9" : "") + '">'
        + '<strong>' + (conv.is_group ? "👥 " : "") + esc(displayName) + '</strong>'
        + '</div>';
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
    const { data: msgs, error } = await supabase
      .from("messages")
      .select("id, content, sender_id, created_at")
      .eq("conversation_id", currentChat.id)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    if (!msgs || !msgs.length) {
      msgEl.innerHTML = '<p style="color:#999;text-align:center">還沒有訊息，打個招呼吧！</p>';
      return;
    }
    const wasAtBottom = msgEl.scrollHeight - msgEl.scrollTop <= msgEl.clientHeight + 50;
    msgEl.innerHTML = msgs.map(m => {
      const mine = m.sender_id === myUserId;
      return '<div style="margin-bottom:8px;text-align:' + (mine ? "right" : "left") + '">'
        + '<div style="display:inline-block;max-width:70%;padding:8px 12px;border-radius:12px;'
        + (mine ? "background:#1a1a1a;color:#fff" : "background:#fff;border:1px solid #eee") + '">'
        + esc(m.content || "") + '</div></div>';
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
    const { error } = await supabase
      .from("messages")
      .insert({
        conversation_id: currentChat.id,
        sender_id: myUserId,
        content: text,
      });
    if (error) throw error;
    await loadMessages();
  } catch (e) {
    toast("發送失敗：" + e.message);
    input.value = text;
  } finally {
    input.disabled = false;
    input.focus();
  }
}

/* ---- 初始化：用 Supabase 驗證登入 ---- */
(async function init() {
  if (!isLoggedIn()) {
    showLogin();
    return;
  }
  try {
    const user = await getUser();
    if (!user) throw new Error("無法取得使用者");
    myUserId = user.id;
    await showHome();
  } catch (e) {
    showLogin("登入已過期，請重新登入");
  }
})();
