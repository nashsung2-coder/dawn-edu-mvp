/* ============================================================
 * 曙光教育智能系統 MVP · 慢荒宇宙
 * app.js — 前端互動邏輯（純靜態，無依賴）
 * ============================================================ */
"use strict";

/* ---------------- 全域小工具 ---------------- */
function $(id) { return document.getElementById(id); }

let toastTimer = null;
function toast(msg, ms) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms || 2400);
}

/* 簡單可重現的偽隨機（島嶼植被用） */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 星空背景 ---------------- */
(function initStarfield() {
  const cv = $("starfield");
  const ctx = cv.getContext("2d");
  let stars = [];
  function resize() {
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    stars = Array.from({ length: Math.min(220, cv.width / 6) }, () => ({
      x: Math.random() * cv.width,
      y: Math.random() * cv.height,
      r: Math.random() * 1.4 + 0.3,
      p: Math.random() * Math.PI * 2,
      s: 0.5 + Math.random() * 1.5,
    }));
  }
  window.addEventListener("resize", resize);
  resize();
  let shoot = null;
  function frame(t) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const st of stars) {
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(t / 1000 * st.s + st.p));
      ctx.globalAlpha = tw;
      ctx.fillStyle = "#cfe6ff";
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 偶爾一顆流星
    if (!shoot && Math.random() < 0.004) {
      shoot = { x: Math.random() * cv.width * 0.7, y: Math.random() * cv.height * 0.3, life: 1 };
    }
    if (shoot) {
      shoot.x += 9; shoot.y += 4; shoot.life -= 0.03;
      const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - 70, shoot.y - 30);
      g.addColorStop(0, "rgba(200,230,255," + Math.max(shoot.life, 0) + ")");
      g.addColorStop(1, "rgba(200,230,255,0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(shoot.x, shoot.y);
      ctx.lineTo(shoot.x - 70, shoot.y - 30);
      ctx.stroke();
      if (shoot.life <= 0) shoot = null;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ---------------- 分頁切換（v2：4 主分頁＋子頁 Segmented） ---------------- */
const SUB2GROUP = {
  explore: "study", learn: "study", textbook: "study",
  qa: "trial", radar: "trial", duel: "trial",
  island: "world", journey: "world", market: "world", weekly: "world",
  account: "me", armory: "me",
};
const GROUP_FIRST_SUB = { study: "explore", trial: "qa", world: "island", me: "account" };
const groupLastSub = {}; // 記住每組最後看的子頁

function runSubInit(name) {
  if (name === "island") { loadIsland(); WorldUI.loadPet(); WorldUI.loadLearnIslands(); }
  if (name === "textbook") buildTextbook();
  if (name === "radar") Game.refresh();
  if (name === "account") buildAccount();
  if (name === "learn") WorldUI.initLearn();
  if (name === "journey") WorldUI.initJourney();
  if (name === "market") WorldUI.initMarket();
  if (name === "weekly") WorldUI.initWeekly();
  if (name === "armory" && WorldUI.initArmory) WorldUI.initArmory();
}

function showSub(name) {
  const group = SUB2GROUP[name];
  if (!group) return;
  groupLastSub[group] = name;
  document.querySelectorAll("#mainNav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === group)
  );
  document.querySelectorAll(".tab-page").forEach((p) =>
    p.classList.toggle("active", p.id === "group-" + group)
  );
  const seg = $("seg-" + group);
  if (seg) seg.querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.sub === name)
  );
  document.querySelectorAll(".sub-page").forEach((p) =>
    p.classList.toggle("active", p.id === "page-" + name)
  );
}

function gotoTab(name) {
  // 相容舊呼叫：子頁名 → 所在主分組
  if (!SUB2GROUP[name]) return;
  showSub(name);
  window.scrollTo({ top: 0, behavior: "smooth" });
  runSubInit(name);
}

function gotoGroup(group) {
  const sub = groupLastSub[group] || GROUP_FIRST_SUB[group];
  gotoTab(sub);
}

(function initTabs() {
  const nav = $("mainNav");
  nav.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    const group = btn.dataset.tab;
    if (btn.classList.contains("active")) {
      // 點已選中的主分頁 → 捲到子頁快捷（簡化版）
      const seg = $("seg-" + group);
      if (seg) seg.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    gotoGroup(group);
  });
  // 子頁 Segmented Control 委派
  document.querySelectorAll(".segmented").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-sub]");
      if (!btn || btn.classList.contains("active")) return;
      gotoTab(btn.dataset.sub);
    });
  });
})();

/* ============================================================
 * 分頁 1：探究（交集搜尋）
 * ============================================================ */
const exploreState = {
  stage: "all",
  mode: "weighted",
  selected: new Set(), // "DIM:value"
  favorites: new Set(),
};

function tagKey(dim, value) { return dim + ":" + value; }

// 手風琴展開狀態（預設展開第一個維度）
const dimOpen = new Set(["SUBJ"]);

function buildExploreFilters() {
  // 搜尋模式
  const modeRow = $("modeRow");
  modeRow.innerHTML = "";
  SEARCH_MODES.forEach((m) => {
    const b = document.createElement("button");
    b.className = "mode-chip" + (exploreState.mode === m.id ? " active" : "");
    b.title = m.desc;
    b.innerHTML = "<strong>" + m.name + "</strong> <span style='opacity:.7'>· " + m.desc + "</span>";
    b.onclick = () => { exploreState.mode = m.id; buildExploreFilters(); renderExplore(); };
    modeRow.appendChild(b);
  });

  // 維度分組：可收合手風琴 ＋ 已選摘要列
  const wrap = $("dimFilters");
  wrap.innerHTML = "";
  const order = ["SUBJ", "CONC", "COGN", "STAGE", "LIFE", "INTER", "DIFF"];
  order.forEach((dim) => {
    const values = [...new Set(SEED_CONTENTS.flatMap((c) =>
      c.tags.filter((t) => t.dim === dim).map((t) => t.value)
    ))].sort();
    if (!values.length) return;
    const selCount = values.filter((v) => exploreState.selected.has(tagKey(dim, v))).length;
    const expanded = selCount > 0 || dimOpen.has(dim);
    const g = document.createElement("div");
    g.className = "dim-group";
    g.dataset.dim = dim;
    const head = document.createElement("button");
    head.type = "button";
    head.className = "dim-head" + (expanded ? "" : " closed");
    head.setAttribute("aria-expanded", expanded ? "true" : "false");
    head.innerHTML =
      '<span class="dim-name">' + dim + " · " + DIM_NAMES[dim] + "</span>" +
      '<span class="dim-count"' + (selCount ? "" : ' style="display:none"') + ">" + selCount + "</span>" +
      '<span class="dim-chev">›</span>';
    const list = document.createElement("div");
    list.className = "tag-list" + (expanded ? "" : " collapsed");
    values.forEach((v) => {
      const key = tagKey(dim, v);
      const label = document.createElement("label");
      label.className = "tag-check" + (exploreState.selected.has(key) ? " on" : "");
      label.dataset.key = key;
      label.innerHTML = '<input type="checkbox">' + v;
      label.querySelector("input").checked = exploreState.selected.has(key);
      label.onclick = (e) => {
        e.preventDefault();
        if (exploreState.selected.has(key)) exploreState.selected.delete(key);
        else exploreState.selected.add(key);
        label.classList.toggle("on", exploreState.selected.has(key));
        refreshFilterUI();
        renderExplore();
      };
      list.appendChild(label);
    });
    head.onclick = () => {
      const collapsed = list.classList.toggle("collapsed");
      head.classList.toggle("closed", collapsed);
      head.setAttribute("aria-expanded", collapsed ? "false" : "true");
      if (collapsed) dimOpen.delete(dim); else dimOpen.add(dim);
    };
    g.appendChild(head);
    g.appendChild(list);
    wrap.appendChild(g);
  });
  refreshFilterUI();

/* 已選標籤摘要列 ＋ 各維度計數徽章 */
function refreshFilterUI() {
  document.querySelectorAll("#dimFilters .dim-group").forEach((g) => {
    let n = 0;
    g.querySelectorAll(".tag-check").forEach((l) => {
      if (exploreState.selected.has(l.dataset.key)) n++;
    });
    const badge = g.querySelector(".dim-count");
    if (badge) {
      badge.textContent = n;
      badge.style.display = n ? "" : "none";
    }
  });
  const bar = $("selBar");
  if (!bar) return;
  bar.innerHTML = "";
  if (!exploreState.selected.size) { bar.style.display = "none"; return; }
  bar.style.display = "";
  const hint = document.createElement("span");
  hint.className = "sel-hint";
  hint.textContent = "已選 " + exploreState.selected.size + " 個";
  bar.appendChild(hint);
  [...exploreState.selected].forEach((key) => {
    const v = key.split(":").slice(1).join(":");
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "sel-chip";
    chip.title = "移除「" + v + "」";
    chip.innerHTML = "<span></span><i>✕</i>";
    chip.querySelector("span").textContent = v;
    chip.onclick = () => {
      exploreState.selected.delete(key);
      buildExploreFilters();
      renderExplore();
    };
    bar.appendChild(chip);
  });
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "sel-clear";
  clear.textContent = "清除全部";
  clear.onclick = () => {
    exploreState.selected.clear();
    buildExploreFilters();
    renderExplore();
  };
  bar.appendChild(clear);
}

  // 階段
  document.querySelectorAll("#stageRow .stage-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.stage === exploreState.stage);
    chip.onclick = () => { exploreState.stage = chip.dataset.stage; buildExploreFilters(); renderExplore(); };
  });
}

function contentTagKeys(c) { return new Set(c.tags.map((t) => tagKey(t.dim, t.value))); }

function searchContents() {
  const sel = exploreState.selected;
  const stage = exploreState.stage;
  const results = [];
  for (const c of SEED_CONTENTS) {
    // 階段過濾
    if (stage !== "all") {
      const st = c.tags.find((t) => t.dim === "STAGE");
      if (!st || st.value !== stage) continue;
    }
    const keys = contentTagKeys(c);
    const matched = [...sel].filter((k) => keys.has(k));
    if (exploreState.mode === "strict") {
      if (sel.size > 0 && matched.length < sel.size) continue;
      results.push({ c, matched, score: sel.size ? 1 : 1 });
    } else if (exploreState.mode === "weighted") {
      if (sel.size > 0 && matched.length === 0) continue;
      results.push({ c, matched, score: sel.size ? matched.length / sel.size : 1 });
    } else {
      // fuzzy：全部列出，按匹配度排序
      results.push({ c, matched, score: sel.size ? matched.length / sel.size : 1 });
    }
  }
  results.sort((a, b) => b.score - a.score || b.matched.length - a.matched.length);
  return results;
}

function whyRecommend(c) {
  const st = (c.tags.find((t) => t.dim === "STAGE") || {}).value || "";
  const subj = (c.tags.find((t) => t.dim === "SUBJ") || {}).value || "";
  const inter = (c.tags.find((t) => t.dim === "INTER") || {}).value || "";
  const lines = [];
  if (st === "引起好奇") lines.push("你正處於「引起好奇」階段，這則" + c.source_type + "能點燃你的問題意識");
  else if (st === "親自探索") lines.push("你正處於「親自探索」階段，動手做一次比讀十遍更有效");
  else if (st === "延伸思考") lines.push("你正處於「延伸思考」階段，是時候把概念連結到更大的圖景");
  if (inter === "模擬" || inter === "實驗") lines.push("可動手操作的" + inter + "形式，最適合驗證你的預測");
  else if (inter === "影片") lines.push("短" + inter + "能在幾分鐘內抓住核心現象");
  else if (inter === "Podcast") lines.push("用耳朵學習，適合通勤或睡前延伸思考");
  if (subj) lines.push("屬於「" + subj + "」領域，正在為你的" + subj + "島嶼添磚加瓦");
  return lines.slice(0, 2).join("；") + "。";
}

/* ---------------- 後端 API 接線（可選） ----------------
 * config.js 的 window.DAWN_API_BASE 有值時，探究頁搜尋優先打後端
 * /api/v1/search/intersection；任何失敗自動 fallback 用內嵌資料。
 */
function apiBase() {
  const b = String((window.DAWN_API_BASE || "")).trim().replace(/\/+$/, "");
  return b || null;
}

