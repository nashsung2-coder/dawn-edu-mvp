/* ============================================================
 * 曙光教育 3.0 · 深層系統共用核心 sys-core.js
 * 提供 window.Dawn：api / toast / esc / store / wallet / inv /
 * goSub / goBack / modal。深層頁共用，不依賴 app.js 內部變數。
 * ============================================================ */
"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const API_BASE = (window.DAWN_API_BASE || "").replace(/\/$/, "");
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  /* ---------- toast（沿用主站樣式） ---------- */
  let toastT = null;
  function toast(msg, ms) {
    const t = $("toast");
    if (!t) return;
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
    const timer = setTimeout(() => ctl.abort(), opts.timeout || 45000);
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

  /* ---------- 本地存儲 ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("dawn_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("dawn_" + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem("dawn_" + k); } catch (e) {} },
  };

  /* ---------- 雙幣錢包 ---------- */
  const wallet = {
    sands: 0, particles: 0,
    async sync() {
      // 後端優先，失敗則用本地
      try {
        const s = await api("/api/v1/game/state");
        if (typeof s.sands === "number") this.sands = s.sands;
        if (typeof s.stardust === "number") this.sands = s.stardust;
        if (typeof s.sand === "number") this.sands = s.sand;
      } catch (e) { /* 離線用本地 */ }
      const local = store.get("wallet", null);
      if (local) {
        if (!token()) { this.sands = local.sands || 0; this.particles = local.particles || 0; }
        else { // 登入時以後端為準，但保留較大值避免吞幣
          this.sands = Math.max(this.sands, local.sands || 0);
          this.particles = Math.max(this.particles, local.particles || 0);
        }
      }
      this.paint();
      return this;
    },
    save() { store.set("wallet", { sands: this.sands, particles: this.particles }); },
    paint() {
      document.querySelectorAll("[data-w-sands]").forEach((el) => { el.textContent = this.sands.toLocaleString(); });
      document.querySelectorAll("[data-w-particles]").forEach((el) => { el.textContent = this.particles.toLocaleString(); });
    },
    log(kind, amount, reason) {
      const logs = store.get("wallet_logs", []);
      logs.unshift({ t: Date.now(), kind, amount, reason: reason || "" });
      store.set("wallet_logs", logs.slice(0, 100));
    },
    async addSands(n, reason) {
      this.sands += n; this.save(); this.paint(); this.log("sands", n, reason);
      try { await api("/api/v1/game/earn", { method: "POST", body: JSON.stringify({ amount: n, reason: reason || "reward" }) }); } catch (e) {}
    },
    async addParticles(n, reason) {
      this.particles += n; this.save(); this.paint(); this.log("particles", n, reason);
    },
    spendSands(n) {
      if (this.sands < n) { toast("星砂不足"); return false; }
      this.sands -= n; this.save(); this.paint(); this.log("sands", -n, "消費");
      return true;
    },
    // 記憶微粒 → 星砂兌換（100:1）
    exchange(particles) {
      if (this.particles < particles) { toast("記憶微粒不足"); return false; }
      const gain = Math.floor(particles / 100);
      if (gain < 1) { toast("至少需要 100 微粒才能兌換"); return false; }
      this.particles -= gain * 100;
      this.sands += gain;
      this.save(); this.paint();
      this.log("particles", -gain * 100, "兌換星砂");
      this.log("sands", gain, "微粒兌換");
      return gain;
    },
  };

  /* ---------- 背包 ---------- */
  const inv = {
    list() { return store.get("inv", []); },
    add(item) {
      const items = this.list();
      items.unshift(Object.assign({ id: "it" + Date.now(), t: Date.now() }, item));
      store.set("inv", items.slice(0, 200));
      toast("獲得 " + (item.icon || "🎁") + " " + item.name);
    },
    remove(id) { store.set("inv", this.list().filter((x) => x.id !== id)); },
  };

  /* ---------- 深層頁導航 ---------- */
  const SUBPAGES = ["trial", "dex", "debate", "battle", "market", "forum", "wallet"];
  let subStack = [];
  function goSub(page) {
    if (SUBPAGES.indexOf(page) < 0) return;
    const el = $("page-" + page);
    if (!el) { toast("頁面建置中"); return; }
    document.querySelectorAll(".page.subpage").forEach((p) => p.classList.remove("active"));
    el.classList.add("active");
    subStack.push(page);
    try {
      const init = { trial: Trial, dex: Dex, debate: Debate, battle: Battle, market: Market, forum: Forum, wallet: Wallet }[page];
      if (init && init.enter) init.enter();
    } catch (e) { console.warn("[subpage]", page, e); }
    window.scrollTo(0, 0);
  }
  function goBack() {
    subStack.pop();
    document.querySelectorAll(".page.subpage").forEach((p) => p.classList.remove("active"));
    const prev = subStack[subStack.length - 1];
    if (prev) {
      $("page-" + prev).classList.add("active");
    }
  }

  /* ---------- modal ---------- */
  function modal(o) {
    o = o || {};
    let m = $("dawnModal");
    if (!m) {
      m = document.createElement("div");
      m.id = "dawnModal"; m.className = "dawn-modal";
      m.innerHTML = '<div class="dawn-modal-card"><h3 id="dawnModalTitle"></h3><div id="dawnModalBody"></div><div class="dawn-modal-actions" id="dawnModalActions"></div></div>';
      document.body.appendChild(m);
    }
    $("dawnModalTitle").textContent = o.title || "";
    $("dawnModalBody").innerHTML = o.html || "";
    const acts = $("dawnModalActions");
    acts.innerHTML = "";
    (o.actions || [{ label: "知道了" }]).forEach((a) => {
      const b = document.createElement("button");
      b.className = "btn" + (a.primary ? " primary" : "");
      b.textContent = a.label;
      b.onclick = () => { closeModal(); if (a.onClick) a.onClick(); };
      acts.appendChild(b);
    });
    m.classList.add("show");
    m.onclick = (e) => { if (e.target === m) closeModal(); };
  }
  function closeModal() { const m = $("dawnModal"); if (m) m.classList.remove("show"); }

  /* ---------- 學習會話（試煉/辯論共用） ---------- */
  async function ensureSession(topic) {
    let sid = store.get("learn_sid", "");
    if (sid) {
      try { await api("/api/v1/learn/sessions/" + sid); return sid; } catch (e) { /* 失效重建 */ }
    }
    const r = await api("/api/v1/learn/sessions", {
      method: "POST",
      body: JSON.stringify({ topic: topic || "綜合試煉", subject: "綜合" }),
    });
    sid = r.sid || r.session_id || (r.session && r.session.sid) || "";
    if (!sid) throw new Error("無法建立學習會話");
    store.set("learn_sid", sid);
    return sid;
  }

  window.Dawn = {
    $, esc, api, toast, store, wallet, inv, goSub, goBack, modal, closeModal,
    ensureSession, SUBPAGES,
  };

  // 返回鍵綁定（事件委派）
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-back]");
    if (b) { goBack(); }
    const g = e.target.closest("[data-gosub]");
    if (g) { goSub(g.dataset.gosub); }
  });

  // 啟動時同步錢包
  document.addEventListener("DOMContentLoaded", () => { wallet.sync().catch(() => {}); });
})();
