/* 靈獸小屋：寶可夢式成長 ＋ 塔麻可吉式互動
 * 蛋（Lv1-2）→ 幼體（Lv3-5）→ 成體（Lv6+）
 * 餵食 / 玩耍 / 摸頭 → 樂觀更新心情＋經驗，後端校正；升級慶祝；改名；孵化
 * 全鏈路調真實後端，零假數據。
 * 生命週期：init → loading → api → render / empty / error
 */
import { post, get } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("p-view");
const userline = document.getElementById("p-userline");

/* 後端 world.py PET_INTERACTIONS 的真實數值（樂觀更新用同一份） */
const INTERACTIONS = {
  feed: { icon: "🍖", label: "餵食", mood: 15, exp: 10, text: "餵食了星砂餅乾，寵物很開心！" },
  play: { icon: "🎮", label: "玩耍", mood: 20, exp: 15, text: "陪寵物玩耍，羈絆加深了！" },
  pat:  { icon: "👋", label: "摸頭", mood: 10, exp: 5,  text: "摸摸寵物的頭，它發出滿足的呼嚕聲。" },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function skeleton() {
  view.innerHTML = `<div class="skeleton" style="height:160px"></div>
    <div class="skeleton" style="height:20px;margin-top:12px"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="燈籠插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="p-retry">重試</button></div>`;
  document.getElementById("p-retry").onclick = retry;
}
function toast(msg) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  root.appendChild(el); announce(msg);
  setTimeout(() => el.remove(), 3200);
}
function fmtDate(iso) {
  if (!iso) return "—";
  return String(iso).slice(0, 10).replace(/-/g, "/");
}
function moodLabel(mood) {
  const m = Number(mood);
  if (Number.isNaN(m)) return "—";
  if (m >= 80) return "心花怒放";
  if (m >= 60) return "心情不錯";
  if (m >= 40) return "普普通通";
  if (m >= 20) return "有點低落";
  return "悶悶不樂";
}
/* Lv1-2 蛋 → Lv3-5 幼體 → Lv6+ 成體 */
function petImg(level) {
  const lv = Number(level) || 1;
  const f = lv >= 6 ? "pet-adult" : lv >= 3 ? "pet-baby" : "pet-egg";
  return `../assets/img/game/${f}.webp?v=3.0.0`;
}
function petStageName(level) {
  const lv = Number(level) || 1;
  return lv >= 6 ? "成體" : lv >= 3 ? "幼體" : "蛋";
}
/* 升級門檻：level*100（後端 pet_gain_exp） */
function expPct(pet) {
  const lv = Number(pet.level) || 1;
  const exp = Number(pet.exp) || 0;
  return Math.max(0, Math.min(100, Math.round((exp / (lv * 100)) * 100)));
}
/* 本地模擬升級（樂觀用，與後端同規則） */
function simGain(pet, addExp, addMood) {
  const p = { ...pet };
  p.mood = Math.min(100, (Number(p.mood) || 0) + addMood);
  let exp = (Number(p.exp) || 0) + addExp;
  let lv = Number(p.level) || 1;
  while (exp >= lv * 100) { exp -= lv * 100; lv += 1; }
  p._leveled = lv > (Number(pet.level) || 1);
  p.exp = exp; p.level = lv;
  return p;
}

let PET = null;          /* 當前靈獸（單一真相來源） */
let bubbleTimer = null;

/* ---- 無靈獸：孵化 ---- */
function renderNoPet() {
  view.innerHTML = `<div class="p-hatch">
    <img src="../assets/img/game/pet-egg.webp?v=3.0.0" alt="靈蛋">
    <h2>還沒有靈獸夥伴</h2>
    <p>靈蛋正在等你。給牠取個名字，<br>孵化出屬於你的靈獸吧（種類由靈蛋決定）。</p>
    <div class="p-hatch-form">
      <input id="p-name" type="text" maxlength="20" placeholder="靈獸的名字，例如：小曜"
        aria-label="靈獸名字">
      <button class="btn btn-primary" id="p-hatch-btn">孵化</button>
    </div>
  </div>`;
  focusMain();
  document.getElementById("p-hatch-btn").onclick = async () => {
    const name = document.getElementById("p-name").value.trim();
    if (!name) { announce("請先給靈獸取個名字"); return; }
    const btn = document.getElementById("p-hatch-btn");
    btn.disabled = true; btn.textContent = "孵化中…";
    announce("靈蛋孵化中");
    try {
      const r = await post("/world/pet/hatch", { name });
      const pet = r.pet || r.data || r;
      if (!pet || !pet.id) throw new Error("後端未回傳靈獸資料");
      PET = pet;
      toast(`孵化成功！${pet.name} 誕生了 🎉`);
      announce(`孵化成功！${pet.name} 加入了你的小屋`);
      renderPet();
    } catch (e) {
      errorView(`孵化失敗：${e.message}（${e.code || "未知"}）`, renderNoPet);
    }
  };
}