async function fetchJSON(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms || 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 帳號系統 ----------------
 * 暱稱＋密碼，權杖存 localStorage。島嶼進度跟著帳號走，存後端。
 */
const Auth = {
  token: "",
  user: null,
  init() {
    this.token = localStorage.getItem("dawn_token") || "";
    try { this.user = JSON.parse(localStorage.getItem("dawn_user") || "null"); }
    catch (e) { this.user = null; }
    if (!this.token) this.user = null;
    renderAuthBar();
  },
  save(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem("dawn_token", token);
    localStorage.setItem("dawn_user", JSON.stringify(user));
    renderAuthBar();
  },
  clear() {
    this.token = "";
    this.user = null;
    localStorage.removeItem("dawn_token");
    localStorage.removeItem("dawn_user");
    renderAuthBar();
  },
  headers() {
    return this.token ? { Authorization: "Bearer " + this.token } : {};
  },
};

/* 帶權杖的 API 呼叫；失敗拋 {status, message} */
async function api(path, opts) {
  const base = apiBase();
  if (!base) throw { status: 0, message: "後端尚未設定（config.js 的 DAWN_API_BASE 為空）。" };
  const o = opts || {};
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeout || 30000);
  try {
    const r = await fetch(base + path, {
      method: o.method || "GET",
      headers: Object.assign(
        { "Content-Type": "application/json" },
        Auth.headers(),
        o.headers || {}
      ),
      body: o.body,
      signal: ctl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw { status: r.status, message: data.detail || ("請求失敗（" + r.status + "）") };
    return data;
  } catch (e) {
    // v2 狀態設計：斷線／超時一律遊戲化文案，不跳冷冰冰的錯誤
    if (e && (e.name === "AbortError" || e instanceof TypeError))
      throw { status: 0, message: "傳送門暫時關閉（網路連線中斷）——檢查連線後再試一次" };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function renderAuthBar() {
  const bar = $("authBar");
  bar.innerHTML = "";
  if (Auth.user) {
    const pts = document.createElement("span");
    pts.className = "points-pill";
    pts.title = "學習賺取的星砂，可在雷達頁兵器庫換武器";
    pts.innerHTML = '星砂 <b id="pointsVal">' + Game.points + "</b>";
    const pill = document.createElement("span");
    pill.className = "auth-user";
    pill.textContent = Auth.user.name;
    pill.title = "已登入";
    const btn = document.createElement("button");
    btn.className = "auth-btn ghost";
    btn.textContent = "登出";
    btn.onclick = async () => {
      try { await api("/api/v1/auth/logout", { method: "POST" }); } catch (e) { /* 忽略 */ }
      Auth.clear();
      Game.refresh();
      exploreState.favorites.clear();
      renderExplore();
      loadIsland();
      if ($("page-account").classList.contains("active")) buildAccount();
      toast("已登出，星海會記得你，下次見");
    };
    bar.appendChild(pts);
    bar.appendChild(pill);
    bar.appendChild(btn);
  } else {
    const btn = document.createElement("button");
    btn.className = "auth-btn";
    btn.textContent = "登入 / 註冊";
    btn.onclick = () => openAuthModal("login");
    bar.appendChild(btn);
  }
  renderHomeBoard();
}

/* ---------------- 首頁任務中心（v2） ---------------- */
let _weeklyTeaser = null; // {title, summary} 快取

async function renderHomeBoard() {
  const logged = !!(Auth.user && Auth.token);
  const brand = $("brandHero"), board = $("homeBoard");
  if (!brand || !board) return;
  brand.style.display = logged ? "none" : "";
  if (!logged) { board.style.display = "none"; return; }
  board.style.display = "";
  let last = null;
  try { last = JSON.parse(localStorage.getItem("dawn_last_battle") || "null"); } catch (e) {}
  if (!_weeklyTeaser) {
    try {
      const d = await api("/api/v1/world/weekly", { method: "POST" });
      if (d.items && d.items.length)
        _weeklyTeaser = { title: d.items[0].title, summary: d.items[0].summary };
    } catch (e) { /* 靜默：沒有 banner 也不擋任務板 */ }
  }
  const t = _weeklyTeaser;
  board.innerHTML =
    '<div class="board-head"><h2>今日任務板</h2><span class="small">' +
    new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" }) +
    "</span></div>" +
    '<div class="task-list">' +
    '<button class="task-card" data-home-goto="learn"><span class="task-ico">戰</span>' +
    '<span class="task-main"><b>繼續學習</b><p>' +
    (last ? "上次：「" + last.topic + "」——回去把它打完" : "開始你的第一場費曼戰役") +
    "</p></span><span class='task-go'>→</span></button>" +
    '<button class="task-card" data-home-goto="duel"><span class="task-ico">決</span>' +
    '<span class="task-main"><b>下一場對決</b><p>5 回合觀念交鋒，來場 Boss 戰</p></span>' +
    "<span class='task-go'>→</span></button>" +
    '<button class="task-card" data-home-goto="weekly"><span class="task-ico">選</span>' +
    '<span class="task-main"><b>每日精選</b><p>看看本週為你策展的內容</p></span>' +
    "<span class='task-go'>→</span></button>" +
    "</div>" +
    (t ? '<button class="board-banner" data-home-goto="weekly"><span class="bk">本週精選</span><b>' +
      t.title.replace(/</g, "&lt;") + "</b><p>" +
      String(t.summary || "").replace(/</g, "&lt;").slice(0, 120) +
      "</p></button>" : "");
  board.querySelectorAll("[data-home-goto]").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.homeGoto === "learn" && last && last.sid &&
          typeof resumeBattle === "function") {
        resumeBattle(last.sid); // 有未完成戰役 → 直接續戰
      } else {
        gotoTab(b.dataset.homeGoto);
      }
    };
  });
}

let authMode = "login";

function openAuthModal(mode) {
  authMode = mode === "register" ? "register" : "login";
  forgotQuestion = "";
  document.querySelectorAll(".auth-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.mode === authMode)
  );
  syncAuthModeUI();
  $("authErr").textContent = "";
  $("authModal").classList.add("show");
  setTimeout(() => $("authName").focus(), 150);
}

function closeAuthModal() {
  $("authModal").classList.remove("show");
  $("authErr").textContent = "";
  $("authPass").value = "";
}

let forgotQuestion = ""; // 忘記密碼流程第二步的安全問題

function syncAuthModeUI() {
  const isLogin = authMode === "login";
  const isForgot = authMode === "forgot";
  const isRegister = authMode === "register";
  $("authTitle").textContent = isForgot ? "找回你的星圖"
    : isLogin ? "歡迎回來，拓荒者" : "在星海中留下你的名字";
  $("authSubmit").textContent = isForgot ? (forgotQuestion ? "重設密碼" : "查詢安全問題")
    : isLogin ? "登入" : "註冊並啟程";
  // Email 欄：僅註冊時顯示（選填）
  $("authEmailWrap").style.display = isRegister ? "" : "none";
  // 安全問題：僅註冊時顯示
  $("authSecQWrap").style.display = isRegister ? "" : "none";
  $("authSecAWrap").style.display = isRegister ? "" : "none";
  // 忘記密碼兩步
  $("authPassWrap").style.display = (isForgot && !forgotQuestion) ? "none" : "";
  $("authForgotQWrap").style.display = (isForgot && forgotQuestion) ? "" : "none";
  $("authForgotAWrap").style.display = (isForgot && forgotQuestion) ? "" : "none";
  // 密碼欄標籤
  $("authPassLabel").textContent = isForgot ? "新密碼" : "密碼";
  $("authPass").setAttribute("autocomplete", isForgot ? "new-password" : isLogin ? "current-password" : "new-password");
  // 連結
  $("forgotLink").style.display = isLogin ? "" : "none";
  $("backToLogin").style.display = isForgot ? "" : "none";
  document.querySelectorAll(".auth-tab").forEach((x) =>
    x.classList.toggle("active", !isForgot && x.dataset.mode === authMode)
  );
  $("authNote").innerHTML = isForgot
    ? "先輸入暱稱查詢你的安全問題，<br>答對即可設定新密碼。"
    : isRegister
      ? "安全問題是忘記密碼時驗證身分的唯一方式，<br>請選一個只有你知道答案的問題。"
      : "你的島嶼進度會跟著這個帳號走。";
}

async function submitAuth() {
  const name = $("authName").value.trim();
  const pw = $("authPass").value;
  const email = $("authEmail").value.trim();
  const err = $("authErr");
  err.textContent = "";
  err.classList.remove("show");
  const fail = (m) => { err.textContent = m; err.classList.add("show"); };
  if (!name) { fail("請輸入暱稱。"); return; }
  if (authMode === "forgot" && forgotQuestion && pw.length < 4) { fail("新密碼至少需要 4 個字元。"); return; }
  if (authMode !== "forgot" && pw.length < 4) { fail("密碼至少需要 4 個字元。"); return; }
  if (authMode === "register") {
    const q = $("authSecQ").value === "__custom" ? $("authSecQCustom").value.trim() : $("authSecQ").value;
    const a = $("authSecA").value.trim();
    if (!q) { fail("請選擇或輸入安全問題。"); return; }
    if (!a) { fail("請輸入安全問題的答案。"); return; }
  }
  const btn = $("authSubmit");
  let btnOrig = btn.textContent;
  btn.disabled = true;
  btn.textContent = authMode === "forgot" ? (forgotQuestion ? "重設中…" : "查詢中…") : "喚醒伺服器中…";
  try {
    if (authMode === "forgot") {
      if (!forgotQuestion) {
        // 第一步：查安全問題
        const qd = await api("/api/v1/auth/security-question?name=" + encodeURIComponent(name),
                             { timeout: 30000 });
        forgotQuestion = qd.question;
        $("authForgotQ").textContent = forgotQuestion;
        $("authErr").textContent = "";
        $("authErr").classList.remove("show");
        syncAuthModeUI();
        btnOrig = $("authSubmit").textContent; // finally 還原時保持「重設密碼」
        return;
      }
      // 第二步：答案＋新密碼
      const answer = $("authForgotA").value.trim();
      if (!answer) { fail("請輸入安全問題的答案。"); btn.disabled = false; btn.textContent = btnOrig; return; }
      const data = await api("/api/v1/auth/forgot", {
        method: "POST",
        body: JSON.stringify({ name, answer, new_password: pw }),
        timeout: 30000,
      });
      closeAuthModal();
      toast(data.reason || "密碼已重設，請用新密碼登入。");
      authMode = "login";
      forgotQuestion = "";
      syncAuthModeUI();
      return;
    }
    let data = null, lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = { name, password: pw };
        if (authMode === "register") {
          if (email) body.email = email;
          body.sec_question = $("authSecQ").value === "__custom" ? $("authSecQCustom").value.trim() : $("authSecQ").value;
          body.sec_answer = $("authSecA").value.trim();
        }
        data = await api("/api/v1/auth/" + authMode, {
          method: "POST",
          body: JSON.stringify(body),
          timeout: 30000,
        });
        break;
      } catch (e) {
        lastErr = e;
        if (e && e.status === 0 && attempt === 0) {
          btn.textContent = "還在叫醒它，再試一次…";
          continue;
        }
        throw e;
      }
    }
    if (!data) throw lastErr;
    Auth.save(data.token, data.user);
    closeAuthModal();
    toast(data.reason || "歡迎！");
    Game.refresh();
    refreshMe();
    await loadFavorites();
    renderExplore();
    if ($("page-island").classList.contains("active")) loadIsland();
    if ($("page-account").classList.contains("active")) buildAccount();
    if (authMode === "register") {
      // 首次註冊：情境式引路儀式
      setTimeout(openOnboarding, 600);
    }
  } catch (e) {
    fail(e && e.status === 0
      ? "伺服器還在睡覺（免費版冷啟動較慢），請稍後再試一次。"
      : (e.message || "發生錯誤，請重試。"));
  } finally {
    btn.disabled = false;
    btn.textContent = btnOrig;
  }
}

function initAuth() {
  Auth.init();
  refreshMe();
  document.querySelectorAll(".auth-tab").forEach((t) => {
    t.onclick = () => {
      authMode = t.dataset.mode;
      document.querySelectorAll(".auth-tab").forEach((x) =>
        x.classList.toggle("active", x === t)
      );
      syncAuthModeUI();
      $("authErr").textContent = "";
    };
  });
  $("authSubmit").onclick = submitAuth;
  $("forgotLink").onclick = () => { authMode = "forgot"; forgotQuestion = ""; syncAuthModeUI(); };
  $("backToLogin").onclick = () => { authMode = "login"; forgotQuestion = ""; syncAuthModeUI(); };
  $("authSecQ").onchange = () => {
    $("authSecQCustom").style.display = $("authSecQ").value === "__custom" ? "" : "none";
  };
  document.querySelectorAll(".auth-tab").forEach((t) => {
    t.addEventListener("click", () => { forgotQuestion = ""; });
  });
  $("authClose").onclick = closeAuthModal;
  $("authModal").addEventListener("click", (e) => {
    if (e.target === $("authModal")) closeAuthModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("authModal").classList.contains("show")) closeAuthModal();
  });
  $("authPass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAuth();
  });
  $("authName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAuth();
  });
  $("gateLoginBtn").onclick = () => openAuthModal("login");
}

