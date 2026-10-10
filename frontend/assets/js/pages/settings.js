/* 設定 / 個人中心：個人資料 / 人格設定 / 修改密碼 / 安全問題 /
 * 自由屬性點 / 心流存款 / 匯出學習歷程 / 登出
 * 全鏈路調真實後端，零假數據。
 * 生命週期：init → loading → api → render / empty / error
 */
import { swr, post, get, put } from "../core/api.js";
import { setToken, clearAuth, isLoggedIn } from "../core/auth.js";
import { broadcast } from "../core/sync.js";
import { announce } from "../core/a11y.js";

const view = document.getElementById("s-view");
const userline = document.getElementById("s-userline");
const params = new URLSearchParams(location.search);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function skeleton() {
  view.innerHTML = `<div class="skeleton" style="height:80px"></div>
    <div class="skeleton" style="height:20px;margin-top:12px"></div>`;
}

function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="s-retry">重試</button></div>`;
  document.getElementById("s-retry").onclick = retry;
}

/* 單一表單的錯誤/成功回饋列 */
function feedbackHtml(id) {
  return `<p id="${id}" style="font-size:13px;min-height:1.2em" role="alert" aria-live="polite"></p>`;
}
function setFeedback(id, msg, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? "#1B7A3D" : "#B3261E";
  if (msg) announce(msg);
}
function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || "處理中…"; }
  else { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
}

/* ================= 登入 / 註冊（保持現有邏輯） ================= */

function renderAuth(mode = "login") {
  if (params.get("reason") === "login") {
    announce("登入已過期，請重新登入");
  }
  view.innerHTML = `
    <div class="s-tabs" role="tablist" aria-label="登入或註冊">
      <button role="tab" aria-selected="${mode === "login"}" id="tab-login">登入</button>
      <button role="tab" aria-selected="${mode === "register"}" id="tab-register">註冊</button>
    </div>
    <form class="s-form" id="s-form" novalidate>
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
    if (!name) { errEl.textContent = "請輸入暱稱"; return; }
    if (password.length < 4) { errEl.textContent = "密碼至少 4 個字元"; return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = "Email 格式不正確"; return; }
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
    } catch (err) {
      errEl.textContent = `失敗：${err.message}`;
    }
  };
}

/* ================= 個人中心 ================= */

async function renderProfile() {
  skeleton();
  // 三路並行載入，單一路失敗不拖累其他
  const [meR, ptsR, badgeR] = await Promise.allSettled([
    swr("auth:me", "/auth/me"),
    swr("world:attr-points", "/world/attr-points"),
    swr("learn:badges", "/learn/badges"),
  ]);
  if (meR.status === "rejected") {
    userline.textContent = "載入失敗";
    errorView(`讀取個人資料失敗：${meR.reason.message}`, renderProfile);
    return;
  }
  const me = meR.value.data?.user || meR.value.data || {};
  if (meR.value.stale) announce("顯示快取資料，更新中");
  const points = ptsR.status === "fulfilled" ? (ptsR.value.data?.points ?? 0) : null;
  const badges = badgeR.status === "fulfilled"
    ? (badgeR.value.data?.badges || badgeR.value.data || []) : null;

  userline.textContent = `旅人 ${me.name || ""}`;
  renderSections(me, points, badges);
  bindPersona(me);
  bindPassword();
  bindSecQa(me);
  bindAttrPoints(me, points, badges);
  bindFlowDeposit(me);
  bindFooter();
}

function sectionCard(title, inner) {
  return `<section class="card" style="margin-bottom:16px" aria-label="${escapeHtml(title)}">
    <h2 style="font-size:17px;margin-bottom:12px">${escapeHtml(title)}</h2>${inner}</section>`;
}