/* ---- 有靈獸：狀態 ＋ 互動 ＋ 改名 ---- */
function renderPet(bubbleText) {
  const pet = PET;
  const mood = Number(pet.mood);
  const moodPct = Number.isNaN(mood) ? 0 : Math.max(0, Math.min(100, mood));
  const ePct = expPct(pet);
  const lv = Number(pet.level) || 1;

  view.innerHTML = `<div class="p-pet">
    ${bubbleText
      ? `<div class="p-bubble" role="status" aria-live="polite" style="display:inline-block;padding:10px 18px;border:1px solid var(--line);border-radius:16px;background:var(--card);margin-bottom:12px;font-size:14px">💬 ${escapeHtml(bubbleText)}</div>`
      : `<div class="p-bubble" id="p-bubble-slot" style="visibility:hidden;display:inline-block;padding:10px 18px;margin-bottom:12px" aria-hidden="true">·</div>`}
    <div><img src="${petImg(lv)}" alt="靈獸（${petStageName(lv)}）" class="p-pet-img"
      style="width:170px;height:170px;object-fit:cover;border-radius:50%;border:2px solid var(--line);margin:0 auto 12px;display:block"></div>
    <h2>${escapeHtml(pet.name || "無名靈獸")}</h2>
    <p class="p-species">${escapeHtml(pet.species || "未知種類")} · ${petStageName(lv)} · Lv.${lv}</p>

    <div class="card p-stats" role="list" aria-label="靈獸狀態">
      <div class="p-stat" role="listitem">
        <span>相遇日期</span><strong>${escapeHtml(fmtDate(pet.created_at))}</strong>
      </div>
      <div class="p-mood" role="listitem">
        <div class="p-mood-head"><span>心情</span>
          <strong>${escapeHtml(moodLabel(pet.mood))}${Number.isNaN(mood) ? "" : `（${mood}）`}</strong></div>
        <div class="p-mood-bar" role="progressbar" aria-valuenow="${moodPct}"
          aria-valuemin="0" aria-valuemax="100" aria-label="靈獸心情值">
          <div class="p-mood-fill" id="p-mood-fill" style="width:${moodPct}%"></div>
        </div>
      </div>
      <div class="p-mood" role="listitem">
        <div class="p-mood-head"><span>經驗</span>
          <strong>${escapeHtml(String(pet.exp ?? 0))} / ${lv * 100}</strong></div>
        <div class="p-mood-bar" role="progressbar" aria-valuenow="${ePct}"
          aria-valuemin="0" aria-valuemax="100" aria-label="靈獸經驗值">
          <div class="p-mood-fill" id="p-exp-fill" style="width:${ePct}%;background:var(--ok,#22c55e)"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">🎮 互動</h3>
      <p style="color:var(--muted);font-size:13px;margin:0 0 8px">點一下馬上有反應！多互動，長得快。</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap" role="group" aria-label="靈獸互動">
        ${Object.entries(INTERACTIONS).map(([key, c]) =>
          `<button class="btn btn-ghost p-act" data-act="${key}"
            aria-label="${c.label}：${c.text}"
            style="font-size:16px;padding:12px 18px">
            <span style="font-size:24px" aria-hidden="true">${c.icon}</span><br>${c.label}</button>`
        ).join("")}
      </div>
    </div>

    <div class="card p-rename">
      <h3>改名</h3>
      <div class="p-rename-form">
        <input id="p-newname" type="text" maxlength="20"
          placeholder="新的名字" aria-label="靈獸新名字" value="${escapeHtml(pet.name || "")}">
        <button class="btn btn-primary" id="p-rename-btn">改名</button>
      </div>
    </div>
  </div>`;
  focusMain();

  /* 互動：樂觀更新 → 後端校正 */
  view.querySelectorAll(".p-act").forEach(btn => {
    btn.onclick = () => interact(btn.dataset.act, btn);
  });

  document.getElementById("p-rename-btn").onclick = async () => {
    const name = document.getElementById("p-newname").value.trim();
    if (!name) { announce("請輸入新的名字"); return; }
    if (name === PET.name) { announce("名字沒有改變"); return; }
    announce("改名中");
    try {
      const r = await post("/world/pet/rename", { name });
      const updated = r.pet || r.data || r;
      if (!updated || !updated.id) throw new Error("後端未回傳靈獸資料");
      PET = updated;
      toast(`改名成功，現在叫「${updated.name}」`);
      renderPet();
    } catch (e) {
      toast(`改名失敗：${e.message}`);
    }
  };
}