function apiTagToLocal(tk) {
  const i = tk.indexOf(":");
  return { dim: tk.slice(0, i), value: tk.slice(i + 1) };
}

async function searchViaAPI() {
  const base = apiBase();
  if (!base) return null;
  const sel = [...exploreState.selected];
  if (!sel.length) return null; // 無標籤時沿用內嵌瀏覽模式
  const q = new URLSearchParams({ tags: sel.join(","), mode: exploreState.mode });
  const data = await fetchJSON(base + "/api/v1/search/intersection?" + q.toString());
  if (!data || !Array.isArray(data.results)) throw new Error("bad response");
  const items = await Promise.all(
    data.results.map(async (it) => {
      // 拿完整標籤（供卡片顯示與階段過濾）；失敗就用搜尋回傳的 matched_tags
      let tags = (it.matched_tags || []).map(apiTagToLocal);
      try {
        const detail = await fetchJSON(base + "/api/v1/contents/" + it.id);
        if (detail && Array.isArray(detail.tags)) tags = detail.tags.map(apiTagToLocal);
      } catch (e) { /* 忽略，用 matched_tags */ }
      return {
        c: {
          id: it.id,
          title: it.title,
          summary: it.summary,
          source_type: it.source_type,
          duration: (it.duration_min || 0) + " 分鐘",
          url: it.url,
          tags: tags,
          _apiReason: it.reason || "",
        },
        matched: it.matched_tags || [],
        score: typeof it.match_score === "number" ? it.match_score : 0,
      };
    })
  );
  // 階段過濾（與內嵌版一致）
  const stage = exploreState.stage;
  return stage === "all"
    ? items
    : items.filter(({ c }) => {
        const st = c.tags.find((t) => t.dim === "STAGE");
        return st && st.value === stage;
      });
}

function reasonText(c, matched, score) {
  if (c._apiReason) return "後端：" + c._apiReason;
  const sel = exploreState.selected;
  if (sel.size === 0) return "瀏覽模式：尚未選擇標籤，以下為知識湖全部內容。";
  const names = matched.map((k) => {
    const [dim, ...rest] = k.split(":");
    return rest.join(":") + "（" + DIM_NAMES[dim] + "）";
  });
  if (exploreState.mode === "fuzzy") {
    return "匹配度 " + Math.round(score * 100) + "%：符合了你選的 " + sel.size + " 個標籤中的 " + matched.length + " 個（" + (names.join("、") || "無") + "）。";
  }
  return "同時符合 " + matched.length + " 個標籤：" + names.join("、") + "。";
}

async function renderExplore() {
  // 有設定後端 URL 且有選標籤 → 優先打 API；失敗自動 fallback 內嵌資料
  let results = null;
  let usedAPI = false;
  if (apiBase() && exploreState.selected.size > 0) {
    try {
      results = await searchViaAPI();
      usedAPI = true;
    } catch (e) {
      toast("後端連線失敗，已切換為內嵌資料");
    }
  }
  if (!results) results = searchContents();
  const meta = $("exploreMeta");
  const selN = exploreState.selected.size;
  const modeName = SEARCH_MODES.find((m) => m.id === exploreState.mode).name;
  meta.textContent = "搜尋模式：" + modeName + " · 已選 " + selN + " 個標籤 · 找到 " + results.length + " 筆內容"
    + (usedAPI ? " · 資料來源：後端 API" : "");

  const box = $("exploreCards");
  box.innerHTML = "";
  if (!results.length) {
    box.innerHTML = '<div class="empty-hint"><span class="emblem-img" role="img" aria-label="曙光之境"></span><br>嚴格交集下沒有同時符合的內容。<br>試試切換為「加權交集」或「模糊交集」，或減少標籤數量。</div>';
    return;
  }
  results.forEach(({ c, matched, score }) => {
    const hitSet = new Set(matched);
    const card = document.createElement("div");
    card.className = "card";
    const fav = exploreState.favorites.has(c.id);
    card.innerHTML =
      (exploreState.mode === "fuzzy" && selN > 0
        ? '<div class="match-score">匹配 ' + Math.round(score * 100) + "%</div>"
        : "") +
      '<div class="src-row"><span class="src-badge">' + c.source_type + '</span><span>' + c.duration + '</span></div>' +
      "<h3>" + c.title + "</h3>" +
      '<div class="summary">' + c.summary.slice(0, 90) + "…</div>" +
      '<div class="tags">' +
      c.tags.map((t) => {
        const k = tagKey(t.dim, t.value);
        return '<span class="mini-tag' + (hitSet.has(k) ? " hit" : "") + '">' + t.value + "</span>";
      }).join("") +
      "</div>" +
      '<div class="match-line">✓ 符合標籤：' + (matched.map((k) => k.split(":").slice(1).join(":")).join("、") || "—") + "</div>" +
      '<div class="reason-line">' + whyRecommend(c) + "</div>" +
      '<div style="font-size:12px;color:var(--text-faint)">' + reasonText(c, matched, score) + "</div>" +
      '<div class="actions">' +
      '<button class="btn small fav-btn">' + (fav ? "★ 已收藏" : "☆ 收藏") + "</button>" +
      '<button class="btn small ask-btn">提問</button>' +
      '<button class="btn small add-btn">加入島嶼</button>' +
      "</div>";

    card.querySelector(".fav-btn").onclick = (e) => {
      toggleFavorite(c.id, e.currentTarget);
    };
    card.querySelector(".ask-btn").onclick = () => {
      $("qaInput").value = "關於「" + c.title + "」，可以再多說明一點嗎？";
      gotoTab("qa");
      toast("已把問題帶到問答頁，直接按「提問」即可");
    };
    card.querySelector(".add-btn").onclick = (e) => {
      const b = e.currentTarget;
      if (b.disabled) return;
      b.disabled = true;
      b.textContent = "✓ 已加入";
      // 飛行動效：從按鈕飛往導覽列的島嶼分頁
      const r1 = b.getBoundingClientRect();
      const navBtn = document.querySelector('#mainNav button[data-tab="world"]');
      const r2 = navBtn.getBoundingClientRect();
      const dot = document.createElement("div");
      dot.className = "fly-dot";
      dot.style.left = r1.left + r1.width / 2 + "px";
      dot.style.top = r1.top + "px";
      document.body.appendChild(dot);
      const dx = r2.left + r2.width / 2 - (r1.left + r1.width / 2);
      const dy = r2.top - r1.top;
      dot.animate(
        [
          { transform: "translate(0,0) scale(1)", opacity: 1 },
          { transform: "translate(" + dx * 0.5 + "px," + (dy - 120) + "px) scale(1.3)", opacity: 1, offset: 0.5 },
          { transform: "translate(" + dx + "px," + dy + "px) scale(0.4)", opacity: 0.6 },
        ],
        { duration: 800, easing: "cubic-bezier(.3,.7,.4,1)" }
      ).onfinish = () => {
        dot.remove();
        card.classList.add("just-added");
        toast("已加入島嶼書架！這份知識正在為你的島嶼添磚加瓦。");
        setTimeout(() => card.classList.remove("just-added"), 600);
      };
    };
    box.appendChild(card);
  });
}

/* ============================================================
 * 分頁 2：島嶼（領土系統）
 * ============================================================ */
/* ============================================================
 * 分頁 2：島嶼（領土系統）—— 進度存後端，跟著帳號走
 * ============================================================ */
const islandState = {
  units: 1,
  todayAdded: 0,
  cap: 5,
  name: "初生之島",
  resources: { seed: 0, eye: 0, gear: 0, spring: 0, web: 0, key: 0 },
};

/* 前端動作 id → 後端 EXPAND_ACTIONS 鍵 */
const ACTION_MAP = {
  explore: "complete_topic",
  myth: "fix_myth",
  ask: "ask_question",
  quest: "complete_quest",
  coresh: "co_study",
};

/* 後端資源鍵 → 前端資源 id */
const RES_KEY_MAP = {
  curiosity_seed: "seed",
  observing_eye: "eye",
  variable_gear: "gear",
  flow_spring: "spring",
  connection_web: "web",
  shadow_key: "key",
};

function islandLevelName() {
  const u = islandState.units;
  if (u < 3) return "荒島";
  if (u < 6) return "綠洲";
  if (u < 10) return "繁茂之島";
  return "星海重鎮";
}

function applyIsland(isl) {
  islandState.units = isl.territory;
  islandState.todayAdded = isl.used_today || 0;
  islandState.cap = isl.daily_cap || 5;
  islandState.name = isl.name || "初生之島";
  const raw = isl.resources_raw || {};
  const mapped = { seed: 0, eye: 0, gear: 0, spring: 0, web: 0, key: 0 };
  for (const [k, v] of Object.entries(raw)) {
    if (RES_KEY_MAP[k]) mapped[RES_KEY_MAP[k]] = v;
  }
  islandState.resources = mapped;
  $("islandName").textContent = islandState.name;
  renderIslandStats();
  drawIsland();
}

async function loadIsland() {
  const gate = $("islandGate");
  const layout = $("islandLayout");
  if (!Auth.user || !Auth.token) {
    gate.style.display = "block";
    layout.style.display = "none";
    return;
  }
  gate.style.display = "none";
  layout.style.display = "";
  try {
    const isl = await api("/api/v1/islands/" + Auth.user.id);
    applyIsland(isl);
    await loadTerritoryLog();
    maybeShowPersonaBanner();
  } catch (e) {
    if (e.status === 401) {
      Auth.clear();
      loadIsland();
      openAuthModal("login");
      toast("登入已過期，請重新登入。");
    } else {
      toast("島嶼載入失敗：" + e.message);
    }
  }
}

async function loadTerritoryLog() {
  try {
    const data = await api("/api/v1/islands/" + Auth.user.id + "/logs?limit=30");
    renderTerritoryLog(data.logs || []);
  } catch (e) { /* 靜默：島嶼狀態已顯示 */ }
}

function renderTerritoryLog(logs) {
  const ul = $("territoryLog");
  ul.innerHTML = "";
  if (!logs.length) {
    ul.innerHTML = '<li><span class="ltime">--</span>還沒有開疆紀錄。完成右側的學習行為，開始擴張你的島嶼吧！</li>';
    return;
  }
  logs.slice(0, 30).forEach((e) => {
    const a = ISLAND_ACTIONS.find((x) => ACTION_MAP[x.id] === e.action);
    const label = a ? a.label : e.action;
    const time = String(e.created_at || "").slice(5, 16).replace("T", " ");
    const li = document.createElement("li");
    li.innerHTML = '<span class="ltime">' + time + "</span>" + label +
      ' <span class="lgain">+' + e.delta + " 領土</span>";
    ul.appendChild(li);
  });
}

function renderIslandStats() {
  const cap = islandState.cap || 5;
  $("statUnits").textContent = islandState.units % 1 === 0 ? islandState.units : islandState.units.toFixed(1);
  $("statLevel").textContent = islandLevelName();
  $("statToday").textContent = (islandState.todayAdded % 1 === 0 ? islandState.todayAdded : islandState.todayAdded.toFixed(1)) + " / " + cap;
  $("capFill").style.width = Math.min(100, (islandState.todayAdded / cap) * 100) + "%";

  const grid = $("resGrid");
  grid.innerHTML = "";
  RESOURCES.forEach((r) => {
    const d = document.createElement("div");
    d.className = "res-item";
    d.innerHTML = '<span class="ricon">' + r.name[0] + "</span>" + r.name +
      '<span class="rcount">×' + (islandState.resources[r.id] || 0) + "</span>" +
      '<span class="rdesc">' + r.desc + "</span>";
    grid.appendChild(d);
  });
}

function buildIslandActions() {
  const box = $("islandActions");
  box.innerHTML = "";
  ISLAND_ACTIONS.forEach((a) => {
    const row = document.createElement("div");
    row.className = "island-action";
    row.innerHTML =
      '<div><div class="alabel">' + a.label + '</div><div class="ahint">' + a.hint + "</div></div>" +
      '<button class="btn small">執行</button>';
    row.querySelector("button").onclick = (ev) => doIslandAction(a, ev.currentTarget);
    box.appendChild(row);
  });
}

let islandBusy = false;

