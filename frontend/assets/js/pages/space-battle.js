/* 太空對戰：前端本地渲染。伺服器只給 HP 和攻擊記錄，動畫全在前端。 */
import { get, post } from "../core/api.js";
import { isLoggedIn, getUserId } from "../core/auth.js";

const canvas = document.getElementById("bt-canvas");
const ctx = canvas.getContext("2d");
const myId = getUserId();
const battleId = new URLSearchParams(location.search).get("id");

let W = 0, H = 0;
let state = null;
let effects = []; // 本地特效：{x, y, vx, vy, life, color, size}
let shake = 0;

function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
addEventListener("resize", resize); resize();

function log(msg) {
  const el = document.getElementById("bt-log");
  const d = document.createElement("div");
  d.textContent = msg;
  el.prepend(d);
  while (el.children.length > 8) el.lastChild.remove();
}

// 爆炸特效（純前端）
function explode(x, y, color) {
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 5;
    effects.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 1, color, size: 2 + Math.random() * 4 });
  }
  shake = 12;
}

// 雷射特效（純前端）
function laser(x1, y1, x2, y2, color) {
  effects.push({ type: "laser", x1, y1, x2, y2, life: 1, color });
}

function draw() {
  ctx.fillStyle = "#050510";
  ctx.fillRect(0, 0, W, H);
  // 星空
  ctx.fillStyle = "#ffffff33";
  for (let i = 0; i < 80; i++) {
    const x = (i * 137) % W, y = (i * 89) % H;
    ctx.fillRect(x, y, 1, 1);
  }

  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    shake *= 0.9;
  }

  if (state) {
    const cx = W / 2, cy = H / 2;
    const isP1 = state.battle.p1.id === myId;
    const me = isP1 ? state.battle.p1 : state.battle.p2;
    const op = isP1 ? state.battle.p2 : state.battle.p1;
    // 我（左）
    drawShip(cx - 150, cy, "#00E5FF", 24, me.hp);
    // 對手（右）
    drawShip(cx + 150, cy, "#ff6b6b", 24, op.hp);
  }

  // 特效
  effects = effects.filter(e => e.life > 0);
  for (const e of effects) {
    e.life -= 0.02;
    if (e.type === "laser") {
      ctx.strokeStyle = e.color; ctx.globalAlpha = e.life;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      e.x += e.vx; e.y += e.vy;
      e.vx *= 0.98; e.vy *= 0.98;
      ctx.globalAlpha = Math.max(0, e.life);
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.size * e.life, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  requestAnimationFrame(draw);
}

function drawShip(x, y, color, size, hp) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size); ctx.lineTo(size * .7, size * .8);
  ctx.lineTo(0, size * .4); ctx.lineTo(-size * .7, size * .8);
  ctx.closePath(); ctx.fill();
  // HP 文字
  ctx.fillStyle = "#EAF6FF"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`HP ${hp}`, 0, size + 24);
  ctx.restore();
}

async function refresh() {
  try {
    const r = await get(`/space/battle/${battleId}`);
    const old = state;
    state = r;
    const b = r.battle;
    const isP1 = b.p1.id === myId;
    const me = isP1 ? b.p1 : b.p2;
    const op = isP1 ? b.p2 : b.p1;
    document.getElementById("bt-p1-name").textContent = me.name + "（我）";
    document.getElementById("bt-p2-name").textContent = op.name;
    document.getElementById("bt-p1-hp").style.width = me.hp + "%";
    document.getElementById("bt-p2-hp").style.width = op.hp + "%";
    // 檢查新動作，播放特效
    if (old) {
      const oldIds = new Set((old.recent_actions || []).map(a => a.id));
      for (const a of (r.recent_actions || [])) {
        if (!oldIds.has(a.id)) {
          const cx = W / 2, cy = H / 2;
          const atkLeft = a.attacker_id === me.id;
          const x1 = atkLeft ? cx - 150 : cx + 150;
          const x2 = atkLeft ? cx + 150 : cx - 150;
          laser(x1, cy, x2, cy, atkLeft ? "#00E5FF" : "#ff6b6b");
          setTimeout(() => explode(x2, cy, "#ffaa00"), 150);
          log(`${a.attacker_name} 造成 ${a.damage} 點傷害！`);
        }
      }
    }
    if (b.status === "finished") {
      const won = b.winner_id === myId;
      document.getElementById("bt-actions").innerHTML =
        `<div style="font-size:20px;font-weight:800;color:${won ? "#00E5FF" : "#8B93C9"}">${won ? "勝利！" : "敗北…"}</div>
         <a class="btn btn-ghost" href="space.html">返回太空</a>`;
      if (won) explode(W / 2, H / 2, "#00E5FF");
    }
  } catch (e) { /* 靜默 */ }
}

document.getElementById("bt-atk").onclick = async () => {
  const btn = document.getElementById("bt-atk");
  btn.disabled = true;
  try {
    // 傷害由前端根據答題/武器計算，這裡簡化為隨機 10-25
    // 實際可接武器系統
    const damage = 10 + Math.floor(Math.random() * 16);
    const r = await post(`/space/battle/${battleId}/attack`, { damage });
    log(`你造成 ${r.damage} 點傷害！`);
    await refresh();
  } catch (e) {
    log(e.message);
  }
  btn.disabled = false;
};

(async function init() {
  if (!isLoggedIn() || !battleId) { location.href = "space.html"; return; }
  draw();
  await refresh();
  setInterval(refresh, 2000); // 每 2 秒同步 HP
})();
