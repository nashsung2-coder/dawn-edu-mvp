/* 設定頁：登入 / 註冊 / 個人資料 / 登出。全調真實後端。 */
import { swr, post } from "../core/api.js";
import { getToken, setToken, clearAuth, isLoggedIn } from "../core/auth.js";
import { broadcast } from "../core/sync.js";
import { announce } from "../core/a11y.js";

const view = document.getElementById("s-view");
const userline = document.getElementById("s-userline");
const params = new URLSearchParams(location.search);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderAuth(mode = "login") {
  if (params.get("reason") === "login") {
    announce("登入已過期，請重新登入");
  }
  view.innerHTML = `
    <div class="s-tabs" role="tablist">
      <button role="tab" aria-selected="${mode === "login"}" id="tab-login">登入</button>
      <button role="tab" aria-selected="${mode === "register"}" id="tab-register">註冊</button>
    </div>
    <form class="s-form" id="s-form">
      <div><label for="s-name">暱稱</label>
        <input id="s-name" autocomplete="username" required minlength="1" maxlength="20"></div>
      <div><label for="s-pass">密碼</label>
        <input id="s-pass" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required minlength="4"></div>
      ${mode === "register" ? `<div><label for="s-email">Email（選填）</label>
        <input id="s-email" type="email" autocomplete="email"></div>` : ""}
      <button class="btn btn-primary" type="submit">${mode === "login" ? "登入" : "註冊"}</button>
      <p id="s-err" style="color:#B3261E;font-size:13px" role="alert"></p>
    </form>`;
  userline.textContent = "未登入";

  document.getElementById("tab-login").onclick = () => renderAuth("login");
  document.getElementById("tab-register").onclick = () => renderAuth("register");
  document.getElementById("s-form").onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById("s-name").value.trim();
    const password = document.getElementById("s-pass").value;
    const email = document.getElementById("s-email")?.value.trim() || "";
    const errEl = document.getElementById("s-err");
    errEl.textContent = "";
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const body = mode === "login" ? { name, password } : { name, password, email };
      const r = await post(path, body);
      const token = r.token || r.access_token;
      if (!token) throw new Error("後端未回傳 token");
      setToken(token);
      broadcast({ type: "cache:invalidate", keys: ["auth:me", "game:state"] });
      announce(mode === "login" ? "登入成功" : "註冊成功");
      renderProfile();
    } catch (e) {
      errEl.textContent = `失敗：${e.message}`;
    }
  };
}

async function renderProfile() {
  view.innerHTML = `<div class="skeleton" style="height:80px"></div>`;
  try {
    const r = await swr("auth:me", "/auth/me");
    const me = r.data || {};
    if (r.stale) announce("顯示快取資料，更新中");
    userline.textContent = `旅人 ${me.name || ""}`;
    view.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="s-row"><span>暱稱</span><span>${escapeHtml(me.name)}</span></div>
        <div class="s-row"><span>Email</span><span>${escapeHtml(me.email || "未設定")}</span></div>
        <div class="s-row"><span>等級</span><span>Lv.${me.level ?? 1}</span></div>
      </div>
      <button class="btn" id="s-export" style="width:100%;margin-bottom:8px">匯出學習歷程</button>
      <button class="btn btn-ghost" id="s-logout" style="width:100%">登出</button>`;
    document.getElementById("s-logout").onclick = () => {
      clearAuth();
      broadcast({ type: "auth:logout" });
      announce("已登出");
      renderAuth("login");
    };
    document.getElementById("s-export").onclick = async () => {
      try {
        const data = await post("/export", {});
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "dawn-export.json";
        a.click();
        announce("匯出完成");
      } catch (e) { announce(`匯出失敗：${e.message}`); }
    };
  } catch (e) {
    userline.textContent = "載入失敗";
    view.innerHTML = `<div class="state-error">
      <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
      <p>讀取個人資料失敗：${escapeHtml(e.message)}</p>
      <button class="btn btn-primary" id="s-retry">重試</button></div>`;
    document.getElementById("s-retry").onclick = renderProfile;
  }
}

(async function init() {
  if (isLoggedIn()) renderProfile();
  else renderAuth("login");
})();