async function doIslandAction(a, btn) {
  if (!Auth.user || !Auth.token) { openAuthModal("login"); return; }
  if (islandBusy) return;
  islandBusy = true;
  if (btn) btn.disabled = true;
  try {
    const res = await api("/api/v1/islands/" + Auth.user.id + "/expand", {
      method: "POST",
      body: JSON.stringify({ action: ACTION_MAP[a.id] }),
    });
    applyIsland(res.island);
    await loadTerritoryLog();
    if (res.points != null) { Game.points = res.points; renderPointsPills(); }
    toast("開疆拓土！領土 +" + res.delta + " 單位，" + res.reward + "入袋！星砂 ×10。");
    if (res.used_today >= res.daily_cap - 1e-9) {
      setTimeout(() => toast("今日擴張額度已用完。慢，就是快——明天見！", 3200), 1200);
    }
  } catch (e) {
    if (e.status === 401) {
      Auth.clear();
      loadIsland();
      openAuthModal("login");
    } else {
      toast(e.message, 3200);
    }
  } finally {
    islandBusy = false;
    if (btn) btn.disabled = false;
  }
}

/* 島嶼繪製：領土單位越多，島越大、植被越茂盛 */
let islandResizeT = null;
window.addEventListener("resize", () => {
  clearTimeout(islandResizeT);
  islandResizeT = setTimeout(() => {
    if ($("page-island") && $("page-island").classList.contains("active")) drawIsland();
  }, 200);
});

function drawIsland() {
  const cv = $("islandCanvas");
  // 按容器寬度自適應內部分辨率
  const w = Math.min(520, Math.floor((cv.parentElement && cv.parentElement.clientWidth) || 520));
  const h = Math.round((w * 340) / 520);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const u = islandState.units;
  ctx.clearRect(0, 0, W, H);

  // 夜空星點
  const rnd = mulberry32(42);
  for (let i = 0; i < 60; i++) {
    ctx.globalAlpha = 0.25 + rnd() * 0.55;
    ctx.fillStyle = "#cfe6ff";
    ctx.fillRect(rnd() * W, rnd() * H * 0.55, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;

  // 月亮
  ctx.fillStyle = "rgba(230,240,255,.9)";
  ctx.beginPath(); ctx.arc(W - 70, 52, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(5,13,36,.25)";
  ctx.beginPath(); ctx.arc(W - 78, 46, 18, 0, Math.PI * 2); ctx.fill();

  const cx = W / 2, cy = H * 0.62;
  const s = Math.min(1 + (u - 1) * 0.09, 2.1); // 島嶼縮放
  const R = 78 * s;

  // 海水光暈
  const sea = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 1.7);
  sea.addColorStop(0, "rgba(56,130,200,0.35)");
  sea.addColorStop(1, "rgba(56,130,200,0)");
  ctx.fillStyle = sea;
  ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.7, R * 0.95, 0, 0, Math.PI * 2); ctx.fill();

  // 沙灘
  ctx.fillStyle = "#c9a86a";
  ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.52, 0, 0, Math.PI * 2); ctx.fill();
  // 草地
  const grass = ctx.createRadialGradient(cx, cy - 6, 8, cx, cy, R * 0.86);
  grass.addColorStop(0, "#3f9e5f");
  grass.addColorStop(1, "#2a7a44");
  ctx.fillStyle = grass;
  ctx.beginPath(); ctx.ellipse(cx, cy - 4, R * 0.82, R * 0.42, 0, 0, Math.PI * 2); ctx.fill();

  // 植被：棕櫚樹數量隨領土成長
  const treeRnd = mulberry32(7);
  const treeCount = Math.min(2 + Math.floor(u * 1.4), 16);
  for (let i = 0; i < treeCount; i++) {
    const a = treeRnd() * Math.PI * 2;
    const rr = treeRnd() * R * 0.62;
    const tx = cx + Math.cos(a) * rr;
    const ty = cy - 4 + Math.sin(a) * rr * 0.5 - 6;
    const th = 26 + treeRnd() * 14;
    drawPalm(ctx, tx, ty, th);
  }

  // 建築：3 單位小屋，6 單位燈塔，10 單位旗幟
  if (u >= 3) {
    ctx.fillStyle = "#8a5a2b";
    ctx.fillRect(cx - 42 * s, cy - 46 * s, 30 * s, 22 * s);
    ctx.fillStyle = "#5c3a17";
    ctx.beginPath();
    ctx.moveTo(cx - 46 * s, cy - 46 * s);
    ctx.lineTo(cx - 27 * s, cy - 60 * s);
    ctx.lineTo(cx - 8 * s, cy - 46 * s);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffe9a3";
    ctx.fillRect(cx - 34 * s, cy - 40 * s, 10 * s, 10 * s);
  }
  if (u >= 6) {
    ctx.fillStyle = "#dfe9ff";
    ctx.fillRect(cx + 30 * s, cy - 78 * s, 16 * s, 52 * s);
    ctx.fillStyle = "#e2543e";
    ctx.fillRect(cx + 30 * s, cy - 66 * s, 16 * s, 10 * s);
    ctx.fillRect(cx + 30 * s, cy - 44 * s, 16 * s, 10 * s);
    // 燈光
    const beam = ctx.createLinearGradient(cx + 38 * s, cy - 78 * s, cx + 130 * s, cy - 110 * s);
    beam.addColorStop(0, "rgba(255,240,180,.5)");
    beam.addColorStop(1, "rgba(255,240,180,0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(cx + 38 * s, cy - 78 * s);
    ctx.lineTo(cx + 140 * s, cy - 120 * s);
    ctx.lineTo(cx + 140 * s, cy - 60 * s);
    ctx.closePath(); ctx.fill();
  }
  if (u >= 10) {
    ctx.strokeStyle = "#cfe6ff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy - 30 * s); ctx.lineTo(cx, cy - 95 * s); ctx.stroke();
    ctx.fillStyle = "#7dd3fc";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 95 * s);
    ctx.lineTo(cx + 34 * s, cy - 87 * s);
    ctx.lineTo(cx, cy - 79 * s);
    ctx.closePath(); ctx.fill();
  }

  // 島名
  ctx.fillStyle = "rgba(232,241,255,.85)";
  ctx.font = "600 15px 'Noto Sans TC', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("初生之島 · " + islandLevelName() + " · " + u + " 單位", cx, H - 14);
}

function drawPalm(ctx, x, y, h) {
  ctx.strokeStyle = "#6b4423";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + 4, y - h * 0.6, x + 10, y - h);
  ctx.stroke();
  ctx.fillStyle = "#2f8f4e";
  const topX = x + 10, topY = y - h;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.4;
    ctx.beginPath();
    ctx.ellipse(topX + Math.cos(a) * 12, topY + Math.sin(a) * 7, 13, 5.5, a, 0, Math.PI * 2);
    ctx.fill();
  }
  // 椰子
  ctx.fillStyle = "#7a4a1f";
  ctx.beginPath(); ctx.arc(topX - 4, topY + 5, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(topX + 4, topY + 5, 3.4, 0, Math.PI * 2); ctx.fill();
}

/* ============================================================
 * 分頁 3：三維空間雷達（手寫 3D → 2D 投影）
 * X 知識廣度 / Y 認知深度 / Z 社會連結
 * 隱私設計：只顯示距離，不顯示精確座標
 * ============================================================ */
const radarState = {
  rotY: 0.6,
  rotX: -0.5,
  auto: true,
  selectedId: null,
  points2D: [], // [{id, x, y}] 供點擊命中測試
};

function norm(v) { return (v - 50) / 50; } // 0–100 → -1–1

/* 企畫書 §11.3 距離公式 */
function radarDistance(a, b) {
  const dx = Math.abs(a.x - b.x) / 100;
  const dy = Math.abs(a.y - b.y) / 100;
  const dz = Math.abs(a.z - b.z) / 100;
  return (Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.sqrt(3)) * 100;
}

function relationOf(dist) {
  if (dist < 20) return { key: "ally", name: "合作夥伴", cls: "rel-ally", desc: "你們的知識領域高度重疊！適合結為共修夥伴，互相切磋、一起解任務，還能觸發合作加成。" };
  if (dist <= 60) return { key: "complement", name: "互補學習", cls: "rel-complement", desc: "你們部分重疊、部分互補。他的強項可能正是你的未知領域——跨域交流會讓雙方都長大。" };
  return { key: "explore", name: "探索未知", cls: "rel-explore", desc: "你們的知識領域差異很大，那是一片等你去探索的未知星海。找他聊聊，會打開全新的視角。" };
}

function project3D(nx, ny, nz, cx, cy, R) {
  // 旋轉 Y，再傾斜 X
  const cosY = Math.cos(radarState.rotY), sinY = Math.sin(radarState.rotY);
  const x1 = nx * cosY + nz * sinY;
  const z1 = -nx * sinY + nz * cosY;
  const cosX = Math.cos(radarState.rotX), sinX = Math.sin(radarState.rotX);
  const y2 = ny * cosX - z1 * sinX;
  const z2 = ny * sinX + z1 * cosX;
  // 透視投影
  const f = 3.4;
  const scale = f / (f - z2 * 0.9);
  return { x: cx + x1 * R * scale, y: cy - y2 * R * scale, s: scale, z: z2 };
}

function fitRadarCanvas() {
  const cv = $("radarCanvas");
  if (!cv || !cv.parentElement) return;
  const w = Math.min(640, Math.floor(cv.parentElement.clientWidth) || 640);
  const h = Math.round((w * 420) / 640);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
}

function drawRadar() {
  const cv = $("radarCanvas");
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const cx = W / 2, cy = H / 2 + 10, R = Math.min(W, H) * 0.31;
  ctx.clearRect(0, 0, W, H);
  radarState.points2D = [];

  // 地板網格（同心圓 + 放射線）
  ctx.strokeStyle = "rgba(125,211,252,.14)";
  ctx.lineWidth = 1;
  for (let r = 1; r <= 3; r++) {
    ctx.beginPath();
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const p = project3D(Math.cos(a) * r / 3, -1, Math.sin(a) * r / 3, cx, cy, R);
      pts.push(p);
    }
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath(); ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const p1 = project3D(0, -1, 0, cx, cy, R);
    const p2 = project3D(Math.cos(a), -1, Math.sin(a), cx, cy, R);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }

  // 座標軸
  const axes = [
    { v: [1.15, -1, 0], label: "X 知識廣度", color: "#7dd3fc" },
    { v: [0, 0.25, 0], label: "Y 認知深度", color: "#c4b5fd" },
    { v: [0, -1, 1.15], label: "Z 社會連結", color: "#6ee7b7" },
  ];
  const o = project3D(0, -1, 0, cx, cy, R);
  axes.forEach((ax) => {
    const p = project3D(ax.v[0], ax.v[1], ax.v[2], cx, cy, R);
    ctx.strokeStyle = ax.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ax.color;
    ctx.font = "600 12px 'Noto Sans TC', sans-serif";
    ctx.fillText(ax.label, p.x + 6, p.y - 4);
  });

  // 拓荒者（按深度排序，先畫遠的）
  const me = PIONEERS.find((p) => p.isMe);
  const items = PIONEERS.map((p) => {
    const pr = project3D(norm(p.x), norm(p.y), norm(p.z), cx, cy, R);
    return { p, ...pr };
  }).sort((a, b) => a.z - b.z);

  items.forEach(({ p, x, y, s }) => {
    const selected = radarState.selectedId === p.id;
    const rad = (p.isMe ? 9 : 7) * s * (selected ? 1.35 : 1);
    // 光暈
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 3);
    g.addColorStop(0, p.color + "cc");
    g.addColorStop(1, p.color + "00");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rad * 3, 0, Math.PI * 2); ctx.fill();
    // 本體
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    if (p.isMe || selected) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, rad + 4, 0, Math.PI * 2); ctx.stroke();
    }
    // 標籤
    ctx.fillStyle = "rgba(232,241,255,.92)";
    ctx.font = (p.isMe ? "700" : "400") + " 12.5px 'Noto Sans TC', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.name, x, y - rad - 8);
    // 連到使用者的距離線（選中時）
    if (selected && !p.isMe) {
      const mp = project3D(norm(me.x), norm(me.y), norm(me.z), cx, cy, R);
      ctx.strokeStyle = "rgba(125,211,252,.55)";
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(mp.x, mp.y); ctx.lineTo(x, y); ctx.stroke();
      ctx.setLineDash([]);
    }
    radarState.points2D.push({ id: p.id, x, y, r: Math.max(rad + 8, 16) });
  });
  ctx.textAlign = "left";
}

