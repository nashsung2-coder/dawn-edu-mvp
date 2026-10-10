/* ============================================================
 * 曙光教育 3.0 · Gateway 分裂首頁邏輯 gateway.js
 * Learn / Game 模組隔離，跨區只走 event bus
 * ============================================================ */
"use strict";
(function () {
  const $ = (id) => document.getElementById(id);

  /* ---------- 極薄 event bus（跨區通訊唯一通道） ---------- */
  const bus = {
    _m: {},
    on(ev, fn) { (this._m[ev] = this._m[ev] || []).push(fn); },
    emit(ev, d) { (this._m[ev] || []).forEach((fn) => { try { fn(d); } catch (e) {} }); },
  };

  /* ==================== Learn 模組（禪意） ==================== */
  const Learn = {
    root: null,
    init(root) {
      this.root = root;
      // 繼承主站使用者資訊
      try {
        const name = localStorage.getItem("dawn_username") || "旅人";
        const lv = localStorage.getItem("dawn_level") || "1";
        const n = $("gwName"); if (n) n.textContent = name;
        const l = $("gwLv"); if (l) l.textContent = lv;
        const av = $("gwAvatar"); if (av) av.textContent = (name || "曜").slice(0, 1);
      } catch (e) {}
      // 上次進度（從 trial_history 推導）
      try {
        const hist = JSON.parse(localStorage.getItem("dawn_trial_history") || "[]");
        if (hist.length) {
          const last = hist[0];
          const t = $("gwHeroTitle");
          if (t) t.innerHTML = "繼續上次的<em>" + this.esc(last.subject || "綜合試煉") + "</em>";
          const s = $("gwHeroSub");
          if (s) s.textContent = "上次得分 " + (last.score || 0) + "% · 再接再厲";
        }
        // 今日軌跡
        const today = new Date().toDateString();
        const mins = hist.filter((h) => new Date(h.t || 0).toDateString() === today).length * 8;
        const fm = $("gwFocusMin"); if (fm) fm.textContent = mins;
        const pct = Math.min(100, mins);
        const bar = $("gwTrailBar"); if (bar) bar.style.width = pct + "%";
        const pt = $("gwTrailPct"); if (pt) pt.textContent = pct + "%";
      } catch (e) {}
      // 同學數字（偽隨機，每日固定）
      try {
        const seed = new Date().toDateString().length * 37 % 90;
        const f = $("gwFellows"); if (f) f.textContent = "此刻 " + (100 + seed) + " 位同學也在靜修";
      } catch (e) {}
    },
    esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); },
  };

  /* ==================== Game 模組（霓虹） ==================== */
  const Game = {
    root: null, canvas: null, ctx: null, parts: [], raf: 0, running: false,
    init(root) {
      this.root = root;
      this.canvas = $("gameParticles");
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext("2d");
      this.resize();
      window.addEventListener("resize", () => this.resize());
      // 效能隔離：不可見時暫停（DeepSeek）
      if ("IntersectionObserver" in window) {
        new IntersectionObserver((es) => {
          es.forEach((e) => { e.isIntersecting ? this.start() : this.stop(); });
        }).observe(this.canvas);
      } else { this.start(); }
      document.addEventListener("visibilitychange", () => {
        document.hidden ? this.stop() : this.start();
      });
      // 降級：減少動態偏好
      if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      this.start();
    },
    resize() {
      const r = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = r.width * dpr; this.canvas.height = r.height * dpr;
      this.W = r.width; this.H = r.height;
    },
    spawn() {
      // 粒子紀律：桌面 ~160、手機 ~50，有意義的漂浮（非全屏亂飄）
      const max = window.innerWidth >= 1024 ? 160 : 50;
      if (this.parts.length >= max) return;
      const side = Math.random();
      this.parts.push({
        x: Math.random() * this.W, y: this.H + 10,
        vy: -(.3 + Math.random() * .9), vx: (Math.random() - .5) * .3,
        r: .8 + Math.random() * 2.2, a: .25 + Math.random() * .55,
        hue: side < .6 ? 190 : 300, // 青 / 品紅
        tw: Math.random() * Math.PI * 2, ts: .01 + Math.random() * .03,
      });
    },
    start() {
      if (this.running || !this.ctx) return;
      this.running = true;
      const loop = () => {
        if (!this.running) return;
        this.tick();
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    },
    stop() { this.running = false; cancelAnimationFrame(this.raf); },
    tick() {
      const { ctx, W, H } = this;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.save(); ctx.scale(this.canvas.width / W, this.canvas.height / H);
      if (Math.random() < .35) this.spawn();
      this.parts = this.parts.filter((p) => p.y > -20);
      for (const p of this.parts) {
        p.y += p.vy; p.x += p.vx + Math.sin(p.tw += p.ts) * .25;
        const tw = .6 + .4 * Math.sin(p.tw * 2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 7);
        ctx.fillStyle = "hsla(" + p.hue + ",100%,68%," + (p.a * tw).toFixed(3) + ")";
        ctx.shadowColor = "hsla(" + p.hue + ",100%,60%,.8)";
        ctx.shadowBlur = 8;
        ctx.fill();
      }
      ctx.restore();
    },
  };

  /* ==================== 膜（結界） ==================== */
  const Membrane = {
    init() {
      const m = $("membrane"); if (!m) return;
      const rippleBox = $("mRipple");
      // 游標穿越激起漣漪（Gemini 方案 B）
      let last = 0;
      m.addEventListener("pointerenter", (e) => {
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        const r = m.getBoundingClientRect();
        const i = document.createElement("i");
        i.style.setProperty("--ry", ((e.clientY - r.top) / r.height * 100) + "%");
        rippleBox.appendChild(i);
        setTimeout(() => i.remove(), 1300);
      });
      // 燈籠 → 回家（務實版）
      const lan = $("mLantern");
      if (lan) lan.onclick = (e) => {
        e.stopPropagation();
        if (window.Dawn) Dawn.goSub("wallet"); // 暫以錢包為家的入口，下階段做摺疊家
        else { const sh = document.querySelector("#app-shell"); if (sh) sh.hidden = false; }
      };
      // 點擊膜 → 提示
      m.addEventListener("click", (e) => {
        if (e.target.closest(".m-lantern")) return;
        if (window.Dawn) Dawn.toast("選一邊吧 —— 左邊修煉，右邊征戰");
      });
    },
  };

  /* 手機改上下分，傳送門切換已移除 */

  /* ==================== 啟動 ==================== */
  document.addEventListener("DOMContentLoaded", () => {
    const gw = $("gateway");
    if (!gw) return;
    // app-shell 隱藏（gateway 為主首頁）
    const shell = $("app-shell");
    // 保留 shell 供深層頁返回時使用，但預設隱藏
    Learn.init(gw.querySelector(".zone-learn"));
    Game.init(gw.querySelector(".zone-game"));
    Membrane.init();

    // 深層頁返回時回到 gateway
    bus.on("back-to-gateway", () => { if (shell) shell.hidden = true; });
  });

  window.Gateway = { Learn, Game, Membrane, bus };
})();
