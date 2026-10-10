/* ============================================================
 * 曙光教育 3.0 · 前端
 * 路由（心流／宇宙／家）＋ 頂部身分列 ＋ 帳戶下拉選單 ＋ 登入
 * 沿用 config.js 的 DAWN_API_BASE；token 存 localStorage dawn_token
 * ============================================================ */
"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const API_BASE = (window.DAWN_API_BASE || "").replace(/\/$/, "");
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  /* ---------- toast ---------- */
  let toastT = null;
  function toast(msg, ms) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("show"), ms || 2200);
  }

  /* ---------- API ---------- */
  function token() { try { return localStorage.getItem("dawn_token") || ""; } catch (e) { return ""; } }
  async function api(path, opts) {
    opts = opts || {};
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || 30000);
    try {
      const res = await fetch(API_BASE + path, {
        method: opts.method || "GET",
        headers: Object.assign({ "Content-Type": "application/json" },
          token() ? { "Authorization": "Bearer " + token() } : {},
          opts.headers || {}),
        body: opts.body, signal: ctl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || ("HTTP " + res.status));
      return data;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("連線逾時，請檢查網路後重試");
      throw e;
    } finally { clearTimeout(timer); }
  }

  /* ---------- 使用者狀態 ---------- */
  const User = { name: "", level: 1, sand: 0, mote: 0, logged: false };

  function paintCoins() {
    ["flowSand", "cosmosSand", "homeSand", "wSand"].forEach((id) => {
      const el = $(id); if (el) el.textContent = User.sand.toLocaleString();
    });
    ["homeMote", "wMote"].forEach((id) => {
      const el = $(id); if (el) el.textContent = User.mote.toLocaleString();
    });
    document.querySelectorAll(".avatar").forEach((a) => {
      a.textContent = (User.name || "曜").slice(0, 1);
    });
    const lv = $("flowLv"); if (lv) lv.textContent = User.level;
  }

  async function refreshMe() {
    if (!token()) { paintCoins(); return; }
    try {
      const d = await api("/api/v1/auth/me");
      const u = d.user || d;
      User.name = u.name || u.nickname || "";
      User.level = u.level || 1;
      User.logged = true;
      try {
        const w = await api("/api/v1/world/wallet").catch(() => null);
        if (w) { User.sand = w.stardust || w.sand || 0; User.mote = w.motes || w.mote || 0; }
      } catch (e) { /* 錢包失敗不擋 */ }
    } catch (e) {
      try { localStorage.removeItem("dawn_token"); } catch (e2) {}
      User.logged = false;
    }
    paintCoins();
    buildAcctMenus();
  }

  /* ---------- 帳戶下拉選單 ---------- */
  const MENU_ITEMS = [
    { k: "points", icon: "💰", label: "積分", val: () => User.sand.toLocaleString() + " 星砂" },
    { k: "achv", icon: "🏆", label: "成就系統" },
    { k: "honor", icon: "🎖️", label: "榮譽" },
    { k: "profile", icon: "🪪", label: "個人檔案" },
    { k: "appearance", icon: "🎨", label: "外觀" },
    { k: "settings", icon: "⚙️", label: "設定" },
    { k: "logout", icon: "🚪", label: "登出", danger: true },
  ];
  function buildAcctMenus() {
    ["flowAcctMenu", "homeAcctMenu"].forEach((mid) => {
      const box = $(mid); if (!box) return;
      let html = '<div class="m-head"><b>' + esc(User.name || "旅人") + "</b>" +
        '<span class="small">Lv.' + User.level + " · 曙光旅人</span></div>";
      MENU_ITEMS.forEach((m) => {
        if (m.k === "logout" && !User.logged) return;
        html += '<button class="m-item' + (m.danger ? " danger" : "") + '" data-m="' + m.k + '">' +
          '<span class="mi">' + m.icon + "</span>" + m.label +
          (m.val ? '<span class="m-val">' + esc(m.val()) + "</span>" : "") + "</button>";
      });
      box.innerHTML = html;
      box.querySelectorAll("[data-m]").forEach((b) => {
        b.onclick = () => onMenu(b.dataset.m);
      });
    });
  }
  function onMenu(k) {
    if (k === "logout") {
      try { localStorage.removeItem("dawn_token"); } catch (e) {}
      User.logged = false; User.name = ""; User.sand = 0; User.mote = 0;
      paintCoins(); buildAcctMenus(); toast("已登出，後會有期 👋"); return;
    }
    if (k === "points") { openWallet(); return; }
    if (k === "profile" || k === "settings" || k === "appearance") { go("home"); return; }
    toast({ achv: "🏆 成就系統即將上線", honor: "🎖️ 榮譽殿堂即將上線" }[k] || "即將上線");
  }

  /* ---------- 進入動畫：AI 生成影片，循環播放，上滑/點擊跳過 ---------- */
  // 影片為 frontend/assets/entry-flow.mp4 / entry-cosmos.mp4（GitHub 網頁拖曳上傳）
  const ENTRY_VIDEOS = { flow: "assets/entry-flow.mp4", cosmos: "assets/entry-cosmos.mp4" };
  let entryShown = {};
  function showEntry(name) {
    const src = ENTRY_VIDEOS[name];
    if (!src || entryShown[name]) return;
    entryShown[name] = true;
    const wrap = $("entryAnim"), vid = $("entryVideo");
    vid.src = src; vid.currentTime = 0;
    wrap.classList.remove("hide"); wrap.classList.add("show");
    vid.play().catch(() => {});
  }
  function hideEntry() {
    const wrap = $("entryAnim");
    if (!wrap.classList.contains("show")) return;
    wrap.classList.add("hide");
    setTimeout(() => { wrap.classList.remove("show", "hide"); $("entryVideo").pause(); }, 360);
  }
  $("entryAnim").querySelector(".entry-skip").onclick = hideEntry;
  // 上滑手勢跳過
  let _ty = 0;
  $("entryAnim").addEventListener("touchstart", (e) => { _ty = e.touches[0].clientY; }, { passive: true });
  $("entryAnim").addEventListener("touchend", (e) => {
    if (_ty - e.changedTouches[0].clientY > 60) hideEntry();
  }, { passive: true });

  /* ---------- 路由：三頁 ---------- */
  const PAGES = ["flow", "cosmos", "home"];
  let current = "flow";
  function go(name) {
    if (PAGES.indexOf(name) < 0) name = "flow";
    current = name;
    PAGES.forEach((p) => $("page-" + p).classList.toggle("active", p === name));
    document.querySelectorAll("#tabbar button").forEach((b) =>
      b.classList.toggle("on", b.dataset.go === name));
    try { localStorage.setItem("dawn_page", name); } catch (e) {}
    if (name === "cosmos") buildStars();
    if (name === "flow" || name === "cosmos") showEntry(name);
  }
  document.querySelectorAll("#tabbar button").forEach((b) => {
    b.onclick = () => go(b.dataset.go);
  });

  /* ---------- 心流首頁 ---------- */
  const DEMO_TOPICS = [
    { tag: "化學 · 酸鹼", title: "紫甘藍汁的變色魔法", p: 62 },
    { tag: "物理 · 光學", title: "筷子插進水杯為什麼彎了？", p: 20 },
    { tag: "生物 · 植物", title: "窗邊的盆栽為什麼總歪向一邊？", p: 0 },
  ];
  const DEMO_LOOT = [
    { icon: "🗡️", name: "蒸發之刃" }, { icon: "🛡️", name: "折射壁壘" },
    { icon: "🏅", name: "連擊徽章" }, { icon: "🔷", name: "+50 微粒" },
  ];
  function renderFlowLists() {
    $("topicList").innerHTML = DEMO_TOPICS.map((t) =>
      '<button class="topic-item"><span class="ring" style="--p:' + t.p + '"><span>' + t.p + "%</span></span>" +
      '<span><span class="t-tag">' + esc(t.tag) + '</span><br><span class="t-title">' + esc(t.title) + "</span></span></button>"
    ).join("");
    $("topicList").querySelectorAll(".topic-item").forEach((b) =>
      b.onclick = () => toast("課題頁（v2 既有戰役）即將接入 3.0 殼"));
    $("lootRow").innerHTML = DEMO_LOOT.map((l) =>
      '<button class="loot-card"><span class="li">' + l.icon + "</span>" + esc(l.name) + "</button>"
    ).join("");
    const d = new Date();
    $("flowDate").textContent = (d.getMonth() + 1) + "/" + d.getDate();
  }
  document.querySelectorAll("#modeCapsule button").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("#modeCapsule button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      const names = { exam: "考試衝刺", curious: "好奇逛逛", deep: "深入研究" };
      toast("已切換到「" + names[b.dataset.mode] + "」模組");
    };
  });
  $("flowCta").onclick = () => toast("閉門造車（辯論台）即將接入 3.0 殼");
  $("mainTopic").onclick = () => toast("課題頁（v2 既有戰役）即將接入 3.0 殼");
  $("flowBell").onclick = () => toast("🔔 目前沒有新通知");
  ["flowSandChip", "cosmosSandChip"].forEach((id) => {
    const el = $(id); if (el) el.onclick = () => go("home");
  });

  /* ---------- 宇宙首頁 ---------- */
  const PLANETS = {
    kx447: { name: "鐵鏽帶 · KX-447", diff: 4, dist: "3.1 光年", sand: 90, mote: 5, drop: "鏽蝕核心" },
    mist: { name: "迷霧星 · ML-09", diff: 3, dist: "2.4 光年", sand: 120, mote: 8, drop: "鈦殼裝甲" },
    ember: { name: "餘燼星 · EM-31", diff: 5, dist: "4.0 光年", sand: 200, mote: 12, drop: "餘燼之心" },
  };
  let starsBuilt = false;
  function buildStars() {
    if (starsBuilt) return; starsBuilt = true;
    const sf = $("starfield");
    const mk = (n, size, tw) => {
      const l = document.createElement("div"); l.className = "layer";
      for (let i = 0; i < n; i++) {
        const s = document.createElement("span"); s.className = "star";
        const sz = (Math.random() * size + 1).toFixed(1);
        s.style.cssText = "left:" + (Math.random() * 100) + "%;top:" + (Math.random() * 100) +
          "%;width:" + sz + "px;height:" + sz + "px;--tw:" + (2 + Math.random() * tw).toFixed(1) + "s";
        l.appendChild(s);
      }
      sf.appendChild(l);
    };
    mk(50, 1.5, 3); mk(40, 2.5, 4); mk(30, 3.5, 5);
    const neb = document.createElement("div"); neb.className = "nebula";
    neb.style.cssText = "left:10%;top:8%;width:280px;height:280px;background:radial-gradient(circle, oklch(.5 .12 265/.5), transparent 70%)";
    sf.appendChild(neb);
    const neb2 = neb.cloneNode();
    neb2.style.cssText = "right:5%;bottom:20%;width:220px;height:220px;background:radial-gradient(circle, oklch(.5 .12 195/.4), transparent 70%)";
    sf.appendChild(neb2);
  }
  function selectPlanet(key, btn) {
    document.querySelectorAll(".planet").forEach((p) => p.classList.remove("sel"));
    btn.classList.add("sel");
    const pl = PLANETS[key] || PLANETS.mist;
    $("tcName").textContent = pl.name;
    const card = $("targetCard");
    card.querySelector(".diff-row").innerHTML =
      "<span>難度</span>" + diffDots(pl.diff) + "<span>距離 " + pl.dist + "</span>";
    card.querySelector(".loot").innerHTML =
      "<span>💰 <b>" + pl.sand + "</b> 星砂</span><span>🔷 <b>" + pl.mote + "</b> 記憶微粒</span><span>🛡️ " + esc(pl.drop) + "</span>";
    card.classList.add("show");
  }
  function diffDots(n) {
    let h = '<span class="diff">';
    for (let i = 0; i < 5; i++) h += '<i class="' + (i < n ? "f" : "") + '"></i>';
    return h + "</span>";
  }
  document.querySelectorAll(".planet").forEach((b) => {
    b.onclick = () => selectPlanet(b.dataset.p, b);
  });
  document.querySelectorAll("#opsRow button").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("#opsRow button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    };
  });
  $("cosmosCta").onclick = () => {
    const sel = document.querySelector(".planet.sel");
    if (!sel) { toast("先選一顆星球 🎯"); return; }
    toast("曲速引擎啟動…（戰鬥頁即將接入）");
  };
  $("cosmosGear").onclick = () => go("home");
  // 預設選推薦星球
  selectPlanet("mist", $("planet2"));

  /* ---------- 家 ---------- */
  $("petBtn").onclick = () => {
    const b = $("petBubble");
    b.classList.toggle("show");
    if (b.classList.contains("show"))
      setTimeout(() => b.classList.remove("show"), 2600);
  };
  document.querySelectorAll(".furniture").forEach((f) => {
    f.onclick = () => toast("🛋️ 「" + f.dataset.f + "」：移動／收納／詳情（即將上線）");
  });
  document.querySelectorAll("[data-q]").forEach((b) => {
    b.onclick = () => toast({ chat: "💬 聊天即將上線", forum: "🗣️ 討論空間即將上線", friends: "👥 好友即將上線", achv: "🏆 成就即將上線", build: "🏠 建造模式即將上線" }[b.dataset.q] || "即將上線");
  });

  /* 錢包 */
  function openWallet() {
    $("walletMask").classList.add("show");
    $("xRange").max = Math.max(1000, User.mote);
    $("xRange").value = 0; updateX();
  }
  function updateX() {
    const v = +$("xRange").value || 0;
    $("xOut").textContent = "→ " + Math.floor(v / 100) + " 星砂";
  }
  $("xRange").oninput = updateX;
  $("xBtn").onclick = () => toast("兌換功能接上 ledger 後啟用（展示）");
  $("walletClose").onclick = () => $("walletMask").classList.remove("show");
  $("walletMask").onclick = (e) => { if (e.target === $("walletMask")) $("walletMask").classList.remove("show"); };
  ["homeSandChip", "homeMoteChip"].forEach((id) => { $(id).onclick = openWallet; });

  /* ---------- 登入（簡化版） ---------- */
  function openAuth() { $("authErr").textContent = ""; $("authMask").classList.add("show"); }
  function closeAuth() { $("authMask").classList.remove("show"); }
  $("authCancel").onclick = closeAuth;
  $("authMask").onclick = (e) => { if (e.target === $("authMask")) closeAuth(); };
  $("authToReg").onclick = () => toast("註冊頁即將接入（v2 既有）");
  $("authGo").onclick = async () => {
    const name = $("authName").value.trim(), pass = $("authPass").value;
    if (!name || !pass) { $("authErr").textContent = "請輸入暱稱與密碼"; return; }
    $("authGo").disabled = true;
    try {
      const d = await api("/api/v1/auth/login", {
        method: "POST", body: JSON.stringify({ name, password: pass }),
      });
      try { localStorage.setItem("dawn_token", d.token); } catch (e) {}
      try { localStorage.setItem("dawn_user", name); } catch (e) {}
      closeAuth(); toast("歡迎回來，" + name + " 👋");
      await refreshMe();
    } catch (e) {
      $("authErr").textContent = e.message || "登入失敗";
    } finally { $("authGo").disabled = false; }
  };
  // 頭像點擊：未登入→登入框；已登入→進「家」（hover 選單另由 CSS 處理）
  ["flowAvatar", "homeAvatar"].forEach((id) => {
    $(id).addEventListener("click", () => {
      if (!User.logged) openAuth(); else go("home");
    });
  });

  /* ---------- 啟動 ---------- */
  renderFlowLists();
  buildAcctMenus();
  let start = "flow";
  try { start = localStorage.getItem("dawn_page") || "flow"; } catch (e) {}
  go(start);
  refreshMe();
})();