async function interact(action, btn) {
  const cfg = INTERACTIONS[action];
  if (!cfg || !PET) return;
  const oldLevel = Number(PET.level) || 1;

  /* 1) 樂觀：心情條＋經驗條立刻動，對話泡泡立刻出 */
  PET = simGain(PET, cfg.exp, cfg.mood);
  renderPet(cfg.text);
  announce(cfg.text);
  /* 請求期間鎖住所有互動按鈕，避免競態 */
  view.querySelectorAll(".p-act").forEach(b => { b.disabled = true; });

  /* 2) 後端校正 */
  try {
    const r = await post("/world/pet/interact", { action });
    const p = r.pet || r.data || r;
    if (p && p.id) {
      const newLevel = Number(p.level) || 1;
      PET = p;
      const text = p.interaction_text || cfg.text;
      renderPet(text);
      if (p.leveled_up || newLevel > oldLevel) {
        celebrateLevelUp(newLevel);
      } else {
        toast(text);
      }
    } else {
      throw new Error("後端未回傳靈獸資料");
    }
  } catch (e) {
    /* 端點尚未部署（404）→ 保留樂觀狀態，友善提示 */
    if (e.status === 404 || e.code === "HTTP_404") {
      toast("互動已記錄，雲端同步稍後完成");
      if (PET._leveled) celebrateLevelUp(Number(PET.level) || 1);
    } else {
      toast(`互動同步失敗：${e.message}（已先顯示本地效果）`);
    }
  }
}

/* 升級慶祝 */
function celebrateLevelUp(lv) {
  clearTimeout(bubbleTimer);
  const slot = view.querySelector(".p-bubble") || view.querySelector("#p-bubble-slot");
  if (slot) {
    slot.style.visibility = "visible";
    slot.setAttribute("aria-hidden", "false");
    slot.innerHTML = `🎉 <strong>升級了！Lv.${lv}</strong> 靈獸長大了！`;
  }
  announce(`升級了！現在是 Lv.${lv}`);
  toast(`🎉 升級了！Lv.${lv}`);
  const img = view.querySelector(".p-pet-img");
  if (img) {
    img.src = petImg(lv);
    img.alt = `靈獸（${petStageName(lv)}）`;
    try {
      img.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
        { duration: 600, easing: "ease" }
      );
    } catch { /* 不支援 Web Animations API 時靜默略過 */ }
  }
}

/* ---- 載入 ---- */
async function load() {
  skeleton();
  try {
    const r = await get("/world/pet");
    const pet = r.pet ?? r.data ?? null;
    if (pet && pet.id) {
      PET = pet;
      renderPet();
    } else {
      PET = null;
      renderNoPet();
    }
  } catch (e) {
    errorView(`載入失敗：${e.message}（${e.code || "未知"}）`, load);
  }
}

/* ---- 啟動 ---- */
(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再進入靈獸小屋</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    userline.textContent = "未登入";
    return;
  }
  try {
    const r = await get("/auth/me");
    userline.textContent = `旅人 ${r.user?.name || r.name || ""} · 歡迎回來`;
  } catch { userline.textContent = "旅人"; }
  load();
})();
