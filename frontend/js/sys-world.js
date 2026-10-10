/* ============================================================
 * 曙光教育 3.0 · 世界系統 sys-world.js
 * 四個獨立可運作的世界：Battle 星球戰役 / Market 星際市集 /
 * Forum 討論空間 / Wallet 錢包。各暴露 window.X.enter()，
 * 初始化對應 #xBody。全部繁體中文，錯誤 try/catch + toast。
 * 依賴 window.Dawn（sys-core.js）與 pages.css 現成樣式類。
 * ============================================================ */
"use strict";
(function () {
  const D = () => window.Dawn;

  /* ---------- 小工具 ---------- */
  function timeAgo(t) {
    try {
      const s = Math.floor((Date.now() - t) / 1000);
      if (s < 60) return "剛剛";
      const m = Math.floor(s / 60);
      if (m < 60) return m + " 分鐘前";
      const h = Math.floor(m / 60);
      if (h < 24) return h + " 小時前";
      const d = Math.floor(h / 24);
      if (d < 7) return d + " 天前";
      return new Date(t).toLocaleDateString("zh-TW");
    } catch (e) { return ""; }
  }
  function fmtDT(t) {
    try { return new Date(t).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
  }
  function errCard(bodyId, msg, retry) {
    const el = document.getElementById(bodyId);
    if (el) el.innerHTML = '<div class="sys-card sys-empty"><div class="big">🛰️</div><p>' +
      D().esc(msg || "載入失敗") + '</p><button class="btn primary" id="' + retry + 'Btn">重試</button></div>';
    const b = document.getElementById(retry + "Btn");
    if (b) b.onclick = () => { try { window[retry].enter(); } catch (e) { D().toast("重試失敗"); } };
  }
  function uid(p) { return (p || "id") + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* ============================================================
   * Battle · 星球戰役
   * ============================================================ */
  const PLANETS = [
    { id: "kx447", name: "KX-447", title: "熔岩星", icon: "🔥", diff: 1, hp: 80, atk: 8,
      desc: "表面流淌著岩漿的新生行星，守衛較弱，適合新手練手。",
      dropWeapon: "熔岩碎片刃", dropIcon: "🗡️" },
    { id: "mist9", name: "Mist-9", title: "迷霧星", icon: "🌫️", diff: 2, hp: 130, atk: 14,
      desc: "被濃霧籠罩的神秘行星，守衛會從霧中突襲。",
      dropWeapon: "迷霧穿透槍", dropIcon: "🔫" },
    { id: "voidx", name: "Void-X", title: "虛空星", icon: "🕳️", diff: 3, hp: 200, atk: 22,
      desc: "傳說中吞噬光線的虛空行星，只有最強的艦隊敢靠近。",
      dropWeapon: "虛空湮滅炮", dropIcon: "💥" },
  ];
  let B = null;

  function battleLockBack(on) {
    try {
      const btn = document.querySelector("#page-battle [data-back]");
      if (!btn) return;
      if (btn.__battleGuard) { btn.removeEventListener("click", btn.__battleGuard, true); btn.__battleGuard = null; }
      if (on) {
        btn.__battleGuard = (e) => {
          if (B && B.phase === "fight") {
            if (!confirm("戰鬥進行中！離開將視為逃跑（敵方回滿血），確定離開？")) {
              e.stopPropagation(); e.preventDefault();
            } else { B.phase = "select"; }
          }
        };
        btn.addEventListener("click", btn.__battleGuard, true);
      }
    } catch (e) {}
  }

  function myWeapons() {
    try {
      const all = D().inv.list() || [];
      return all.filter((x) => ["weapon", "武器"].indexOf(x.kind) >= 0 || ["weapon", "武器"].indexOf(x.type) >= 0);
    } catch (e) { return []; }
  }
  function weaponAtk(w) {
    if (!w) return 8;
    return Math.max(1, w.atk || w.attack || 10);
  }

  function bLog(html) {
    const el = document.getElementById("bLog");
    if (!el) return;
    const d = document.createElement("div");
    d.innerHTML = html;
    el.prepend(d);
    while (el.children.length > 40) el.removeChild(el.lastChild);
  }
  function bPaintHp() {
    if (!B) return;
    const me = document.querySelector("#bHpMe i"), foe = document.querySelector("#bHpFoe i");
    const met = document.getElementById("bHpMeT"), foet = document.getElementById("bHpFoeT");
    if (me) me.style.width = Math.max(0, B.meHp / B.meMax * 100) + "%";
    if (foe) foe.style.width = Math.max(0, B.foeHp / B.foeMax * 100) + "%";
    if (met) met.textContent = Math.max(0, B.meHp) + " / " + B.meMax;
    if (foet) foet.textContent = Math.max(0, B.foeHp) + " / " + B.foeMax;
  }

  function bRenderSelect() {
    const body = document.getElementById("battleBody");
    const ws = myWeapons();
    const hist = D().store.get("battle_history", []).slice(0, 5);
    let h = '<div class="sys-card"><h3>🪐 選擇目標星球</h3><p class="desc">難度越高，守衛越強，但掉落的星砂也越多。</p>';
    PLANETS.forEach((p) => {
      h += '<label class="quiz-opt' + (B.planetId === p.id ? " picked" : "") + '" data-pid="' + p.id + '">' +
        '<b>' + p.icon + " " + D().esc(p.name) + " · " + D().esc(p.title) + '</b> ' +
        '<span class="rar rar-' + (p.diff === 1 ? "N" : p.diff === 2 ? "R" : "SSR") + '">難度 ' + p.diff + "</span><br>" +
        '<small>❤️ HP ' + p.hp + "　⚔️ 攻擊 " + p.atk + "　💰 掉落 " + (p.diff * 15) + " 星砂　🎁 可能掉落「" + D().esc(p.dropWeapon) + "」</small><br>" +
        '<small style="color:var(--ink-2)">' + D().esc(p.desc) + "</small></label>";
    });
    h += "</div>";
    h += '<div class="sys-card"><h3>⚔️ 選擇出戰武器</h3><p class="desc">背包中的武器會出現在這裡（可在星際市集購買）。</p><div class="chipset">';
    h += '<button class="chip' + (B.weaponId === "fist" ? " on" : "") + '" data-wid="fist">👊 徒手（攻擊 8）</button>';
    ws.forEach((w) => {
      h += '<button class="chip' + (B.weaponId === w.id ? " on" : "") + '" data-wid="' + D().esc(w.id) + '">' +
        D().esc(w.icon || "🗡️") + " " + D().esc(w.name) + "（攻擊 " + weaponAtk(w) + "）</button>";
    });
    h += '</div><div class="btn-row"><button class="btn primary" id="bStartBtn">🚀 出戰！</button></div></div>';
    if (hist.length) {
      h += '<div class="sys-card"><h3>🏆 近期戰績</h3>';
      hist.forEach((r) => {
        h += '<div class="wallet-row"><span>' + (r.result === "win" ? "✅" : r.result === "lose" ? "❌" : "🏃") +
          " " + D().esc(r.planet) + ' <small style="color:var(--ink-2)">' + fmtDT(r.t) + "</small></span>" +
          '<span class="' + (r.result === "win" ? "pos" : "neg") + '">' + D().esc(r.result === "win" ? "+" + r.reward + " 星砂" : r.result === "lose" ? "醫藥費 -10" : "逃跑") + "</span></div>";
      });
      h += "</div>";
    }
    body.innerHTML = h;
    body.querySelectorAll("[data-pid]").forEach((el) => { el.onclick = () => { B.planetId = el.dataset.pid; bRenderSelect(); }; });
    body.querySelectorAll("[data-wid]").forEach((el) => { el.onclick = () => { B.weaponId = el.dataset.wid; bRenderSelect(); }; });
    document.getElementById("bStartBtn").onclick = () => {
      try {
        if (!B.planetId) { D().toast("請先選擇目標星球"); return; }
        const p = PLANETS.find((x) => x.id === B.planetId);
        const w = B.weaponId === "fist" ? null : ws.find((x) => String(x.id) === String(B.weaponId));
        B.phase = "fight"; B.busy = false;
        B.foe = p; B.foeHp = p.hp; B.foeMax = p.hp;
        B.meHp = 120; B.meMax = 120;
        B.weapon = w; B.wAtk = weaponAtk(w);
        battleLockBack(true);
        bRenderFight();
        bLog("🚀 飛船接近 <b>" + D().esc(p.name) + " " + D().esc(p.title) + "</b>，守衛出現了！");
      } catch (e) { D().toast("出戰失敗：" + e.message); }
    };
  }

  function bRenderFight() {
    const body = document.getElementById("battleBody");
    const p = B.foe;
    body.innerHTML =
      '<div class="battle-arena" id="bArena"><div class="battle-ship">🛸</div><div class="battle-foe">' + p.icon + "</div></div>" +
      '<div class="sys-card"><h3>🛸 我方飛船 <small id="bHpMeT" style="color:var(--ink-2)"></small></h3><div class="battle-hp hp-me" id="bHpMe"><i style="width:100%"></i></div>' +
      '<h3 style="margin-top:12px">' + p.icon + " " + D().esc(p.name) + ' <small id="bHpFoeT" style="color:var(--ink-2)"></small></h3><div class="battle-hp hp-foe" id="bHpFoe"><i style="width:100%"></i></div></div>' +
      '<div class="btn-row"><button class="btn primary" id="bAtkBtn">⚔️ 攻擊</button><button class="btn ghost" id="bFleeBtn">🏃 逃跑</button></div>' +
      '<div class="sys-card" style="margin-top:12px"><h3>📜 戰鬥日誌</h3><div class="battle-log" id="bLog"></div></div>';
    bPaintHp();
    document.getElementById("bAtkBtn").onclick = bAttack;
    document.getElementById("bFleeBtn").onclick = () => {
      try {
        if (B.busy) return;
        bEndBattle("flee");
      } catch (e) { D().toast("逃跑失敗"); }
    };
  }

  function bAttack() {
    if (!B || B.phase !== "fight" || B.busy) return;
    B.busy = true;
    const btn = document.getElementById("bAtkBtn");
    if (btn) btn.disabled = true;
    try {
      const arena = document.getElementById("bArena");
      const crit = Math.random() < 0.12;
      let dmg = Math.round(B.wAtk * (0.8 + Math.random() * 0.4) * (crit ? 1.6 : 1));
      B.foeHp -= dmg;
      if (arena) { arena.classList.add("atk"); setTimeout(() => arena.classList.remove("atk"), 520); }
      bLog("⚔️ 你發動攻擊，造成 <b>" + dmg + "</b> 點傷害" + (crit ? "（💥 暴擊！）" : "") + "！");
      setTimeout(() => { if (arena) { arena.classList.add("hit"); setTimeout(() => arena.classList.remove("hit"), 520); } }, 200);
      bPaintHp();
      if (B.foeHp <= 0) { setTimeout(() => bEndBattle("win"), 600); return; }
      // 敵方反擊
      setTimeout(() => {
        if (!B || B.phase !== "fight") return;
        const edmg = Math.round(B.foe.atk * (0.8 + Math.random() * 0.4));
        B.meHp -= edmg;
        bLog("👾 " + D().esc(B.foe.name) + " 反擊，造成 <b>" + edmg + "</b> 點傷害！");
        bPaintHp();
        if (B.meHp <= 0) { setTimeout(() => bEndBattle("lose"), 600); return; }
        B.busy = false;
        if (btn) btn.disabled = false;
      }, 900);
    } catch (e) {
      B.busy = false;
      if (btn) btn.disabled = false;
      D().toast("攻擊出錯：" + e.message);
    }
  }

  function bEndBattle(result) {
    if (!B || B.phase !== "fight") return;
    B.phase = "result";
    battleLockBack(false);
    const p = B.foe;
    try {
      const hist = D().store.get("battle_history", []);
      if (result === "win") {
        const reward = p.diff * 15;
        D().wallet.addSands(reward, "戰勝" + p.name);
        const dropChance = 0.35 + p.diff * 0.1;
        let gotWeapon = null;
        if (Math.random() < dropChance) {
          gotWeapon = { kind: "weapon", name: p.dropWeapon, icon: p.dropIcon, atk: 10 + p.diff * 6, desc: "從" + p.name + "繳獲的戰利品", rarity: p.diff >= 3 ? "SR" : "R" };
          D().inv.add(gotWeapon);
        }
        hist.unshift({ t: Date.now(), planet: p.name + " " + p.title, result: "win", reward });
        D().store.set("battle_history", hist.slice(0, 50));
        D().modal({
          title: "🎉 勝利！",
          html: "<p>你征服了 <b>" + D().esc(p.name) + " " + D().esc(p.title) + "</b>！</p>" +
            "<p>💰 獲得 <b>" + reward + "</b> 星砂</p>" +
            (gotWeapon ? "<p>🎁 額外掉落：" + D().esc(gotWeapon.icon) + " <b>" + D().esc(gotWeapon.name) + "</b>（已放入背包）</p>" : "<p>這次沒有掉落武器，再接再厲！</p>"),
          actions: [{ label: "返回整備", primary: true, onClick: () => { B.phase = "select"; bRenderSelect(); } }],
        });
      } else if (result === "lose") {
        const fee = Math.min(10, D().wallet.sands);
        D().wallet.sands = Math.max(0, D().wallet.sands - 10);
        D().wallet.save(); D().wallet.paint(); D().wallet.log("sands", -fee, "戰敗醫藥費");
        hist.unshift({ t: Date.now(), planet: p.name + " " + p.title, result: "lose", reward: 0 });
        D().store.set("battle_history", hist.slice(0, 50));
        D().modal({
          title: "💥 戰敗…",
          html: "<p>飛船受損，被拖回維修站。</p><p>🩹 醫藥費 <b>-" + fee + "</b> 星砂</p><p>換把更強的武器再來挑戰吧！</p>",
          actions: [{ label: "返回整備", primary: true, onClick: () => { B.phase = "select"; bRenderSelect(); } }],
        });
      } else {
        hist.unshift({ t: Date.now(), planet: p.name + " " + p.title, result: "flee", reward: 0 });
        D().store.set("battle_history", hist.slice(0, 50));
        D().toast("你逃離了戰場");
        B.phase = "select"; bRenderSelect();
      }
    } catch (e) { D().toast("結算出錯：" + e.message); B.phase = "select"; bRenderSelect(); }
  }

  window.Battle = {
    enter() {
      try {
        B = { phase: "select", planetId: null, weaponId: "fist", busy: false };
        battleLockBack(false);
        bRenderSelect();
      } catch (e) { errCard("battleBody", "戰役系統載入失敗：" + e.message, "Battle"); }
    },
  };

  /* ============================================================
   * Market · 星際市集
   * ============================================================ */
  const BUILTIN_GOODS = [
    { name: "星塵短刃", icon: "⚔️", price: 120, kind: "weapon", rarity: "R", atk: 14, desc: "以星塵鍛造的輕型短刃，適合新手艦長。" },
    { name: "脈衝爆能槍", icon: "🔫", price: 350, kind: "weapon", rarity: "SR", atk: 24, desc: "高頻脈衝能量，中距離作戰的可靠夥伴。" },
    { name: "曙光破曉劍", icon: "🗡️", price: 800, kind: "weapon", rarity: "SSR", atk: 40, desc: "傳說中曙光艦隊指揮官的佩劍，鋒芒無匹。" },
    { name: "奈米護盾", icon: "🛡️", price: 200, kind: "armor", rarity: "R", def: 10, desc: "奈米機器人構成的能量護盾，可抵擋輕型攻擊。" },
    { name: "星雲作戰服", icon: "🥋", price: 450, kind: "armor", rarity: "SR", def: 22, desc: "以星雲纖維編織，兼具防護與機動性。" },
    { name: "曙光徽章", icon: "🎖️", price: 80, kind: "deco", rarity: "N", desc: "曙光學院頒發的榮譽徽章，別在艦服上很帥。" },
    { name: "迷你衛星寵物", icon: "🛰️", price: 300, kind: "deco", rarity: "R", desc: "會跟著你跑的小衛星，偶爾會唱歌。" },
    { name: "星圖掛畫", icon: "🌌", price: 150, kind: "deco", rarity: "N", desc: "手繪銀河星圖，掛在宿舍牆上超有氛圍。" },
  ];
  const KIND_LABEL = { weapon: "武器", armor: "防具", deco: "裝飾" };
  let M = null;

  function normGood(raw, fromBackend) {
    return {
      lid: raw.lid != null ? raw.lid : raw.id,
      name: raw.name || raw.title || "未知商品",
      icon: raw.icon || raw.emoji || "📦",
      price: Math.max(0, Math.round(raw.price != null ? raw.price : raw.cost != null ? raw.cost : 0)),
      desc: raw.desc || raw.description || "",
      rarity: raw.rarity || "N",
      kind: raw.kind || raw.type || raw.category || "deco",
      atk: raw.atk || raw.attack || 0,
      def: raw.def || raw.defense || 0,
      fromBackend: !!fromBackend,
    };
  }

  function mRender() {
    const body = document.getElementById("marketBody");
    D().wallet.paint();
    let h = '<div class="sys-card" style="display:flex;align-items:center;justify-content:space-between">' +
      '<div>💰 星砂餘額<br><b style="font-size:28px;color:var(--gold)"><span data-w-sands>0</span></b></div>' +
      '<button class="btn ghost" id="mSyncBtn">🔄 同步</button></div>';
    h += '<div class="chipset" id="mCats">' +
      [["all", "全部"], ["weapon", "武器"], ["armor", "防具"], ["deco", "裝飾"]].map((c) =>
        '<button class="chip' + (M.cat === c[0] ? " on" : "") + '" data-cat="' + c[0] + '">' + c[1] + "</button>").join("") +
      "</div>";
    const list = M.items.filter((g) => M.cat === "all" || g.kind === M.cat);
    if (!list.length) {
      h += '<div class="sys-card sys-empty"><div class="big">🛒</div><p>這個分類目前沒有商品</p></div>';
    } else {
      list.forEach((g, i) => {
        const idx = M.items.indexOf(g);
        h += '<div class="sys-card shop-item"><div class="pic">' + D().esc(g.icon) + '</div><div class="info">' +
          "<b>" + D().esc(g.name) + '</b> <span class="rar rar-' + D().esc(g.rarity) + '">' + D().esc(g.rarity) + "</span> " +
          '<small>' + D().esc(KIND_LABEL[g.kind] || g.kind) + (g.atk ? " · 攻擊 " + g.atk : "") + (g.def ? " · 防禦 " + g.def : "") +
          (g.fromBackend ? " · 🏪 官方上架" : "") + "</small>" +
          (g.desc ? "<small>" + D().esc(g.desc) + "</small>" : "") + "</div>" +
          '<div style="text-align:right"><div class="price">💰 ' + g.price.toLocaleString() + '</div>' +
          '<button class="btn primary" style="min-height:40px;padding:8px 16px;margin-top:6px" data-buy="' + idx + '">購買</button></div></div>';
      });
    }
    body.innerHTML = h;
    D().wallet.paint();
    document.getElementById("mSyncBtn").onclick = async () => {
      try { await D().wallet.sync(); D().toast("餘額已同步"); mRender(); }
      catch (e) { D().toast("同步失敗：" + e.message); }
    };
    body.querySelectorAll("#mCats .chip").forEach((c) => {
      c.onclick = () => { M.cat = c.dataset.cat; mRender(); };
    });
    body.querySelectorAll("[data-buy]").forEach((b) => {
      b.onclick = () => mBuy(M.items[+b.dataset.buy]);
    });
  }

  async function mBuy(g) {
    if (!g) return;
    try {
      if (g.fromBackend && g.lid != null) {
        // 後端上架商品：走後端購買
        try {
          await D().api("/api/v1/world/market/" + g.lid + "/buy", { method: "POST" });
          await D().wallet.sync();
          D().inv.add({ kind: g.kind, name: g.name, icon: g.icon, atk: g.atk, def: g.def, desc: g.desc, rarity: g.rarity });
          mLogOrder(g);
          D().toast("購買成功！" + g.icon + " " + g.name);
          mRender();
          return;
        } catch (e) {
          D().toast("官方購買失敗，改用本地購買：" + e.message);
        }
      }
      // 本地購買
      if (!D().wallet.spendSands(g.price)) return;
      D().inv.add({ kind: g.kind, name: g.name, icon: g.icon, atk: g.atk, def: g.def, desc: g.desc, rarity: g.rarity });
      mLogOrder(g);
      D().toast("購買成功！" + g.icon + " " + g.name);
      mRender();
    } catch (e) { D().toast("購買出錯：" + e.message); }
  }
  function mLogOrder(g) {
    try {
      const orders = D().store.get("market_orders", []);
      orders.unshift({ t: Date.now(), name: g.name, icon: g.icon, price: g.price, lid: g.lid || null });
      D().store.set("market_orders", orders.slice(0, 100));
    } catch (e) {}
  }

  window.Market = {
    enter() {
      try {
        M = { items: [], cat: "all", backend: false };
        const body = document.getElementById("marketBody");
        body.innerHTML = '<div class="sys-loading">市集補貨中</div>';
        D().api("/api/v1/world/market", { timeout: 8000 }).then((r) => {
          try {
            const arr = Array.isArray(r) ? r : r.items || r.goods || r.list || [];
            if (arr.length) {
              M.items = arr.map((x) => normGood(x, true));
              M.backend = true;
            } else {
              M.items = BUILTIN_GOODS.map((x) => normGood(x, false));
            }
          } catch (e) { M.items = BUILTIN_GOODS.map((x) => normGood(x, false)); }
          mRender();
        }).catch(() => {
          M.items = BUILTIN_GOODS.map((x) => normGood(x, false));
          mRender();
        });
      } catch (e) { errCard("marketBody", "市集載入失敗：" + e.message, "Market"); }
    },
  };

  /* ============================================================
   * Forum · 討論空間（全本地運作）
   * ============================================================ */
  const FORUM_CATS = ["閒聊", "戰術", "許願", "官方"];
  let F = null;

  function myName() {
    try { return D().store.get("username", "") || "我"; } catch (e) { return "我"; }
  }
  function fPosts() { return D().store.get("forum_posts", []); }
  function fSave(p) { D().store.set("forum_posts", p); }
  function fSeed() {
    let p = fPosts();
    if (p.length) return p;
    const now = Date.now();
    p = [
      { id: uid("p"), title: "👋 新手報到區", content: "歡迎來到曙光討論空間！在這裡留下你的第一句話吧——你是從哪顆星球啟程的？", cat: "官方", author: "曙光官方", t: now - 86400000 * 2, likes: 42, liked: false, replies: [
        { id: uid("r"), author: "曙光官方", content: "報到的艦長們記得去任務中心領新手禮包喔！", t: now - 86400000 * 2 + 3600000 },
      ] },
      { id: uid("p"), title: "⚔️ 戰術交流：怎麼打贏 Void-X？", content: "虛空星守衛攻擊 22 點，我 120 血根本扛不住幾輪。有人有配裝建議嗎？", cat: "官方", author: "曙光官方", t: now - 86400000, likes: 18, liked: false, replies: [
        { id: uid("r"), author: "曙光官方", content: "建議先在市集買「曙光破曉劍」（攻擊 40），兩三輪就能結束戰鬥！", t: now - 86400000 + 7200000 },
      ] },
      { id: uid("p"), title: "🌠 許願池", content: "在這裡許下你的願望——想要什麼新武器、新星球、或是新功能？", cat: "官方", author: "曙光官方", t: now - 3600000 * 5, likes: 25, liked: false, replies: [] },
    ];
    fSave(p);
    return p;
  }

  function fRender() {
    const body = document.getElementById("forumBody");
    if (F.mode === "detail") { fRenderDetail(body); return; }
    const posts = fSeed();
    const list = posts.filter((p) => F.cat === "all" || p.cat === F.cat)
      .sort((a, b) => b.t - a.t);
    let h = '<div class="btn-row" style="margin-bottom:12px"><button class="btn primary" id="fNewBtn">✏️ 發文</button></div>';
    if (F.composing) {
      h += '<div class="sys-card"><h3>✏️ 發表新主題</h3>' +
        '<div class="chipset" id="fNewCats">' + FORUM_CATS.map((c) =>
          '<button class="chip' + (F.newCat === c ? " on" : "") + '" data-nc="' + c + '">' + c + "</button>").join("") + "</div>" +
        '<input id="fNewTitle" placeholder="標題（必填）" style="width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--card-2);color:var(--ink);font-size:15px;margin-bottom:8px;font-family:inherit">' +
        '<textarea id="fNewContent" placeholder="說點什麼…" style="width:100%;box-sizing:border-box;min-height:90px;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--card-2);color:var(--ink);font-size:15px;font-family:inherit;resize:vertical"></textarea>' +
        '<div class="btn-row" style="margin-top:10px"><button class="btn primary" id="fPubBtn">發布</button><button class="btn ghost" id="fCancelBtn">取消</button></div></div>';
    }
    h += '<div class="chipset">' + [["all", "全部"]].concat(FORUM_CATS.map((c) => [c, c])).map((c) =>
      '<button class="chip' + (F.cat === c[0] ? " on" : "") + '" data-fc="' + c[0] + '">' + c[1] + "</button>").join("") + "</div>";
    if (!list.length) {
      h += '<div class="sys-card sys-empty"><div class="big">💬</div><p>這個分類還沒有主題，來發第一篇吧！</p></div>';
    } else {
      list.forEach((p) => {
        const canDel = p.author === myName();
        h += '<div class="sys-card post" data-post="' + D().esc(p.id) + '" style="cursor:pointer">' +
          '<div class="meta"><span class="chip" style="cursor:default">' + D().esc(p.cat) + "</span><span>👤 " + D().esc(p.author) + "</span><span>" + timeAgo(p.t) + "</span>" +
          (canDel ? '<button class="btn danger" style="min-height:0;padding:4px 10px;font-size:12px;margin-left:auto" data-delpost="' + D().esc(p.id) + '">刪除</button>' : "") + "</div>" +
          "<h3>" + D().esc(p.title) + "</h3>" +
          '<p class="desc">' + D().esc((p.content || "").slice(0, 80)) + ((p.content || "").length > 80 ? "…" : "") + "</p>" +
          '<div class="meta"><span>' + (p.liked ? "❤️" : "🤍") + " " + (p.likes || 0) + "</span><span>💬 " + (p.replies || []).length + "</span></div></div>";
      });
    }
    body.innerHTML = h;
    document.getElementById("fNewBtn").onclick = () => { F.composing = true; F.newCat = F.newCat || "閒聊"; fRender(); };
    body.querySelectorAll("[data-fc]").forEach((c) => { c.onclick = (e) => { e.stopPropagation(); F.cat = c.dataset.fc; fRender(); }; });
    body.querySelectorAll("[data-post]").forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest("[data-delpost]")) return;
        F.mode = "detail"; F.postId = el.dataset.post; F.composing = false; fRender();
      };
    });
    body.querySelectorAll("[data-delpost]").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        if (!confirm("確定刪除這篇主題嗎？")) return;
        try {
          fSave(fPosts().filter((p) => String(p.id) !== String(b.dataset.delpost)));
          D().toast("已刪除"); fRender();
        } catch (err) { D().toast("刪除失敗"); }
      };
    });
    if (F.composing) {
      body.querySelectorAll("#fNewCats .chip").forEach((c) => { c.onclick = () => { F.newCat = c.dataset.nc; fRender(); }; });
      document.getElementById("fCancelBtn").onclick = () => { F.composing = false; fRender(); };
      document.getElementById("fPubBtn").onclick = () => {
        try {
          const title = document.getElementById("fNewTitle").value.trim();
          const content = document.getElementById("fNewContent").value.trim();
          if (!title) { D().toast("請填寫標題"); return; }
          if (!content) { D().toast("請填寫內容"); return; }
          const posts = fPosts();
          posts.unshift({ id: uid("p"), title, content, cat: F.newCat || "閒聊", author: myName(), t: Date.now(), likes: 0, liked: false, replies: [] });
          fSave(posts);
          F.composing = false;
          D().toast("發布成功！");
          fRender();
        } catch (err) { D().toast("發布失敗：" + err.message); }
      };
    }
  }

  function fRenderDetail(body) {
    const posts = fPosts();
    const p = posts.find((x) => String(x.id) === String(F.postId));
    if (!p) { F.mode = "list"; fRender(); return; }
    const canDel = p.author === myName();
    const me = myName();
    let h = '<div class="btn-row" style="margin-bottom:12px"><button class="btn ghost" id="fBackBtn">← 返回列表</button></div>';
    h += '<div class="sys-card post"><div class="meta"><span class="chip" style="cursor:default">' + D().esc(p.cat) + "</span><span>👤 " + D().esc(p.author) + "</span><span>" + timeAgo(p.t) + "</span></div>" +
      "<h3>" + D().esc(p.title) + "</h3>" +
      '<p class="desc" style="white-space:pre-wrap">' + D().esc(p.content) + "</p>" +
      '<div class="btn-row"><button class="btn' + (p.liked ? " primary" : "") + '" id="fLikeBtn">' + (p.liked ? "❤️" : "🤍") + " 按讚（" + (p.likes || 0) + "）</button>" +
      (canDel ? '<button class="btn danger" id="fDelBtn">🗑️ 刪除主題</button>' : "") + "</div>";
    h += '<div class="replies"><h3>💬 回覆（' + (p.replies || []).length + "）</h3>";
    (p.replies || []).slice().sort((a, b) => a.t - b.t).forEach((r) => {
      const canDelR = r.author === me;
      h += '<div class="reply"><b>' + D().esc(r.author) + '</b> <small style="color:var(--ink-2)">' + timeAgo(r.t) + "</small>" +
        (canDelR ? ' <button class="btn danger" style="min-height:0;padding:2px 8px;font-size:11px" data-delrep="' + D().esc(r.id) + '">刪除</button>' : "") +
        '<div style="margin-top:4px;white-space:pre-wrap">' + D().esc(r.content) + "</div></div>";
    });
    h += "</div>";
    h += '<div class="debate-input"><textarea id="fRepText" placeholder="寫下你的回覆…"></textarea></div>' +
      '<div class="btn-row" style="margin-top:8px"><button class="btn primary" id="fRepBtn">回覆</button></div></div>';
    body.innerHTML = h;
    document.getElementById("fBackBtn").onclick = () => { F.mode = "list"; fRender(); };
    document.getElementById("fLikeBtn").onclick = () => {
      try {
        p.liked = !p.liked;
        p.likes = Math.max(0, (p.likes || 0) + (p.liked ? 1 : -1));
        fSave(posts); fRender();
      } catch (err) { D().toast("按讚失敗"); }
    };
    const delBtn = document.getElementById("fDelBtn");
    if (delBtn) delBtn.onclick = () => {
      if (!confirm("確定刪除這篇主題嗎？")) return;
      try { fSave(posts.filter((x) => String(x.id) !== String(p.id))); F.mode = "list"; D().toast("已刪除"); fRender(); }
      catch (err) { D().toast("刪除失敗"); }
    };
    body.querySelectorAll("[data-delrep]").forEach((b) => {
      b.onclick = () => {
        if (!confirm("確定刪除這則回覆？")) return;
        try {
          p.replies = (p.replies || []).filter((r) => String(r.id) !== String(b.dataset.delrep));
          fSave(posts); fRender();
        } catch (err) { D().toast("刪除失敗"); }
      };
    });
    document.getElementById("fRepBtn").onclick = () => {
      try {
        const c = document.getElementById("fRepText").value.trim();
        if (!c) { D().toast("請填寫回覆內容"); return; }
        p.replies = p.replies || [];
        p.replies.push({ id: uid("r"), author: me, content: c, t: Date.now() });
        fSave(posts);
        D().toast("回覆成功！");
        fRender();
      } catch (err) { D().toast("回覆失敗：" + err.message); }
    };
  }

  window.Forum = {
    enter() {
      try {
        F = { mode: "list", postId: null, cat: "all", composing: false, newCat: "閒聊" };
        fSeed();
        fRender();
      } catch (e) { errCard("forumBody", "討論空間載入失敗：" + e.message, "Forum"); }
    },
  };

  /* ============================================================
   * Wallet · 錢包
   * ============================================================ */
  function wRender() {
    const body = document.getElementById("walletBody");
    D().wallet.paint();
    let h = '<div class="wallet-hero">' +
      '<div class="sub">⭐ 星砂（經濟本位）</div><div class="amt"><span data-w-sands>0</span></div>' +
      '<div class="sub" style="margin-top:10px">✨ 記憶微粒（學習產出）</div><div class="amt" style="font-size:26px;color:var(--cyan)"><span data-w-particles>0</span></div>' +
      '<div style="margin-top:14px"><button class="btn" id="wSyncBtn" style="background:oklch(1 0 0/.12);border:1px solid oklch(1 0 0/.25);color:#fff">🔄 同步餘額</button></div></div>';
    // 兌換區
    h += '<div class="sys-card"><h3>🔄 微粒兌換星砂</h3><p class="desc">匯率 <b>100 微粒 = 1 星砂</b>。學習產出的微粒可以在這裡換成能花的星砂。</p>' +
      '<div class="chipset"><button class="chip" data-q="100">100</button><button class="chip" data-q="500">500</button><button class="chip" data-q="all">全部</button></div>' +
      '<div style="display:flex;gap:8px"><input id="wExAmt" type="number" min="100" step="100" placeholder="輸入微粒數量" style="flex:1;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--card-2);color:var(--ink);font-size:15px;font-family:inherit">' +
      '<button class="btn primary" id="wExBtn">兌換</button></div>' +
      '<p class="desc" id="wExHint" style="margin:8px 0 0"></p></div>';
    // 交易紀錄
    const logs = D().store.get("wallet_logs", []);
    h += '<div class="sys-card"><h3>📒 交易紀錄</h3>';
    if (!logs.length) {
      h += '<div class="sys-empty" style="padding:20px"><p>還沒有交易紀錄，去戰鬥或市集走走吧！</p></div>';
    } else {
      logs.slice(0, 30).forEach((l) => {
        const isNeg = l.amount < 0;
        const unit = l.kind === "particles" ? "✨" : "⭐";
        const uname = l.kind === "particles" ? "微粒" : "星砂";
        h += '<div class="wallet-row"><div><div>' + D().esc(l.reason || (isNeg ? "支出" : "收入")) + '</div>' +
          '<small style="color:var(--ink-2)">' + fmtDT(l.t) + " · " + unit + " " + uname + "</small></div>" +
          '<b class="' + (isNeg ? "neg" : "pos") + '">' + (isNeg ? "" : "+") + Number(l.amount).toLocaleString() + "</b></div>";
      });
    }
    h += "</div>";
    body.innerHTML = h;
    D().wallet.paint();
    document.getElementById("wSyncBtn").onclick = async () => {
      try { await D().wallet.sync(); D().toast("餘額已同步"); wRender(); }
      catch (e) { D().toast("同步失敗：" + e.message); }
    };
    body.querySelectorAll("[data-q]").forEach((c) => {
      c.onclick = () => {
        const inp = document.getElementById("wExAmt");
        const q = c.dataset.q;
        inp.value = q === "all" ? D().wallet.particles : q;
        wHint();
      };
    });
    const inp = document.getElementById("wExAmt");
    inp.addEventListener("input", wHint);
    function wHint() {
      const n = Math.floor(+inp.value || 0);
      const hint = document.getElementById("wExHint");
      if (hint) hint.textContent = n >= 100 ? "可兌換 " + Math.floor(n / 100) + " 星砂" : n > 0 ? "至少需要 100 微粒" : "";
    }
    document.getElementById("wExBtn").onclick = () => {
      try {
        const n = Math.floor(+inp.value || 0);
        if (!n || n < 100) { D().toast("請輸入至少 100 微粒"); return; }
        const gain = D().wallet.exchange(n);
        if (gain) { D().toast("兌換成功！獲得 " + gain + " 星砂 ✨→⭐"); wRender(); }
      } catch (e) { D().toast("兌換失敗：" + e.message); }
    };
  }

  window.Wallet = {
    enter() {
      try { wRender(); }
      catch (e) { errCard("walletBody", "錢包載入失敗：" + e.message, "Wallet"); }
    },
  };
})();
