/* 未知之境：太空探索。開飛船、遇星球、降落關卡、看玩家、對戰。
   伺服器只給座標/HP/攻擊資訊，所有畫面由前端本地渲染。 */
import { get, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
// toast 本地實現，避免 a11y.js 依賴問題
function toast(msg) {
  try {
    const el = document.getElementById("sp-toast");
    if (el) { el.textContent = msg; el.hidden = false; setTimeout(() => el.hidden = true, 2500); }
  } catch(e) {}
}

const canvas = document.getElementById("sp-canvas");
const ctx = canvas.getContext("2d");
const panel = document.getElementById("sp-panel");
const toastEl = document.getElementById("sp-toast");
const coordsEl = document.getElementById("sp-coords");

let W = 0, H = 0;
let camX = 5000, camY = 5000; // 相機中心（= 玩家位置）
let meX = 5000, meY = 5000;
let targetX = null, targetY = null; // 移動目標
let players = [];
let planets = [];
let hotspots = [];
let universeSize = 10000;
let selectedPlanet = null;
let stars = [];

// 縮放：1 宇宙單位 = ? 像素
const SCALE = 0.08;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  // 背景星星
  stars = [];
  for (let i = 0; i < 200; i++) {
    stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.5, tw: Math.random() * Math.PI * 2 });
  }
}
window.addEventListener("resize", resize);
resize();

function showToast(msg, ms = 2500) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.hidden = true, ms);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 宇宙座標 → 螢幕座標
function toScreen(ux, uy) {
  return [(ux - camX) * SCALE + W / 2, (uy - camY) * SCALE + H / 2];
}
// 螢幕座標 → 宇宙座標
function toUniverse(sx, sy) {
  return [(sx - W / 2) / SCALE + camX, (sy - H / 2) / SCALE + camY];
}