function renderSections(me, points, badges) {
  const persona = me.persona || {};
  const hasPersona = persona && (persona.role_name || persona.role);
  const personaSummary = hasPersona
    ? `${persona.role_name || ""}${persona.role ? `（${persona.role}）` : ""}`
    : "尚未設定人格";

  const ptsHtml = points === null
    ? `<p style="color:var(--muted)">讀取失敗，稍後再試。</p>`
    : `<p style="font-size:28px;font-weight:700">✨ ${points} <span style="font-size:14px;font-weight:400">點</span></p>
       <p style="color:var(--muted);font-size:13px">自由屬性點可投入武器，提升攻擊 / 防禦 / 羈絆。</p>`;

  const badgeOpts = (badges && badges.length)
    ? badges.map(b => {
        const id = b.id || b.badge_id || "";
        const nm = b.name || b.badge_name || id;
        return `<option value="${escapeHtml(id)}">${escapeHtml(nm)}</option>`;
      }).join("")
    : `<option value="">尚無武器</option>`;
  const badgeHint = (badges && badges.length)
    ? ""
    : `<p style="color:var(--muted);font-size:13px">尚無武器（技能章）。去 <a href="quiz.html">費曼戰役</a> 挑戰並授勳後，就能在這裡加乘。</p>`;

  view.innerHTML = `
  ${sectionCard("個人資料", `
    <div class="s-row"><span>暱稱</span><span>${escapeHtml(me.name || "—")}</span></div>
    <div class="s-row"><span>Email</span><span>${escapeHtml(me.email || "未設定")}</span></div>
    <div class="s-row"><span>人格</span><span id="s-persona-summary">${escapeHtml(personaSummary)}</span></div>
    <div class="s-row"><span>安全問題</span><span id="s-secqa-status">${me.sec_question ? "已設定" : "未設定"}</span></div>
    <div class="s-row"><span>加入時間</span><span>${escapeHtml((me.created_at || "").slice(0, 10) || "—")}</span></div>`)}

  ${sectionCard("引路人格", `
    <p style="color:var(--muted);font-size:13px;margin-bottom:12px">引路儀式決定 AI 引導你的方式。隨時可以在這裡調整。</p>
    <form class="s-form" id="f-persona" novalidate>
      <div><label for="p-role-name">角色名稱</label>
        <input id="p-role-name" maxlength="20" placeholder="例如：求道者" value="${escapeHtml(persona.role_name || "")}" required></div>
      <div><label for="p-role">角色代號</label>
        <input id="p-role" maxlength="32" placeholder="例如：seeker（英文小寫）" value="${escapeHtml(persona.role || "")}" required></div>
      <div><label for="p-axes">特質軸（以逗號分隔，選填）</label>
        <input id="p-axes" maxlength="120" placeholder="例如：好奇, 堅毅"
          value="${escapeHtml(Array.isArray(persona.axes) ? persona.axes.join(", ") : "")}"></div>
      <button class="btn btn-primary" type="submit" id="p-save">儲存人格</button>
      ${feedbackHtml("p-fb")}
    </form>`)}

  ${sectionCard("修改密碼", `
    <form class="s-form" id="f-password" novalidate>
      <div><label for="pw-old">舊密碼</label>
        <input id="pw-old" type="password" autocomplete="current-password" required></div>
      <div><label for="pw-new">新密碼（至少 4 個字元）</label>
        <input id="pw-new" type="password" autocomplete="new-password" required minlength="4"></div>
      <div><label for="pw-confirm">確認新密碼</label>
        <input id="pw-confirm" type="password" autocomplete="new-password" required minlength="4"></div>
      <button class="btn btn-primary" type="submit" id="pw-save">修改密碼</button>
      ${feedbackHtml("pw-fb")}
    </form>`)}

  ${sectionCard("安全問題", `
    <p style="color:var(--muted);font-size:13px;margin-bottom:12px">忘記密碼時用來驗證身份。${me.sec_question ? `目前問題：<strong>${escapeHtml(me.sec_question)}</strong>` : "尚未設定。"}</p>
    <form class="s-form" id="f-secqa" novalidate>
      <div><label for="sq-q">安全問題</label>
        <input id="sq-q" maxlength="100" placeholder="例如：你的第一隻寵物叫什麼？" value="${escapeHtml(me.sec_question || "")}" required></div>
      <div><label for="sq-a">答案</label>
        <input id="sq-a" maxlength="100" placeholder="請記住你的答案" required></div>
      <button class="btn btn-primary" type="submit" id="sq-save">儲存安全問題</button>
      ${feedbackHtml("sq-fb")}
    </form>`)}

  ${sectionCard("自由屬性點", `
    ${ptsHtml}
    <form class="s-form" id="f-attr" novalidate style="margin-top:12px">
      <div><label for="a-badge">投入武器</label>
        <select id="a-badge" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;font-size:14px">${badgeOpts}</select></div>
      ${badgeHint}
      <div><label for="a-points">投入點數</label>
        <input id="a-points" type="number" min="1" inputmode="numeric" placeholder="例如：5" required></div>
      <div><label for="a-route">加乘方向</label>
        <select id="a-route" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;font-size:14px">
          <option value="attack">攻擊</option>
          <option value="defense">防禦</option>
          <option value="bond">羈絆</option>
        </select></div>
      <button class="btn btn-primary" type="submit" id="a-spend">投入屬性點</button>
      ${feedbackHtml("a-fb")}
    </form>`)}

  ${sectionCard("心流存款", `
    <p style="color:var(--muted);font-size:13px;margin-bottom:12px">把此刻的心流寫下來，沉積為滋養島嶼的細土。</p>
    <form class="s-form" id="f-flow" novalidate>
      <div><label for="fl-type">事件類型</label>
        <select id="fl-type" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;font-size:14px">
          <option value="reflection">學習反思</option>
          <option value="flow">心流時刻</option>
          <option value="insight">靈感捕捉</option>
          <option value="review">每日回顧</option>
        </select></div>
      <div><label for="fl-note">內容（至少 5 個字）</label>
        <textarea id="fl-note" rows="4" maxlength="2000" placeholder="寫下你剛才的專注、領悟或困惑…"
          style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;font-size:14px" required></textarea></div>
      <div><label for="fl-focus">專注度（1–10，選填）</label>
        <input id="fl-focus" type="number" min="1" max="10" inputmode="numeric" placeholder="例如：8"></div>
      <button class="btn btn-primary" type="submit" id="fl-save">存入心流細土</button>
      ${feedbackHtml("fl-fb")}
    </form>`)}

  ${sectionCard("帳號操作", `
    <button class="btn" id="s-export" style="width:100%;margin-bottom:8px">匯出學習歷程（JSON）</button>
    <button class="btn btn-ghost" id="s-switch-device" style="width:100%;margin-bottom:8px">切換裝置版本（目前：${deviceLabel()}）</button>
    <button class="btn btn-ghost" id="s-logout" style="width:100%;color:#B3261E">登出</button>
    ${feedbackHtml("s-fb")}`)}`;
}

