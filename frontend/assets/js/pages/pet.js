/* 靈獸小屋：查看靈獸狀態、孵化、改名
 * 全鏈路調真實後端，零假數據。
 * 生命週期：init → loading → api → render / empty / error
 */
import { post, get } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("p-view");
const userline = document.getElementById("p-userline");

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

/* ---- 無靈獸：孵化 ---- */
function renderNoPet() {
  view.innerHTML = `<div class="p-hatch">
    <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空巢插圖">
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
    skeleton();
    announce("靈蛋孵化中");
    try {
      const r = await post("/world/pet/hatch", { name });
      const pet = r.pet || r.data || r;
      if (!pet || !pet.id) throw new Error("後端未回傳靈獸資料");
      announce(`孵化成功！${pet.name} 加入了你的小屋`);
      renderPet(pet);
    } catch (e) {
      errorView(`孵化失敗：${e.message}（${e.code || "未知"}）`, renderNoPet);
    }
  };
}

/* ---- 有靈獸：狀態 + 改名 ---- */
function renderPet(pet) {
  const mood = Number(pet.mood);
  const moodPct = Number.isNaN(mood) ? 0 : Math.max(0, Math.min(100, mood));
  view.innerHTML = `<div class="p-pet">
    <img src="../assets/img/emblem-pet.webp?v=3.0.0" alt="靈獸徽章" class="p-pet-emblem">
    <h2>${escapeHtml(pet.name || "無名靈獸")}</h2>
    <p class="p-species">${escapeHtml(pet.species || "未知種類")} · Lv.${escapeHtml(String(pet.level ?? 1))}</p>

    <div class="card p-stats" role="list" aria-label="靈獸狀態">
      <div class="p-stat" role="listitem">
        <span>經驗值</span><strong>${escapeHtml(String(pet.exp ?? 0))}</strong>
      </div>
      <div class="p-stat" role="listitem">
        <span>相遇日期</span><strong>${escapeHtml(fmtDate(pet.created_at))}</strong>
      </div>
      <div class="p-mood" role="listitem">
        <div class="p-mood-head"><span>心情</span>
          <strong>${escapeHtml(moodLabel(pet.mood))}${Number.isNaN(mood) ? "" : `（${mood}）`}</strong></div>
        <div class="p-mood-bar" role="progressbar" aria-valuenow="${moodPct}"
          aria-valuemin="0" aria-valuemax="100" aria-label="靈獸心情值">
          <div class="p-mood-fill" style="width:${moodPct}%"></div>
        </div>
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

  document.getElementById("p-rename-btn").onclick = async () => {
    const name = document.getElementById("p-newname").value.trim();
    if (!name) { announce("請輸入新的名字"); return; }
    if (name === pet.name) { announce("名字沒有改變"); return; }
    announce("改名中");
    try {
      const r = await post("/world/pet/rename", { name });
      const updated = r.pet || r.data || r;
      if (!updated || !updated.id) throw new Error("後端未回傳靈獸資料");
      announce(`改名成功，現在叫${updated.name}`);
      renderPet(updated);
    } catch (e) {
      announce(`改名失敗：${e.message}`);
    }
  };
}

/* ---- 載入 ---- */
async function load() {
  skeleton();
  try {
    const r = await get("/world/pet");
    const pet = r.pet ?? r.data ?? null;
    if (pet && pet.id) {
      renderPet(pet);
    } else {
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
