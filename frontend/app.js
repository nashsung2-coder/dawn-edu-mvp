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

/* ---------------- 分頁切換 ---------------- */
(function initTabs() {
  const nav = $("mainNav");
  nav.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    nav.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-page").forEach((p) => p.classList.remove("active"));
    $("page-" + btn.dataset.tab).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (btn.dataset.tab === "island") loadIsland();
  });
})();

function gotoTab(name) {
  document.querySelectorAll("#mainNav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name)
  );
  document.querySelectorAll(".tab-page").forEach((p) => p.classList.remove("active"));
  $("page-" + name).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "island") loadIsland();
}

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

  // 維度分組 checkbox
  const wrap = $("dimFilters");
  wrap.innerHTML = "";
  const order = ["SUBJ", "CONC", "COGN", "STAGE", "LIFE", "INTER", "DIFF"];
  order.forEach((dim) => {
    const values = [...new Set(SEED_CONTENTS.flatMap((c) =>
      c.tags.filter((t) => t.dim === dim).map((t) => t.value)
    ))].sort();
    if (!values.length) return;
    const g = document.createElement("div");
    g.className = "dim-group";
    g.innerHTML = "<h4>" + dim + " · " + DIM_NAMES[dim] + "</h4>";
    const list = document.createElement("div");
    list.className = "tag-list";
    values.forEach((v) => {
      const key = tagKey(dim, v);
      const label = document.createElement("label");
      label.className = "tag-check" + (exploreState.selected.has(key) ? " on" : "");
      label.innerHTML = '<input type="checkbox">' + v;
      label.querySelector("input").checked = exploreState.selected.has(key);
      label.onclick = (e) => {
        e.preventDefault();
        if (exploreState.selected.has(key)) exploreState.selected.delete(key);
        else exploreState.selected.add(key);
        label.classList.toggle("on", exploreState.selected.has(key));
        renderExplore();
      };
      list.appendChild(label);
    });
    g.appendChild(list);
    wrap.appendChild(g);
  });

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
  const r = await fetch(base + path, {
    method: o.method || "GET",
    headers: Object.assign(
      { "Content-Type": "application/json" },
      Auth.headers(),
      o.headers || {}
    ),
    body: o.body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw { status: r.status, message: data.detail || ("請求失敗（" + r.status + "）") };
  return data;
}

function renderAuthBar() {
  const bar = $("authBar");
  bar.innerHTML = "";
  if (Auth.user) {
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
      loadIsland();
      toast("已登出，星海會記得你，下次見");
    };
    bar.appendChild(pill);
    bar.appendChild(btn);
  } else {
    const btn = document.createElement("button");
    btn.className = "auth-btn";
    btn.textContent = "登入 / 註冊";
    btn.onclick = () => openAuthModal("login");
    bar.appendChild(btn);
  }
}

let authMode = "login";

function openAuthModal(mode) {
  authMode = mode === "register" ? "register" : "login";
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

function syncAuthModeUI() {
  const isLogin = authMode === "login";
  $("authTitle").textContent = isLogin ? "歡迎回來，拓荒者" : "在星海中留下你的名字";
  $("authSubmit").textContent = isLogin ? "登入" : "註冊並啟程";
}

async function submitAuth() {
  const name = $("authName").value.trim();
  const pw = $("authPass").value;
  const err = $("authErr");
  err.textContent = "";
  if (!name) { err.textContent = "請輸入暱稱。"; return; }
  if (pw.length < 4) { err.textContent = "密碼至少需要 4 個字元。"; return; }
  const btn = $("authSubmit");
  btn.disabled = true;
  try {
    const data = await api("/api/v1/auth/" + authMode, {
      method: "POST",
      body: JSON.stringify({ name, password: pw }),
    });
    Auth.save(data.token, data.user);
    closeAuthModal();
    toast(data.reason || "歡迎！");
    if ($("page-island").classList.contains("active")) loadIsland();
  } catch (e) {
    err.textContent = e.message || "發生錯誤，請重試。";
  } finally {
    btn.disabled = false;
  }
}

function initAuth() {
  Auth.init();
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
      const b = e.currentTarget;
      if (exploreState.favorites.has(c.id)) {
        exploreState.favorites.delete(c.id);
        b.textContent = "☆ 收藏";
        toast("已取消收藏");
      } else {
        exploreState.favorites.add(c.id);
        b.textContent = "★ 已收藏";
        toast("★ 已收藏：「" + c.title.slice(0, 18) + "…」");
      }
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
      const navBtn = document.querySelector('#mainNav button[data-tab="island"]');
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
    toast("開疆拓土！領土 +" + res.delta + " 單位，" + res.reward + "入袋！");
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
function drawIsland() {
  const cv = $("islandCanvas");
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

function drawRadar() {
  const cv = $("radarCanvas");
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const cx = W / 2, cy = H / 2 + 10, R = 130;
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
      '<div class="privacy-note">隱私設計：僅顯示距離，不顯示對方精確座標。</div>';
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
 * 初始化
 * ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  buildExploreFilters();
  renderExplore();
  buildIslandActions();
  renderIslandStats();
  drawIsland();
  initRadar();
  initDuel();
  initQA();
});