function deviceLabel() {
  try { return localStorage.getItem("dawn.device") === "mobile" ? "手機" : "電腦/平板"; }
  catch (e) { return "電腦/平板"; }
}

/* ---- 人格設定 ---- */
function bindPersona(me) {
  const form = document.getElementById("f-persona");
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("p-save");
    const roleName = document.getElementById("p-role-name").value.trim();
    const role = document.getElementById("p-role").value.trim();
    const axesRaw = document.getElementById("p-axes").value.trim();
    if (!roleName) { setFeedback("p-fb", "請輸入角色名稱", false); return; }
    if (!role) { setFeedback("p-fb", "請輸入角色代號", false); return; }
    if (!/^[a-z0-9_-]{1,32}$/i.test(role)) { setFeedback("p-fb", "角色代號請用英數字、底線或連字號", false); return; }
    const axes = axesRaw ? axesRaw.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : [];
    setBusy(btn, true);
    setFeedback("p-fb", "", true);
    try {
      const r = await post("/auth/persona", {
        persona: { role, role_name: roleName, axes, choices: [], at: new Date().toISOString().slice(0, 10) },
      });
      const saved = r.persona || {};
      setFeedback("p-fb", `人格已儲存：${saved.role_name || roleName}`, true);
      const sumEl = document.getElementById("s-persona-summary");
      if (sumEl) sumEl.textContent = `${saved.role_name || roleName}${saved.role ? `（${saved.role}）` : ""}`;
      broadcast({ type: "cache:invalidate", keys: ["auth:me"] });
    } catch (err) {
      setFeedback("p-fb", `儲存失敗：${err.message}`, false);
    } finally {
      setBusy(btn, false);
    }
  };
}

/* ---- 修改密碼 ---- */
function bindPassword() {
  const form = document.getElementById("f-password");
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("pw-save");
    const oldPw = document.getElementById("pw-old").value;
    const newPw = document.getElementById("pw-new").value;
    const confirm = document.getElementById("pw-confirm").value;
    if (!oldPw) { setFeedback("pw-fb", "請輸入舊密碼", false); return; }
    if (newPw.length < 4) { setFeedback("pw-fb", "新密碼至少 4 個字元", false); return; }
    if (newPw === oldPw) { setFeedback("pw-fb", "新密碼不能和舊密碼相同", false); return; }
    if (newPw !== confirm) { setFeedback("pw-fb", "兩次輸入的新密碼不一致", false); return; }
    setBusy(btn, true);
    setFeedback("pw-fb", "", true);
    try {
      await post("/auth/password", { old_password: oldPw, new_password: newPw });
      form.reset();
      setFeedback("pw-fb", "密碼修改成功", true);
    } catch (err) {
      setFeedback("pw-fb", `修改失敗：${err.message}`, false);
    } finally {
      setBusy(btn, false);
    }
  };
}