function renderPioneerList() {
  const me = PIONEERS.find((p) => p.isMe);
  const box = $("pioneerList");
  box.innerHTML = "";
  PIONEERS.forEach((p) => {
    const d = document.createElement("div");
    d.className = "pioneer-item" + (radarState.selectedId === p.id ? " selected" : "");
    const dist = p.isMe ? null : radarDistance(me, p);
    d.innerHTML =
      '<div class="pname" style="color:' + p.color + '">' + p.name + "</div>" +
      '<div class="ptitle">' + p.title + "</div>" +
      (dist !== null ? '<div class="pdist">知識距離：' + dist.toFixed(1) + "%</div>" : '<div class="pdist">這就是你</div>');
    d.onclick = () => selectPioneer(p.id);
    box.appendChild(d);
  });
}

function selectPioneer(id) {
  radarState.selectedId = id;
  const me = PIONEERS.find((p) => p.isMe);
  const p = PIONEERS.find((x) => x.id === id);
  const info = $("radarInfo");
  if (p.isMe) {
    info.innerHTML = '<div class="rel" style="color:var(--cyan)">這就是你</div>' +
      "<div>見習拓荒者，初生之島的主人。繼續探索、對決、共修，你在星海中的位置會不斷移動。</div>" +
      '<div class="privacy-note">你的精確座標只有你自己看得到。</div>';
  } else {
    const dist = radarDistance(me, p);
    const rel = relationOf(dist);
    info.innerHTML =
      '<div class="rel ' + rel.cls + '">' + p.name + " · " + rel.name + "</div>" +
      "<div>知識距離：<strong>" + dist.toFixed(1) + "%</strong></div>" +
      "<div style='margin-top:8px;color:var(--text-dim)'>" + rel.desc + "</div>" +
      '<div style="margin-top:12px"><button class="btn primary" id="challengeBtn">發起挑戰</button></div>' +
      '<div class="privacy-note">隱私設計：僅顯示距離，不顯示對方精確座標。挑戰為純遊戲，點到為止。</div>';
    $("challengeBtn").onclick = () => openBattle(p.id);
  }
  renderPioneerList();
}

function initRadar() {
  const cv = $("radarCanvas");
  renderPioneerList();

  // 拖曳旋轉
  let dragging = false, lastX = 0, lastY = 0, idleTimer = null;
  cv.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    radarState.auto = false;
    clearTimeout(idleTimer);
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    radarState.rotY += (e.clientX - lastX) * 0.008;
    radarState.rotX = Math.max(-1.2, Math.min(-0.15, radarState.rotX + (e.clientY - lastY) * 0.005));
    lastX = e.clientX; lastY = e.clientY;
  });
  const endDrag = () => {
    dragging = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { radarState.auto = true; }, 4000);
  };
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);

  // 點擊選取拓荒者
  cv.addEventListener("click", (e) => {
    const rect = cv.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (cv.width / rect.width);
    const my = (e.clientY - rect.top) * (cv.height / rect.height);
    let best = null, bestD = 1e9;
    radarState.points2D.forEach((pt) => {
      const d = Math.hypot(pt.x - mx, pt.y - my);
      if (d < pt.r && d < bestD) { best = pt.id; bestD = d; }
    });
    if (best) selectPioneer(best);
  });

  (function loop() {
    if (radarState.auto && !dragging) radarState.rotY += 0.004;
    fitRadarCanvas();
    drawRadar();
    requestAnimationFrame(loop);
  })();
}

/* ============================================================
 * 分頁 4：知識對決
 * ============================================================ */
const duelState = {
  opponent: null,
  domainKey: null,
  questions: [],
  round: 0,
  myScore: 0,
  oppScore: 0,
  locked: false,
};

function duelDomainOptions() {
  const map = new Map();
  DUEL_QUESTIONS.forEach((q) => {
    const conc = (q.tags.find((t) => t.dim === "CONC") || {}).value || "";
    const subj = (q.tags.find((t) => t.dim === "SUBJ") || {}).value || "";
    if (!conc) return;
    const key = subj + "・" + conc;
    if (!map.has(key)) map.set(key, { key, label: subj + " · " + conc, conc });
  });
  return [...map.values()];
}

function initDuel() {
  // v2 試煉場 Roguelike 流程條：節點可點跳轉
  document.querySelectorAll(".trial-flow .flow-node").forEach((n) => {
    n.onclick = () => gotoTab(n.dataset.goto);
  });
  const oppSel = $("duelOpponent");
  oppSel.innerHTML = "";
  PIONEERS.filter((p) => !p.isMe).forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name + "（" + p.title + "）";
    oppSel.appendChild(o);
  });

  const domSel = $("duelDomain");
  domSel.innerHTML = "";
  duelDomainOptions().forEach((d) => {
    const o = document.createElement("option");
    o.value = d.key;
    o.textContent = d.label;
    domSel.appendChild(o);
  });

  $("duelStart").onclick = startDuel;
  $("duelNext").onclick = nextDuelRound;
}

function startDuel() {
  const oppId = $("duelOpponent").value;
  duelState.opponent = PIONEERS.find((p) => p.id === oppId);
  duelState.domainKey = $("duelDomain").value;
  const [, conc] = duelState.domainKey.split("・");

  let pool = DUEL_QUESTIONS.filter((q) =>
    q.tags.some((t) => t.dim === "CONC" && t.value === conc)
  );
  const rest = DUEL_QUESTIONS.filter((q) => !pool.includes(q));
  // 洗牌補足 5 題
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const restShuffled = [...rest].sort(() => Math.random() - 0.5);
  duelState.questions = [...shuffled, ...restShuffled].slice(0, 5);

  duelState.round = 0;
  duelState.myScore = 0;
  duelState.oppScore = 0;

  $("duelSetup").style.display = "none";
  $("duelResult").classList.remove("show");
  $("duelArena").classList.add("show");
  renderDuelRound();
  toast("對決開始！主題：「" + duelState.domainKey.replace("・", " · ") + "」，共 5 回合。");
}

function renderDuelRound() {
  const q = duelState.questions[duelState.round];
  duelState.locked = false;

  // 回合指示
  const pills = $("roundPills");
  pills.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const s = document.createElement("div");
    s.className = "round-pill" + (i === duelState.round ? " current" : "");
    s.textContent = i + 1;
    pills.appendChild(s);
  }
  $("duelScore").textContent = "你 " + duelState.myScore + " : " + duelState.oppScore + " " + duelState.opponent.name.split(" ")[0];

  $("duelQuestion").textContent = "第 " + (duelState.round + 1) + " 回合 · " + q.question;
  const box = $("duelOptions");
  box.innerHTML = "";
  const fb = $("duelFeedback");
  fb.classList.remove("show", "good", "bad");
  fb.innerHTML = "";
  $("duelNext").style.display = "none";

  q.options.forEach((opt, idx) => {
    const b = document.createElement("button");
    b.className = "opt-btn";
    const badge = document.createElement("b");
    badge.textContent = String.fromCharCode(65 + idx);
    const label = document.createElement("span");
    label.textContent = opt;
    b.appendChild(badge);
    b.appendChild(label);
    b.onclick = () => answerDuel(idx, b);
    box.appendChild(b);
  });
}

function answerDuel(idx, btn) {
  if (duelState.locked) return;
  duelState.locked = true;
  const q = duelState.questions[duelState.round];
  const correct = idx === q.answer;
  const btns = [...document.querySelectorAll("#duelOptions .opt-btn")];
  btns.forEach((b, i) => {
    b.disabled = true;
    if (i === q.answer) b.classList.add("correct");
  });
  if (!correct) btn.classList.add("wrong");

  // 模擬對手作答（概念越熟答對率越高，這裡用固定機率示意）
  const oppCorrect = Math.random() < 0.55;
  if (correct) duelState.myScore++;
  if (oppCorrect) duelState.oppScore++;

  // 更新回合 pill
  const pill = $("roundPills").children[duelState.round];
  pill.classList.remove("current");
  pill.classList.add(correct ? "done-correct" : "done-wrong");
  $("duelScore").textContent = "你 " + duelState.myScore + " : " + duelState.oppScore + " " + duelState.opponent.name.split(" ")[0];

  const fb = $("duelFeedback");
  fb.classList.add("show", correct ? "good" : "bad");
  fb.innerHTML =
    "<div><strong>" + (correct ? "✓ 答對了！" : "✗ 答錯了") + "</strong> " + q.feedback + "</div>" +
    (!correct ? "<div style='margin-top:6px'>觀念診斷：" + q.misconception + "</div>" : "") +
    '<div class="opp-line">對手「' + duelState.opponent.name + "」" + (oppCorrect ? "答對了" : "也答錯了") + "，目前比數 " + duelState.myScore + " : " + duelState.oppScore + "。</div>";

  const nextBtn = $("duelNext");
  nextBtn.style.display = "";
  nextBtn.textContent = duelState.round < 4 ? "下一題 →" : "查看結算";
}

function nextDuelRound() {
  duelState.round++;
  if (duelState.round < 5) renderDuelRound();
  else settleDuel();
}

function settleDuel() {
  $("duelArena").classList.remove("show");
  const res = $("duelResult");
  const win = duelState.myScore > duelState.oppScore;
  const draw = duelState.myScore === duelState.oppScore;

  // 結算：徽章榮譽（對決為純觀念交鋒，不影響島嶼領土）
  let badge, badgeCls, title;
  if (win) {
    badge = "對決勝利"; badgeCls = "win";
    title = "旗開得勝！";
  } else {
    badge = "觀念修正"; badgeCls = "fix";
    title = draw ? "勢均力敵" : "雖敗猶榮";
  }

  res.innerHTML =
    '<span class="trophy-emblem" role="img" aria-label="曙光之境"></span>' +
    "<h2>" + title + "</h2>" +
    '<div style="font-size:15px;color:var(--text-dim)">最終比數：你 ' + duelState.myScore + " : " + duelState.oppScore + " " + duelState.opponent.name.split(" ")[0] + "</div>" +
    '<div style="margin:10px 0"><span class="badge ' + badgeCls + '">' + badge + "徽章</span></div>" +
    '<div class="settle-table">' +
    '<div class="row"><span>學習回饋</span><span style="color:var(--accent)">已獲得本領域觀念診斷</span></div>' +
    '<div class="row"><span>島嶼</span><span style="color:var(--text-faint)">對決為觀念交鋒，領土不受影響</span></div>' +
    "</div>" +
    '<div style="font-size:13.5px;color:var(--text-faint);max-width:520px;margin:0 auto 18px">真正的攻擊，是讓對方看見自己還沒學會的地方。' +
    (win ? "勝利屬於你，但別忘了回頭看看那些答錯的觀念。" : "失敗的每一題都附上了觀念診斷——修正它們，你的島嶼會更強大。") + "</div>" +
    '<button class="btn primary" id="duelAgain">再來一局</button> ' +
    '<button class="btn" id="duelBack">返回設定</button>';
  res.classList.add("show");
  // 對決紀錄（課本用）＋勝利賺星砂
  recordDuel(duelState.opponent.name, duelState.myScore, duelState.oppScore, win);
  if (win) {
    Game.earn(20, "對決勝利").then((r) => {
      if (r) toast("對決勝利！星砂 ×20 入袋。");
    });
  }
  $("duelAgain").onclick = () => { res.classList.remove("show"); startDuel(); };
  $("duelBack").onclick = () => {
    res.classList.remove("show");
    $("duelSetup").style.display = "";
  };
}

/* ============================================================
 * 分頁 5：問答（RAG 示意）
 * ============================================================ */
function extractKeywords(q) {
  const hits = [];
  // 1) 標籤值直接命中
  const tagValues = new Set();
  SEED_CONTENTS.forEach((c) => c.tags.forEach((t) => tagValues.add(t.value)));
  tagValues.forEach((v) => {
    if (v.length >= 2 && q.includes(v)) hits.push({ kw: v, w: 3 });
  });
  // 2) 雙字滑窗比對標題＋摘要
  const grams = new Set();
  const clean = q.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
  for (let i = 0; i < clean.length - 1; i++) grams.add(clean.slice(i, i + 2));
  return { hits, grams };
}

function ragSearch(q) {
  const { hits, grams } = extractKeywords(q);
  const scored = SEED_CONTENTS.map((c) => {
    let score = 0;
    const hay = c.title + c.summary + c.tags.map((t) => t.value).join("");
    hits.forEach((h) => { if (hay.includes(h.kw)) score += h.w; });
    grams.forEach((g) => { if (hay.includes(g)) score += 0.4; });
    return { c, score };
  }).filter((r) => r.score > 0.8);
  scored.sort((a, b) => b.score - a.score);
  return { results: scored.slice(0, 3), keywords: hits.map((h) => h.kw) };
}