function draw() {
  // 背景
  ctx.fillStyle = "#050510";
  ctx.fillRect(0, 0, W, H);
  // 星星
  const t = Date.now() / 1000;
  for (const s of stars) {
    const a = 0.3 + 0.7 * Math.abs(Math.sin(t + s.tw));
    ctx.globalAlpha = a;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 熱點（人多的地方）
  for (const h of hotspots) {
    const [sx, sy] = toScreen(h.x, h.y);
    if (sx < -100 || sx > W + 100 || sy < -100 || sy > H + 100) continue;
    const pulse = 1 + 0.2 * Math.sin(t * 3);
    ctx.strokeStyle = "#ffd97a55";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 40 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#ffd97a";
    ctx.font = "12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(`${h.count} 人在附近`, sx, sy - 50);
  }

  // 星球
  for (const p of planets) {
    const [sx, sy] = toScreen(p.x, p.y);
    const sr = p.radius * SCALE;
    if (sx < -sr - 50 || sx > W + sr + 50 || sy < -sr - 50 || sy > H + sr + 50) continue;
    // 光暈
    const grad = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 1.8);
    grad.addColorStop(0, p.color + "44");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(sx, sy, sr * 1.8, 0, Math.PI * 2); ctx.fill();
    // 本體
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    // 名稱
    ctx.fillStyle = "#EAF6FF";
    ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(p.name, sx, sy + sr + 18);
    // 距離近時顯示可降落
    const dist = Math.hypot(p.x - meX, p.y - meY);
    if (dist < p.radius + 300) {
      ctx.fillStyle = "#00E5FF";
      ctx.font = "12px sans-serif";
      ctx.fillText("點擊降落 ▼", sx, sy + sr + 36);
    }
  }

  // 其他玩家
  for (const pl of players) {
    const [sx, sy] = toScreen(pl.x, pl.y);
    if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
    drawShip(sx, sy, "#7B61FF", 8);
    ctx.fillStyle = "#EAF6FF";
    ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(pl.name, sx, sy - 14);
  }

  // 自己
  const [msx, msy] = toScreen(meX, meY);
  drawShip(msx, msy, "#00E5FF", 12);
  // 移動目標線
  if (targetX !== null) {
    const [tsx, tsy] = toScreen(targetX, targetY);
    ctx.strokeStyle = "#00E5FF55";
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(msx, msy); ctx.lineTo(tsx, tsy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#00E5FF";
    ctx.beginPath(); ctx.arc(tsx, tsy, 4, 0, Math.PI * 2); ctx.fill();
  }

  requestAnimationFrame(draw);
}

function drawShip(x, y, color, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.8);
  ctx.lineTo(0, size * 0.4);
  ctx.lineTo(-size * 0.7, size * 0.8);
  ctx.closePath(); ctx.fill();
  // 引擎光
  ctx.fillStyle = color + "88";
  ctx.beginPath(); ctx.arc(0, size * 0.6, size * 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// 點擊移動 / 點星球
canvas.addEventListener("click", e => {
  const [ux, uy] = toUniverse(e.clientX, e.clientY);
  // 先檢查是否點到星球
  for (const p of planets) {
    const dist = Math.hypot(p.x - ux, p.y - uy);
    if (dist < p.radius + 200 / SCALE * 0.1) {
      const myDist = Math.hypot(p.x - meX, p.y - meY);
      if (myDist < p.radius + 300) {
        showPlanetPanel(p);
      } else {
        // 太遠，先飛過去
        targetX = p.x; targetY = p.y;
        showToast(`正在前往 ${p.name}…`);
      }
      return;
    }
  }
  // 檢查是否點到其他玩家
  for (const pl of players) {
    const dist = Math.hypot(pl.x - ux, pl.y - uy);
    if (dist < 300) {
      showPlayerPanel(pl);
      return;
    }
  }
  // 否則就是移動
  targetX = Math.max(0, Math.min(universeSize, ux));
  targetY = Math.max(0, Math.min(universeSize, uy));
  hidePanel();
});

function showPlanetPanel(p) {
  selectedPlanet = p;
  panel.hidden = false;
  panel.innerHTML = `
    <h3>${escapeHtml(p.name)}</h3>
    <p>類型：${escapeHtml(p.type)} · 關卡：${p.levels.map(escapeHtml).join(" / ")}</p>
    <div class="btn-row">
      <button class="btn btn-primary" id="sp-land">降落</button>
      <button class="btn btn-ghost" id="sp-close">關閉</button>
    </div>
    <div id="sp-land-levels" style="margin-top:12px" hidden>
      <p>選擇關卡：</p>
      <div class="btn-row">
        ${p.levels.map((lv, i) => `<button class="btn btn-ghost sp-lv" data-lv="${i}">${escapeHtml(lv)}</button>`).join("")}
      </div>
    </div>`;
  document.getElementById("sp-close").onclick = hidePanel;
  document.getElementById("sp-land").onclick = async () => {
    try {
      const r = await post(`/space/land/${p.id}`, {});
      document.getElementById("sp-land-levels").hidden = false;
      showToast(r.message);
      // 關卡按鈕：進入對應的遊戲（目前導向現有系統）
      panel.querySelectorAll(".sp-lv").forEach(btn => {
        btn.onclick = () => {
          const lv = p.levels[+btn.dataset.lv];
          showToast(`進入 ${p.name} - ${lv}`);
          // 根據星球類型導向不同遊戲
          if (p.type === "battle") location.href = "duel.html";
          else if (p.type === "knowledge") location.href = "quiz.html";
          else location.href = "explore.html";
        };
      });
    } catch (e) {
      showToast(e.message);
    }
  };
}

function showPlayerPanel(pl) {
  panel.hidden = false;
  panel.innerHTML = `
    <h3>${escapeHtml(pl.name)}</h3>
    <p>距離 ${pl.dist} · 座標 (${Math.round(pl.x)}, ${Math.round(pl.y)})</p>
    <div class="btn-row">
      <button class="btn btn-primary" id="sp-challenge">發起對戰</button>
      <button class="btn btn-ghost" id="sp-fly-to">飛過去</button>
      <button class="btn btn-ghost" id="sp-close">關閉</button>
    </div>`;
  document.getElementById("sp-close").onclick = hidePanel;
  document.getElementById("sp-fly-to").onclick = () => {
    targetX = pl.x; targetY = pl.y;
    hidePanel();
    showToast(`正在飛向 ${pl.name}…`);
  };
  document.getElementById("sp-challenge").onclick = async () => {
    try {
      const r = await post("/space/battle/challenge", { target_name: pl.name });
      showToast(r.message);
      hidePanel();
      // 顯示對戰等待
      checkBattles();
    } catch (e) {
      showToast(e.message);
    }
  };
}

function hidePanel() {
  panel.hidden = true;
  selectedPlanet = null;
}

// 遊戲主循環：移動 + 同步
let syncTimer = 0;
function tick() {
  // 移動
  if (targetX !== null) {
    const dx = targetX - meX, dy = targetY - meY;
    const dist = Math.hypot(dx, dy);
    const speed = 120; // 單位/幀
    if (dist < speed) {
      meX = targetX; meY = targetY;
      targetX = targetY = null;
    } else {
      meX += dx / dist * speed;
      meY += dy / dist * speed;
    }
    camX = meX; camY = meY;
  }
  coordsEl.textContent = `x: ${Math.round(meX)}, y: ${Math.round(meY)}`;

  // 每 2 秒同步一次
  syncTimer++;
  if (syncTimer >= 120) { // 60fps * 2s
    syncTimer = 0;
    syncPosition();
  }
  requestAnimationFrame(tick);
}

async function syncPosition() {
  try {
    await post("/space/move", { x: meX, y: meY });
    const r = await get(`/space/state?x=${meX}&y=${meY}&radius=3000`);
    players = r.players || [];
    planets = r.planets || [];
    hotspots = r.hotspots || [];
    if (r.me) { meX = r.me.x; meY = r.me.y; camX = meX; camY = meY; }
  } catch (e) { /* 靜默 */ }
}

async function checkBattles() {
  try {
    const r = await get("/space/battles");
    const battles = r.battles || [];
    const waiting = battles.filter(b => b.status === "waiting" && b.role === "challenged");
    if (waiting.length) {
      const b = waiting[0];
      if (confirm(`${b.opponent_name} 向你發起對戰！接受嗎？`)) {
        await post(`/space/battle/${b.id}/accept`, {});
        location.href = `space-battle.html?id=${b.id}`;
      }
    }
    const active = battles.filter(b => b.status === "active");
    if (active.length && !checkBattles._inBattle) {
      checkBattles._inBattle = true;
      location.href = `space-battle.html?id=${active[0].id}`;
    }
  } catch (e) { /* 靜默 */ }
}

// 初始化
(async function init() {
  if (!isLoggedIn()) {
    location.href = "settings.html";
    return;
  }
  await syncPosition();
  draw();
  tick();
  // 每 10 秒檢查對戰邀請
  setInterval(checkBattles, 10000);
  showToast("點擊任意位置移動飛船，點擊星球可降落，點擊其他玩家可對戰");
})();
