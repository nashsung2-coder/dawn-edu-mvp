/* 即時通訊：極簡重寫版 */
import { get, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";

const view = document.getElementById("c-view");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function showLogin() {
  view.innerHTML = '<div style="text-align:center;padding:40px">'
    + '<p>請先登入再使用即時通訊</p>'
    + '<a href="settings.html" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:#fff;border-radius:8px;text-decoration:none">去登入</a>'
    + '</div>';
}

function showHome() {
  view.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">'
    + '<button id="c-go-dm" style="padding:32px 16px;font-size:18px;font-weight:800;background:#1a1a1a;color:#fff;border:none;border-radius:12px;cursor:pointer">個人聊天<br><span style="font-size:13px;font-weight:400;opacity:.8">輸入對方暱稱即可找到</span></button>'
    + '<button id="c-go-group" style="padding:32px 16px;font-size:18px;font-weight:800;background:#1a1a1a;color:#fff;border:none;border-radius:12px;cursor:pointer">發起群聊<br><span style="font-size:13px;font-weight:400;opacity:.8">建立多人聊天室</span></button>'
    + '</div>'
    + '<div id="c-form-area"></div>'
    + '<h3>我的聊天</h3><div id="c-list"><p>載入中...</p></div>';

  document.getElementById("c-go-dm").onclick = function() {
    document.getElementById("c-form-area").innerHTML = '<div style="border:1px solid #ddd;border-radius:12px;padding:20px">'
      + '<h3>個人聊天</h3>'
      + '<div style="display:flex;gap:8px"><input id="c-dm-name" placeholder="輸入對方暱稱" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px">'
      + '<button id="c-dm-go" style="padding:10px 20px;background:#1a1a1a;color:#fff;border:none;border-radius:8px;cursor:pointer">開始</button></div>'
      + '<p id="c-dm-msg" style="font-size:13px;color:#666"></p></div>';
    document.getElementById("c-dm-go").onclick = async function() {
      const name = document.getElementById("c-dm-name").value.trim();
      if (!name) return;
      try {
        const r = await get("/chat/search?name=" + encodeURIComponent(name));
        if (r.user) {
          document.getElementById("c-dm-msg").textContent = "找到：" + r.user.name;
        } else {
          document.getElementById("c-dm-msg").textContent = "找不到用戶";
        }
      } catch (e) {
        document.getElementById("c-dm-msg").textContent = "搜尋失敗：" + e.message;
      }
    };
  };

  document.getElementById("c-go-group").onclick = function() {
    document.getElementById("c-form-area").innerHTML = '<div style="border:1px solid #ddd;border-radius:12px;padding:20px">'
      + '<h3>發起群聊</h3><p>群聊功能開發中...</p></div>';
  };

  loadList();
}

async function loadList() {
  const listEl = document.getElementById("c-list");
  try {
    const convs = await get("/chat/conversations").catch(() => ({conversations: []}));
    const groups = await get("/chat/groups").catch(() => ({groups: []}));
    const c = convs.conversations || [];
    const g = groups.groups || [];
    if (c.length === 0 && g.length === 0) {
      listEl.innerHTML = "<p>還沒有聊天，開始第一個對話吧！</p>";
    } else {
      listEl.innerHTML = "<p>共有 " + (c.length + g.length) + " 個聊天</p>";
    }
  } catch (e) {
    listEl.innerHTML = "<p>載入失敗</p>";
  }
}

// 初始化
if (!view) {
  console.error("找不到 #c-view");
} else if (!isLoggedIn()) {
  showLogin();
} else {
  showHome();
}