function askQuestion() {
  const input = $("qaInput");
  const q = input.value.trim();
  const out = $("qaOutput");
  if (!q) { toast("先輸入你的問題吧"); input.focus(); return; }

  const { results, keywords } = ragSearch(q);
  if (!results.length) {
    const suggDims = ["CONC", "SUBJ", "LIFE"];
    const sugg = [...new Set(SEED_CONTENTS.flatMap((c) =>
      c.tags.filter((t) => suggDims.includes(t.dim)).map((t) => t.value)
    ))].slice(0, 8);
    out.innerHTML =
      '<div class="qa-empty"><span class="emblem-img" role="img" aria-label="曙光之境"></span><br>目前知識湖沒有足夠內容，要不要換個標籤？<div class="suggest-tags">' +
      sugg.map((s) => '<button class="btn small sugg-btn" data-tag="' + s + '">' + s + "</button>").join("") +
      "</div></div>";
    out.querySelectorAll(".sugg-btn").forEach((b) => {
      b.onclick = () => {
        // 跳到探究頁並勾選該標籤
        exploreState.selected.clear();
        SEED_CONTENTS.forEach((c) => c.tags.forEach((t) => {
          if (t.value === b.dataset.tag) exploreState.selected.add(tagKey(t.dim, t.value));
        }));
        buildExploreFilters();
        renderExplore();
        gotoTab("explore");
        toast("已為你勾選「" + b.dataset.tag + "」標籤");
      };
    });
    return;
  }

  const cites = results.map((r, i) =>
    '<div class="cite-card"><span style="color:var(--text-faint)">[' + (i + 1) + "]</span> " +
    '<span class="ctitle">' + r.c.title + "</span><br>" +
    '<span class="cmeta">' + r.c.source_type + " · " + r.c.duration + " · " +
    r.c.tags.map((t) => t.value).join(" / ") + "</span></div>"
  ).join("");

  const summaryLines = results.map((r, i) =>
    "<strong>[" + (i + 1) + "]</strong> " + r.c.summary.split("。")[0] + "。"
  ).join("<br><br>");

  out.innerHTML =
    '<div class="qa-answer show">' +
    '<div class="pipeline">RAG 流程示意：問題 → 標籤抽取' +
    (keywords.length ? "（" + keywords.slice(0, 4).join("、") + "）" : "") +
    " → 交集過濾 → 相關度排序 → 生成摘要（附引用）</div>" +
    "<div>根據知識湖中的 <strong>" + results.length + "</strong> 筆相關內容，為你整理如下：</div>" +
    '<div style="margin:12px 0;color:var(--text-dim)">' + summaryLines + "</div>" +
    '<div style="font-size:13px;color:var(--text-faint);margin-top:6px">引用來源：</div>' +
    cites +
    '<div style="margin-top:12px;font-size:13px;color:var(--text-faint)">想深入探索？到「探究」頁用標籤交集找更多相關內容，或到「島嶼」頁把這次學習沉澱為領土。</div>' +
    "</div>";
}

function initQA() {
  $("qaAsk").onclick = askQuestion;
  $("qaInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") askQuestion();
  });
}

/* ============================================================
 * 星砂經濟 ＋ 專屬課本 ＋ 雷達戰鬥（純遊戲）
 * 學習 → 星砂 → 武器 → 挑戰模擬拓荒者。點到為止，不影響真實使用者。
 * ============================================================ */
const WEAPONS = {
  dart:   { name: "星塵飛鏢", cost: 20, type: "attack", dmg: [10, 20],
            desc: "輕巧迅捷的星砂飛鏢，對拓荒者造成 10–20 傷害。" },
  wave:   { name: "潮汐巨浪", cost: 50, type: "attack", dmg: [25, 40],
            desc: "引動知識之海的巨浪，造成 25–40 傷害。" },
  shield: { name: "曙光護盾", cost: 30, type: "defense",
            desc: "啟動後抵擋下一次反擊，守護你的島嶼。" },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const Game = {
  points: 0,
  inventory: {},
  async refresh() {
    if (!Auth.user || !Auth.token) { this.points = 0; this.inventory = {}; }
    else {
      try {
        const d = await api("/api/v1/game/state");
        this.points = d.points; this.inventory = d.inventory || {};
      } catch (e) { /* 離線：保留舊值 */ }
    }
    renderPointsPills();
    renderShop();
  },
  async earn(amount, reason) {
    if (!Auth.user) return null;
    try {
      const d = await api("/api/v1/game/earn", {
        method: "POST", body: JSON.stringify({ amount, reason: reason || "" }),
      });
      this.points = d.points;
      renderPointsPills();
      return d;
    } catch (e) { return null; }
  },
  async buy(itemId) {
    const d = await api("/api/v1/game/shop/buy", {
      method: "POST", body: JSON.stringify({ item_id: itemId }),
    });
    this.points = d.points; this.inventory = d.inventory;
    renderPointsPills();
    return d;
  },
  async useItem(itemId) {
    const d = await api("/api/v1/game/use", {
      method: "POST", body: JSON.stringify({ item_id: itemId }),
    });
    this.inventory = d.inventory;
    return d;
  },
};

function renderPointsPills() {
  const v = $("pointsVal");
  if (v) v.textContent = Game.points;
  const r = document.querySelector("#radarPoints b");
  if (r) r.textContent = Game.points;
}

/* ---------- 兵器庫商店 ---------- */
function renderShop() {
  const grid = $("shopGrid");
  if (!grid) return;
  grid.innerHTML = "";
  Object.entries(WEAPONS).forEach(([id, w]) => {
    const owned = Game.inventory[id] || 0;
    const card = document.createElement("div");
    card.className = "weapon-card";
    const info = document.createElement("div");
    info.innerHTML =
      '<div class="w-name">' + w.name + "</div>" +
      '<div class="w-desc">' + w.desc + "</div>" +
      '<div class="w-meta"><span class="w-cost">星砂 ' + w.cost + '</span>' +
      "<span>擁有 ×" + owned + "</span></div>";
    const btn = document.createElement("button");
    btn.className = "btn" + (Auth.user && Game.points >= w.cost ? " primary" : "");
    btn.textContent = !Auth.user ? "登入後購買" : (Game.points >= w.cost ? "購買" : "星砂不足");
    btn.disabled = !Auth.user || Game.points < w.cost;
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await Game.buy(id);
        toast("獲得「" + w.name + "」！去挑戰一位拓荒者吧。");
        renderShop();
      } catch (e) {
        toast(e.message || "購買失敗");
        btn.disabled = false;
      }
    };
    card.appendChild(info);
    card.appendChild(btn);
    grid.appendChild(card);
  });
  renderBattleLog();
}

/* ---------- 戰報 ---------- */
function battleLogKey() {
  return "dawn_battlelog_" + (Auth.user ? Auth.user.id : "guest");
}
function pushBattleLog(text) {
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(battleLogKey()) || "[]"); } catch (e) {}
  arr.unshift(new Date().toLocaleString("zh-TW", { hour12: false }) + " · " + text);
  try { localStorage.setItem(battleLogKey(), JSON.stringify(arr.slice(0, 10))); } catch (e) {}
  renderBattleLog();
}
function renderBattleLog() {
  const ul = $("battleLogList");
  if (!ul) return;
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(battleLogKey()) || "[]"); } catch (e) {}
  ul.innerHTML = arr.length
    ? arr.map((t) => "<li></li>").join("")
    : '<li class="small" style="color:var(--text-3)">還沒有戰報。選一位拓荒者，發起你的第一場挑戰吧。</li>';
  if (arr.length) {
    [...ul.children].forEach((li, i) => { li.textContent = arr[i]; });
  }
}

/* ---------- 戰鬥 ---------- */
const battle = { oppId: null, meHp: 100, oppHp: 100, shieldArmed: false, busy: false };

function battleStore() {
  const k = "dawn_battle_" + (Auth.user ? Auth.user.id : "guest");
  try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; }
}
function getOppHp(id) {
  const v = battleStore()["hp_" + id];
  return v != null ? v : 100;
}
function setOppHp(id, hp) {
  const k = "dawn_battle_" + (Auth.user ? Auth.user.id : "guest");
  const s = battleStore();
  s["hp_" + id] = hp;
  try { localStorage.setItem(k, JSON.stringify(s)); } catch (e) {}
}