/* ---- 安全問題 ---- */
function bindSecQa() {
  const form = document.getElementById("f-secqa");
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("sq-save");
    const q = document.getElementById("sq-q").value.trim();
    const a = document.getElementById("sq-a").value.trim();
    if (q.length < 2) { setFeedback("sq-fb", "請輸入安全問題", false); return; }
    if (a.length < 1) { setFeedback("sq-fb", "請輸入答案", false); return; }
    setBusy(btn, true);
    setFeedback("sq-fb", "", true);
    try {
      const r = await put("/auth/security-qa", { sec_question: q, sec_answer: a });
      document.getElementById("sq-a").value = "";
      setFeedback("sq-fb", r.reason || "安全問題已更新", true);
      const stEl = document.getElementById("s-secqa-status");
      if (stEl) stEl.textContent = "已設定";
      broadcast({ type: "cache:invalidate", keys: ["auth:me"] });
    } catch (err) {
      setFeedback("sq-fb", `儲存失敗：${err.message}`, false);
    } finally {
      setBusy(btn, false);
    }
  };
}

/* ---- 自由屬性點：顯示 + 分配 ---- */
function bindAttrPoints(me, points, badges) {
  const form = document.getElementById("f-attr");
  if (!form) return;
  const btn = document.getElementById("a-spend");
  const hasWeapon = badges && badges.length > 0;
  if (points === 0 || points === null || !hasWeapon) {
    btn.disabled = true;
    if (points === 0) setFeedback("a-fb", "目前沒有可分配的屬性點，完成學習任務可獲得。", false);
    return;
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const badgeId = document.getElementById("a-badge").value;
    const pts = parseInt(document.getElementById("a-points").value, 10);
    const route = document.getElementById("a-route").value;
    if (!badgeId) { setFeedback("a-fb", "請選擇要加乘的武器", false); return; }
    if (!Number.isInteger(pts) || pts < 1) { setFeedback("a-fb", "請輸入至少 1 點", false); return; }
    if (pts > points) { setFeedback("a-fb", `點數不足，你只有 ${points} 點`, false); return; }
    setBusy(btn, true);
    setFeedback("a-fb", "", true);
    try {
      const r = await post("/world/attr-points/spend", { badge_id: badgeId, points: pts, route });
      const left = r.points ?? r.remaining ?? (points - pts);
      setFeedback("a-fb", `投入成功！${r.reason || ""}（剩餘 ${left} 點）`, true);
      broadcast({ type: "cache:invalidate", keys: ["world:attr-points", "learn:badges"] });
      renderProfile(); // 重載以更新點數顯示
    } catch (err) {
      setFeedback("a-fb", `投入失敗：${err.message}`, false);
      setBusy(btn, false);
    }
  };
}

/* ---- 心流存款 ---- */
function bindFlowDeposit(me) {
  const form = document.getElementById("f-flow");
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("fl-save");
    const eventType = document.getElementById("fl-type").value;
    const note = document.getElementById("fl-note").value.trim();
    const focusRaw = document.getElementById("fl-focus").value.trim();
    if (note.length < 5) { setFeedback("fl-fb", "內容至少寫 5 個字", false); return; }
    let focusScore;
    if (focusRaw) {
      focusScore = parseInt(focusRaw, 10);
      if (!Number.isInteger(focusScore) || focusScore < 1 || focusScore > 10) {
        setFeedback("fl-fb", "專注度請填 1–10", false); return;
      }
    }
    setBusy(btn, true);
    setFeedback("fl-fb", "", true);
    try {
      const body = { user_id: me.id, event_type: eventType, note };
      if (focusScore !== undefined) body.focus_score = focusScore;
      const r = await post("/flow-deposits", body, { idempotent: true });
      form.reset();
      setFeedback("fl-fb", r.reason || "心流細土已存入", true);
    } catch (err) {
      setFeedback("fl-fb", `存入失敗：${err.message}`, false);
    } finally {
      setBusy(btn, false);
    }
  };
}

/* ---- 匯出 / 切換裝置 / 登出 ---- */
function bindFooter() {
  document.getElementById("s-switch-device").onclick = () => {
    try { localStorage.removeItem("dawn.device"); } catch (e) {}
    location.href = "../index.html";
  };
  document.getElementById("s-logout").onclick = () => {
    clearAuth();
    broadcast({ type: "auth:logout" });
    announce("已登出");
    renderAuth("login");
  };
  document.getElementById("s-export").onclick = async () => {
    const btn = document.getElementById("s-export");
    setBusy(btn, true, "匯出中…");
    setFeedback("s-fb", "", true);
    try {
      const data = await get("/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dawn-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setFeedback("s-fb", "匯出完成", true);
    } catch (err) {
      setFeedback("s-fb", `匯出失敗：${err.message}`, false);
    } finally {
      setBusy(btn, false);
    }
  };
}

/* ---- 啟動 ---- */
(async function init() {
  if (isLoggedIn()) renderProfile();
  else renderAuth("login");
})();