function openBattle(oppId) {
  if (!Auth.user) { openAuthModal("login"); return; }
  const p = PIONEERS.find((x) => x.id === oppId);
  if (!p || p.isMe) return;
  battle.oppId = oppId;
  battle.meHp = 100;
  battle.oppHp = getOppHp(oppId);
  battle.shieldArmed = false;
  battle.busy = false;
  $("battleTitle").textContent = "挑戰 " + p.name;
  $("battleMeName").textContent = Auth.user.name;
  $("battleOppName").textContent = p.name;
  $("battleArenaLog").innerHTML = "";
  blog("星海戰鼓擂起——" + p.name + " 接受了你的挑戰！");
  updateBattleHp();
  renderBattleWeapons();
  const m = $("battleModal");
  m.classList.add("show");
  m.setAttribute("aria-hidden", "false");
}
function closeBattle() {
  const m = $("battleModal");
  m.classList.remove("show");
  m.setAttribute("aria-hidden", "true");
  if (battle.oppId) setOppHp(battle.oppId, battle.oppHp);
}
function blog(msg, cls) {
  const log = $("battleArenaLog");
  const div = document.createElement("div");
  div.className = "bmsg" + (cls ? " " + cls : "");
  div.textContent = msg;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
function updateBattleHp() {
  $("battleMeHp").style.width = Math.max(0, battle.meHp) + "%";
  $("battleOppHp").style.width = Math.max(0, battle.oppHp) + "%";
  $("battleMeHpN").textContent = Math.max(0, battle.meHp);
  $("battleOppHpN").textContent = Math.max(0, battle.oppHp);
}
function flashHp(id) {
  const el = $(id);
  el.classList.remove("hit");
  void el.offsetWidth;
  el.classList.add("hit");
}
function renderBattleWeapons() {
  const box = $("battleWeapons");
  box.innerHTML = "";
  let any = false;
  Object.entries(WEAPONS).forEach(([id, w]) => {
    const owned = Game.inventory[id] || 0;
    if (!owned) return;
    any = true;
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = (w.type === "attack" ? "使用" : "啟動") + "「" + w.name + "」×" + owned;
    b.onclick = () => (w.type === "attack" ? battleAttack(id) : battleShield(id));
    box.appendChild(b);
  });
  if (!any) {
    box.innerHTML = '<div class="small" style="color:var(--text-3)">武器庫空空如也——關閉視窗，去兵器庫用星砂買一把吧。</div>';
  }
}

async function battleAttack(id) {
  if (battle.busy) return;
  const w = WEAPONS[id];
  battle.busy = true;
  try { await Game.useItem(id); }
  catch (e) { blog("武器不足，先去兵器庫補給吧。"); battle.busy = false; return; }
  renderBattleWeapons();
  renderShop();
  const dmg = w.dmg[0] + Math.floor(Math.random() * (w.dmg[1] - w.dmg[0] + 1));
  battle.oppHp = Math.max(0, battle.oppHp - dmg);
  blog("你擲出「" + w.name + "」，造成 " + dmg + " 點傷害！", "me");
  updateBattleHp();
  flashHp("battleOppHp");
  await wait(650);
  if (battle.oppHp <= 0) {
    await winBattle();
    battle.busy = false;
    return;
  }
  await counterAttack();
  battle.busy = false;
}

async function battleShield(id) {
  if (battle.busy || battle.shieldArmed) return;
  battle.busy = true;
  try { await Game.useItem(id); }
  catch (e) { battle.busy = false; return; }
  battle.shieldArmed = true;
  blog("「曙光護盾」展開——下一次反擊將被抵擋。", "me");
  renderBattleWeapons();
  renderShop();
  battle.busy = false;
}

async function counterAttack() {
  const p = PIONEERS.find((x) => x.id === battle.oppId);
  if (Math.random() > 0.45) {
    blog("對方按兵不動，似乎在觀察你。");
    return;
  }
  const dmg = 5 + Math.floor(Math.random() * 11);
  if (battle.shieldArmed) {
    battle.shieldArmed = false;
    blog("對方反擊 " + dmg + " 點——被曙光護盾擋下了！", "block");
    return;
  }
  battle.meHp = Math.max(0, battle.meHp - dmg);
  blog(p.name + " 反擊，造成 " + dmg + " 點傷害！", "opp");
  updateBattleHp();
  flashHp("battleMeHp");
  await wait(650);
  if (battle.meHp <= 0) {
    blog("你的島嶼需要休整……休整完畢，重新振作！", "opp");
    battle.meHp = 100;
    updateBattleHp();
    pushBattleLog("與 " + p.name + " 激戰後休整，雖敗猶榮");
  }
}

async function winBattle() {
  const p = PIONEERS.find((x) => x.id === battle.oppId);
  blog(p.name + " 的星艦黯淡下去——你贏了！", "win");
  setOppHp(battle.oppId, 100);
  battle.oppHp = 100;
  const r = await Game.earn(20, "挑戰勝利");
  blog("獲得星砂 ×20" + (r ? "（目前 " + Game.points + "）" : "") + "！", "win");
  pushBattleLog("擊敗 " + p.name + "，獲得星砂 ×20");
  updateBattleHp();
  renderBattleWeapons();
}

/* ---------- 專屬課本 ---------- */
function actionLabel(action) {
  try {
    const a = ISLAND_ACTIONS.find((x) => ACTION_MAP[x.id] === action);
    if (a) return a.label || a.name || a.id;
  } catch (e) {}
  return action;
}

async function buildTextbook() {
  const gate = $("textbookGate"), body = $("textbookBody");
  if (!Auth.user || !Auth.token) {
    gate.style.display = "block";
    body.innerHTML = "";
    return;
  }
  gate.style.display = "none";
  body.innerHTML = '<div class="panel"><div class="small" style="color:var(--text-3)">正在翻閱星海，為你編纂專屬課本…</div></div>';
  // 學習筆記章節（卷首）
  let notesHtml = "";
  try {
    if (window.WorldUI && WorldUI.buildNotesChapter) {
      notesHtml = await WorldUI.buildNotesChapter();
    }
  } catch (e) { notesHtml = ""; }
  let logs = [], isl = null;
  try {
    const d = await api("/api/v1/islands/" + Auth.user.id + "/logs?limit=100");
    logs = d.logs || [];
  } catch (e) {}
  try { isl = await api("/api/v1/islands/" + Auth.user.id); } catch (e) {}
  const favIds = [...exploreState.favorites];
  const favTitles = favIds.map((id) => {
    const c = (typeof SEED_CONTENTS !== "undefined" ? SEED_CONTENTS : []).find((x) => x.id === id);
    return c ? c.title : String(id);
  });
  let duels = [];
  try { duels = JSON.parse(localStorage.getItem("dawn_duels_" + Auth.user.id) || "[]"); } catch (e) {}
  const wins = duels.filter((d) => d.win).length;
  const today = new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" });
  const territory = isl && isl.territory != null ? isl.territory : "—";

  // 第一章：按日期分組的成長史
  const byDate = {};
  logs.forEach((e) => {
    const d = String(e.log_date || e.created_at || "").slice(0, 10) || "未知日期";
    (byDate[d] = byDate[d] || []).push(e);
  });
  const dates = Object.keys(byDate).sort().reverse();
  const ch1 = dates.length
    ? dates.map((d) => {
        const items = byDate[d].map((e) =>
          '<li><span class="ltime">' + String(e.created_at || "").slice(11, 16) + "</span>" +
          actionLabel(e.action) + "（領土 +" + e.delta + "）</li>"
        ).join("");
        return '<h4 class="book-date">' + d + '</h4><ul class="book-timeline">' + items + "</ul>";
      }).join("")
    : '<p class="small" style="color:var(--text-3)">還沒有開疆紀錄。去島嶼頁完成學習行為，你的故事就會從這裡開始。</p>';

  const ch2 = favTitles.length
    ? '<ul class="book-list">' + favTitles.map((t) => "<li>" + t + "</li>").join("") + "</ul>"
    : '<p class="small" style="color:var(--text-3)">還沒有收藏。去探究頁把喜歡的主題收進星圖吧。</p>';

  const ch3 = duels.length
    ? '<div class="small" style="color:var(--text-3);margin-bottom:10px">共出戰 ' + duels.length +
      " 場，勝 " + wins + " 場（勝率 " + Math.round((wins / duels.length) * 100) + "%）。</div>" +
      '<ul class="book-list">' + duels.slice(0, 10).map((d) =>
        "<li>" + new Date(d.t).toLocaleDateString("zh-TW") + " · 對戰 " + d.opp +
        "（" + d.me + " : " + d.oppScore + "）" + (d.win ? " —— 勝利" : "") + "</li>"
      ).join("") + "</ul>"
    : '<p class="small" style="color:var(--text-3)">還沒有對決紀錄。去對決頁找一位拓荒者交鋒吧。</p>';

  const roleName = Auth.user.persona && Auth.user.persona.role_name;
  body.innerHTML =
    '<div class="panel book-cover">' +
      '<span class="trophy-emblem book-emblem" role="img" aria-label="曙光之境"></span>' +
      '<div class="book-kicker">曙光之境 · 慢荒宇宙</div>' +
      (roleName ? '<div class="book-role">' + roleName + "</div>" : "") +
      '<h1 class="book-title">' + Auth.user.name + " 的知識圖鑑</h1>" +
      '<div class="book-sub">根據你的學習軌跡自動編纂 · ' + today + '</div>' +
      '<div class="book-stats">' +
        '<div><b>' + territory + '</b><span>領土</span></div>' +
        '<div><b>' + Game.points + '</b><span>星砂</span></div>' +
        '<div><b>' + favTitles.length + '</b><span>收藏</span></div>' +
        '<div><b>' + duels.length + '</b><span>對決</span></div>' +
      "</div>" +
    "</div>" +
    '<div class="panel"><h2 class="h2">目錄</h2><ol class="book-toc">' +
      (notesHtml ? "<li>我的筆記 —— 每一場費曼戰役的學習筆記</li>" : "") +
      "<li>島嶼成長史 —— 你的每一次開疆拓土</li>" +
      "<li>收藏星圖 —— 你親手收下的主題</li>" +
      "<li>對決戰績 —— 每一場觀念交鋒</li>" +
    "</ol></div>" +
    notesHtml +
    '<div class="panel"><h2 class="h2"><span class="ch-num">壹</span>島嶼成長史</h2>' + ch1 + "</div>" +
    '<div class="panel"><h2 class="h2"><span class="ch-num">貳</span>收藏星圖</h2>' + ch2 + "</div>" +
    '<div class="panel"><h2 class="h2"><span class="ch-num">參</span>對決戰績</h2>' + ch3 + "</div>" +
    '<div class="panel book-colophon"><div class="small" style="color:var(--text-3)">跋 · 這本書沒有終點。你每一次探索、對決、提問，都會變成下一頁。慢荒宇宙與你同行。</div></div>';
}

/* ---------- 收藏（需登入，後端持久化） ---------- */
async function loadFavorites() {
  exploreState.favorites.clear();
  if (!Auth.user || !Auth.token) return;
  try {
    const d = await api("/api/v1/favorites");
    (d.favorites || []).forEach((id) => exploreState.favorites.add(id));
  } catch (e) { /* 離線：保持空集合 */ }
}

function paintFavBtn(btn, fav) {
  if (btn) btn.textContent = fav ? "★ 已收藏" : "☆ 收藏";
}

async function toggleFavorite(contentId, btn) {
  if (!Auth.user || !Auth.token) {
    openAuthModal("login");
    toast("登入後才能收藏，進度會跟著帳號走。");
    return;
  }
  const has = exploreState.favorites.has(contentId);
  // 樂觀更新
  if (has) exploreState.favorites.delete(contentId);
  else exploreState.favorites.add(contentId);
  paintFavBtn(btn, !has);
  try {
    if (has) {
      await api("/api/v1/favorites/" + encodeURIComponent(contentId), { method: "DELETE" });
      toast("已取消收藏");
    } else {
      await api("/api/v1/favorites", {
        method: "POST", body: JSON.stringify({ content_id: contentId }),
      });
      toast("★ 已收藏");
    }
  } catch (e) {
    // 失敗回滾
    if (has) exploreState.favorites.add(contentId);
    else exploreState.favorites.delete(contentId);
    paintFavBtn(btn, has);
    toast("收藏失敗：" + (e.message || "請重試"));
  }
}

/* ---------- 對決紀錄（課本用） ---------- */
function recordDuel(oppName, meScore, oppScore, win) {
  try {
    const k = "dawn_duels_" + (Auth.user ? Auth.user.id : "guest");
    const arr = JSON.parse(localStorage.getItem(k) || "[]");
    arr.unshift({ t: Date.now(), opp: oppName, me: meScore, oppScore, win: !!win });
    localStorage.setItem(k, JSON.stringify(arr.slice(0, 30)));
  } catch (e) {}
}

function initGame() {
  $("battleClose").onclick = closeBattle;
  $("battleModal").addEventListener("click", (e) => {
    if (e.target.id === "battleModal") closeBattle();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("battleModal").classList.contains("show")) closeBattle();
  });
  const tl = $("textbookLogin");
  if (tl) tl.onclick = () => openAuthModal("login");
  Game.refresh();
}

/* ============================================================
 * 引路儀式：註冊後的人格測驗（情境式）
 * 五個故事問題 → 四種角色 → 存入 users.persona，供未來個人化學習使用。
 * ============================================================ */
const ONBOARD = {
  intro: [
    "你在寂靜中醒來。",
    "頭頂是緩慢旋轉的星海，腳下是微微發光的潮汐。空氣裡有一種味道——像雨後的圖書館，混著遠方篝火的煙。",
    "遠處，一座島嶼正從海面上升起。那是你的島，還沒有名字，還沒有故事。",
    "但在你踏上去之前，一個聲音從星海深處傳來——",
    "「旅人啊。在你成為這片星海的一部分之前，讓我先認識你。回答我五個問題，我會告訴你，你是什麼樣的人。」",
  ],
  questions: [
    {
      story: "潮汐退去，沙灘上留下兩樣東西：一張殘缺的星圖，和一枚發燙的指南針。你先拿起——",
      options: [
        { t: "星圖", d: "先看見全貌，再決定往哪走。", dx: 1, dy: 0 },
        { t: "指南針", d: "方向對了，路自然會出現。", dx: -1, dy: 0 },
      ],
    },
    {
      story: "沿著海岸前行，前方傳來爭吵聲。兩名拓荒者為了一條航線爭執不下。你會——",
      options: [
        { t: "走上前去", d: "也許聽一聽，就能幫上忙。", dx: 0, dy: 1 },
        { t: "靜靜繞開", d: "把心力留給自己的路。", dx: 0, dy: -1 },
        { t: "記下關鍵", d: "先查清楚，回去再說。", dx: -1, dy: 0 },
      ],
    },
    {
      story: "夜幕降臨，你在沙灘上升起篝火。火光搖曳中，你決定今晚要做一件事——",
      options: [
        { t: "畫下星星", d: "把白天看到的星都連成一幅圖。", dx: 1, dy: 0 },
        { t: "研究指南針", d: "弄懂它為什麼發燙。", dx: -1, dy: 0 },
        { t: "去找拓荒者們", d: "圍著火堆，交換彼此的故事。", dx: 0, dy: 1 },
      ],
    },
    {
      story: "清晨，海面上升起濃霧。霧中有個從沒見過的東西在發光。你——",
      options: [
        { t: "走進霧裡", d: "未知，就是邀請函。", dx: 1, dy: -1 },
        { t: "結伴再去", d: "準備齊全，和同伴一起進去。", dx: -1, dy: 1 },
        { t: "霧外觀察", d: "先記錄它的光如何變化。", dx: -1, dy: 0 },
      ],
    },
    {
      story: "最後一個問題。聲音問：「如果只能帶一樣東西上島，你選——」",
      options: [
        { t: "空白的航海日誌", d: "每一頁，都等著被星海寫滿。", dx: 1, dy: 0 },
        { t: "磨利的刻刀", d: "把重要的事，一筆一筆刻下來。", dx: -1, dy: 0 },
        { t: "能分給別人的燈", d: "光，要有人一起看才亮。", dx: 0, dy: 1 },
      ],
    },
  ],
  roles: {
    weaver: {
      name: "星圖織者",
      desc: "你把散落的星星連成圖，把陌生人變成同伴。你的島嶼，注定成為眾人交會的港口。",
      study: "你適合從連結中學習：把不同領域的觀念織在一起，多參加共修，和別人討論。",
    },
    wanderer: {
      name: "星海漫遊者",
      desc: "你不趕路，路會自己長出來。你的好奇沒有邊界，你的島嶼也一樣。",
      study: "你適合從探索中學習：廣泛涉獵，讓好奇心帶路，別怕繞遠路。",
    },
    keeper: {
      name: "曙光守望者",
      desc: "你為同伴舉燈，也為真理守夜。你的島嶼，是迷航者看見的第一道光。",
      study: "你適合從守護中學習：把學會的東西教給別人，在共修與討論中長大。",
    },
    diver: {
      name: "深淵潛行者",
      desc: "你向深處去，帶回別人看不見的光。你的島嶼，深不見底。",
      study: "你適合從深潛中學習：選一個題目鑽到底，弄懂它發燙的原因。",
    },
  },
};

function onboardRoleId(dx, dy) {
  const key = (dx >= 0 ? "E" : "F") + (dy >= 0 ? "S" : "A");
  return { ES: "weaver", EA: "wanderer", FS: "keeper", FA: "diver" }[key];
}

const onboard = { step: 0, dx: 0, dy: 0, choices: [] };

function openOnboarding() {
  if (!Auth.user) { openAuthModal("login"); return; }
  onboard.step = 0; onboard.dx = 0; onboard.dy = 0; onboard.choices = [];
  renderOnboard();
  const m = $("onboardModal");
  m.classList.add("show");
  m.setAttribute("aria-hidden", "false");
}
function closeOnboarding() {
  const m = $("onboardModal");
  m.classList.remove("show");
  m.setAttribute("aria-hidden", "true");
}

function renderOnboard() {
  const body = $("onboardBody");
  const total = ONBOARD.questions.length;
  if (onboard.step === 0) {
    body.innerHTML =
      '<div class="ob-kicker">引路儀式</div>' +
      '<div class="ob-story">' + ONBOARD.intro.map((p) => "<p>" + p + "</p>").join("") + "</div>" +
      '<button class="btn primary ob-big" id="obStart">開始引路儀式</button>' +
      '<button class="ob-skip" id="obSkip">跳過，直接進入星海</button>';
    $("obStart").onclick = () => { onboard.step = 1; renderOnboard(); };
    $("obSkip").onclick = closeOnboarding;
    return;
  }
  if (onboard.step <= total) {
    const q = ONBOARD.questions[onboard.step - 1];
    const dots = Array.from({ length: total }, (_, i) =>
      '<i class="' + (i < onboard.step - 1 ? "done" : i === onboard.step - 1 ? "now" : "") + '"></i>'
    ).join("");
    body.innerHTML =
      '<div class="ob-kicker">引路儀式 · ' + onboard.step + " / " + total + "</div>" +
      '<div class="ob-dots">' + dots + "</div>" +
      '<div class="ob-story"><p>' + q.story + "</p></div>" +
      '<div class="ob-options">' +
        q.options.map((o, i) =>
          '<button class="ob-opt" data-i="' + i + '"><b>' + o.t + "</b><span>" + o.d + "</span></button>"
        ).join("") +
      "</div>" +
      '<button class="ob-skip" id="obSkip">跳過</button>';
    body.querySelectorAll(".ob-opt").forEach((b) => {
      b.onclick = () => {
        const o = q.options[+b.dataset.i];
        onboard.dx += o.dx; onboard.dy += o.dy;
        onboard.choices.push({ q: onboard.step, option: o.t });
        onboard.step++;
        renderOnboard();
      };
    });
    $("obSkip").onclick = closeOnboarding;
    return;
  }
  const roleId = onboardRoleId(onboard.dx, onboard.dy);
  const role = ONBOARD.roles[roleId];
  body.innerHTML =
    '<div class="ob-kicker">儀式完成</div>' +
    '<span class="trophy-emblem ob-emblem" role="img" aria-label="曙光之境"></span>' +
    '<div class="ob-role-label">星海說，你是——</div>' +
    '<h2 class="ob-role-name">' + role.name + "</h2>" +
    '<div class="ob-story"><p>' + role.desc + "</p></div>" +
    '<div class="ob-study"><b>你的學習風格</b><p>' + role.study + "</p></div>" +
    '<button class="btn primary ob-big" id="obDone">踏上我的島</button>';
  $("obDone").onclick = async () => {
    const btn = $("obDone");
    btn.disabled = true;
    btn.textContent = "星海正在記住你…";
    const persona = {
      role: roleId,
      role_name: role.name,
      axes: { x: onboard.dx, y: onboard.dy },
      choices: onboard.choices,
      at: new Date().toISOString().slice(0, 10),
    };
    try {
      const d = await api("/api/v1/auth/persona", {
        method: "POST", body: JSON.stringify({ persona }),
      });
      if (Auth.user) {
        Auth.user.persona = d.persona;
        try { localStorage.setItem("dawn_user", JSON.stringify(Auth.user)); } catch (e) {}
      }
      toast("星海記住了你是" + role.name + "。");
    } catch (e) { /* 離線：下次再存 */ }
    closeOnboarding();
    hidePersonaBanner();
    syncPersonaTag();
    gotoTab("island");
  };
}

/* ---------- 人格橫幅（尚未引路的使用者） ---------- */
function maybeShowPersonaBanner() {
  const b = $("personaBanner");
  if (!b) return;
  const done = !!(Auth.user && Auth.user.persona && Auth.user.persona.role);
  const dismissed = localStorage.getItem("dawn_persona_dismissed") === "1";
  b.style.display = (!done && !dismissed && Auth.user) ? "" : "none";
  syncPersonaTag();
}
function hidePersonaBanner() {
  const b = $("personaBanner");
  if (b) b.style.display = "none";
}
function syncPersonaTag() {
  const tag = $("personaTag"), retake = $("retakePersona");
  const roleName = Auth.user && Auth.user.persona && Auth.user.persona.role_name;
  if (tag) {
    tag.style.display = roleName ? "" : "none";
    tag.textContent = roleName || "";
  }
  if (retake) retake.style.display = Auth.user ? "" : "none";
}
function initOnboarding() {
  const s = $("personaStart");
  if (s) s.onclick = openOnboarding;
  const d = $("personaDismiss");
  if (d) d.onclick = () => {
    try { localStorage.setItem("dawn_persona_dismissed", "1"); } catch (e) {}
    hidePersonaBanner();
  };
  const r = $("retakePersona");
  if (r) r.onclick = openOnboarding;
}

/* 從後端同步完整使用者（含 persona） */
async function refreshMe() {
  if (!Auth.token) return;
  try {
    const d = await api("/api/v1/auth/me");
    if (d.user) {
      Auth.user = d.user;
      try { localStorage.setItem("dawn_user", JSON.stringify(d.user)); } catch (e) {}
      renderAuthBar();
    }
  } catch (e) { /* 離線：保留本機 */ }
}

/* ============================================================
 * 帳號管理
 * ============================================================ */
async function buildAccount() {
  const gate = $("accountGate"), body = $("accountBody");
  if (!Auth.user || !Auth.token) {
    gate.style.display = "block";
    body.style.display = "none";
    return;
  }
  gate.style.display = "none";
  body.style.display = "";
  let me = Auth.user;
  try {
    const d = await api("/api/v1/auth/me");
    if (d.user) {
      me = d.user;
      Auth.user = me;
      try { localStorage.setItem("dawn_user", JSON.stringify(me)); } catch (e) {}
    }
  } catch (e) { /* 離線：用本機資料 */ }
  const roleName = me.persona && me.persona.role_name;
  const created = String(me.created_at || "").slice(0, 10);
  $("acctProfile").innerHTML =
    '<div class="acct-row"><span>暱稱</span><b>' + me.name + "</b></div>" +
    '<div class="acct-row"><span>Email</span><b>' + (me.email || "未設定") + "</b></div>" +
    (roleName ? '<div class="acct-row"><span>角色</span><b>' + roleName + "</b></div>" : "") +
    (created ? '<div class="acct-row"><span>加入星海</span><b>' + created + "</b></div>" : "");
  $("acctEmail").value = me.email || "";
  $("acctSecQNow").textContent = me.sec_question || "尚未設定";
  // 重置刪除流程
  $("deleteStep2").style.display = "none";
  $("deleteStep1").style.display = "";
  $("acctDeletePw").value = "";
  renderAuthBar();
}

async function saveAcctEmail() {
  const v = $("acctEmail").value.trim();
  const btn = $("acctEmailSave");
  btn.disabled = true;
  try {
    const d = await api("/api/v1/auth/me", {
      method: "PATCH", body: JSON.stringify({ email: v }),
    });
    if (Auth.user) {
      Auth.user.email = d.email;
      try { localStorage.setItem("dawn_user", JSON.stringify(Auth.user)); } catch (e) {}
    }
    toast(v ? "Email 已更新。" : "Email 已清空。");
    buildAccount();
  } catch (e) {
    toast(e.message || "更新失敗");
  } finally {
    btn.disabled = false;
  }
}

async function changeAcctPassword() {
  const oldPw = $("acctOldPw").value;
  const newPw = $("acctNewPw").value;
  if (newPw.length < 4) { toast("新密碼至少需要 4 個字元。"); return; }
  const btn = $("acctPwSave");
  btn.disabled = true;
  try {
    const d = await api("/api/v1/auth/password", {
      method: "POST",
      body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
    });
    $("acctOldPw").value = "";
    $("acctNewPw").value = "";
    toast(d.reason || "密碼已更新。");
    // 密碼已輪換：舊 token 失效，重新登入
    Auth.clear();
    Game.refresh();
    openAuthModal("login");
  } catch (e) {
    toast(e.message || "修改失敗");
    btn.disabled = false;
  }
}

async function exportHistory() {
  const btn = $("acctExport");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "打包中…";
  try {
    const d = await api("/api/v1/export");
    const uid = Auth.user.id;
    let duels = [], battleLog = [];
    try { duels = JSON.parse(localStorage.getItem("dawn_duels_" + uid) || "[]"); } catch (e) {}
    try { battleLog = JSON.parse(localStorage.getItem("dawn_battlelog_" + uid) || "[]"); } catch (e) {}
    d.local = { duels, battle_log: battleLog };
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dawn-edu-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("學習歷程已下載。");
  } catch (e) {
    toast(e.message || "匯出失敗");
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function deleteAccount() {
  const pw = $("acctDeletePw").value;
  if (!pw) { toast("請輸入密碼確認。"); return; }
  const btn = $("acctDeleteConfirm");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "刪除中…";
  try {
    await api("/api/v1/auth/me", {
      method: "DELETE", body: JSON.stringify({ password: pw }),
    });
    Auth.clear();
    Game.refresh();
    exploreState.favorites.clear();
    try {
      ["dawn_duels_", "dawn_battlelog_", "dawn_battle_"].forEach((p) =>
        localStorage.removeItem(p + Auth.user.id));
    } catch (e) {}
    toast("帳號已刪除。星海會記得你曾來過。");
    gotoTab("explore");
  } catch (e) {
    toast(e.message || "刪除失敗");
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function saveAcctSecQa() {
  const q = $("acctSecQ").value === "__custom" ? $("acctSecQCustom").value.trim() : $("acctSecQ").value;
  const a = $("acctSecA").value.trim();
  if (!q) { toast("請選擇或輸入安全問題。"); return; }
  if (!a) { toast("請輸入答案。"); return; }
  const btn = $("acctSecQSave");
  btn.disabled = true;
  try {
    const d = await api("/api/v1/auth/security-qa", {
      method: "PUT",
      body: JSON.stringify({ sec_question: q, sec_answer: a }),
    });
    $("acctSecA").value = "";
    toast(d.reason || "安全問題已更新。");
    buildAccount();
  } catch (e) {
    toast(e.message || "更新失敗");
  } finally {
    btn.disabled = false;
  }
}

function initAccount() {
  $("accountLogin").onclick = () => openAuthModal("login");
  $("acctEmailSave").onclick = saveAcctEmail;
  $("acctPwSave").onclick = changeAcctPassword;
  $("acctSecQSave").onclick = saveAcctSecQa;
  $("acctSecQ").onchange = () => {
    $("acctSecQCustom").style.display = $("acctSecQ").value === "__custom" ? "" : "none";
  };
  $("acctExport").onclick = exportHistory;
  $("acctDeleteBtn").onclick = () => {
    $("deleteName").textContent = Auth.user ? Auth.user.name : "";
    $("deleteStep1").style.display = "none";
    $("deleteStep2").style.display = "";
  };
  $("acctDeleteCancel").onclick = () => {
    $("deleteStep2").style.display = "none";
    $("deleteStep1").style.display = "";
    $("acctDeletePw").value = "";
  };
  $("acctDeleteConfirm").onclick = deleteAccount;
}

/* ============================================================
 * 初始化
 * ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  initAuth();
  await loadFavorites();
  buildExploreFilters();
  renderExplore();
  buildIslandActions();
  renderIslandStats();
  drawIsland();
  initRadar();
  initDuel();
  initQA();
  initGame();
  initOnboarding();
  initAccount();
});
