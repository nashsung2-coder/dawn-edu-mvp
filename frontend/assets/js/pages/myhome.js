/* 我的家：獨立家園頁。寵物、領地、探索進度、傳送門、換膚。 */
import { get, post, swr } from "../core/api.js";
import { isLoggedIn, getUserId } from "../core/auth.js";
import { focusMain, toast } from "../core/a11y.js";

const view = document.getElementById("mh-view");
const userId = getUserId();

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function petImg(level) {
  const lv = Number(level) || 1;
  if (lv >= 10) return "../assets/img/game/pet-adult.webp?v=3.0.0";
  if (lv >= 5) return "../assets/img/game/pet-baby.webp?v=3.0.0";
  return "../assets/img/game/pet-egg.webp?v=3.0.0";
}

async function render() {
  view.innerHTML = `<p style="color:#8B93C9;text-align:center;grid-column:1/-1">載入中…</p>`;
  try {
    const [statusR, petR, skinR] = await Promise.allSettled([
      get(`/islands/${userId}`),
      get("/world/pet"),
      get(`/islands/${userId}/skin`).catch(() => null),
    ]);

    const st = statusR.status === "fulfilled" ? (statusR.value.island || statusR.value) : null;
    const pet = petR.status === "fulfilled" ? (petR.value.pet || petR.value.data?.pet) : null;
    const territory = st ? (Number(st.territory) || 0) : 0;
    const explorePct = Math.min(100, Math.round((territory / 50) * 100));

    view.innerHTML = `
      <!-- 寵物 -->
      <div class="home-card">
        <h2>靈獸夥伴</h2>
        ${pet ? `
          <img class="pet-img" src="${petImg(pet.level)}" alt="${escapeHtml(pet.name || "靈獸")}">
          <p style="text-align:center"><strong>${escapeHtml(pet.name || "無名")}</strong> Lv.${pet.level || 1}</p>
          <p style="text-align:center;font-size:12px">飽食度 ${pet.hunger ?? "?"}% · 心情 ${pet.mood ?? "?"}</p>
          <div class="btn-row" style="justify-content:center">
            <a class="btn btn-primary" href="pet.html" style="font-size:13px">去互動</a>
          </div>` : `
          <p style="text-align:center;font-size:40px;margin:8px 0">🥚</p>
          <p style="text-align:center">還沒有靈獸</p>
          <div class="btn-row" style="justify-content:center">
            <a class="btn btn-primary" href="pet.html" style="font-size:13px">去孵化</a>
          </div>`}
      </div>

      <!-- 領地 -->
      <div class="home-card">
        <h2>領地</h2>
        <div style="text-align:center">
          <div class="stat-num">${territory}</div>
          <p>領土單位</p>
        </div>
        <div class="btn-row" style="justify-content:center">
          <a class="btn btn-ghost" href="island.html" style="font-size:13px">開疆拓土</a>
        </div>
      </div>

      <!-- 探索進度 -->
      <div class="home-card">
        <h2>探索進度</h2>
        <div class="bar-wrap" style="margin:12px 0">
          <div class="bar-fill" style="width:${explorePct}%"></div>
        </div>
        <p style="text-align:center">${explorePct}%</p>
        <div class="btn-row" style="justify-content:center">
          <a class="btn btn-ghost" href="explore.html" style="font-size:13px">繼續探索</a>
        </div>
      </div>

      <!-- 傳送門 -->
      <div class="home-card" style="grid-column:1/-1">
        <h2>傳送門</h2>
        <p>拜訪好友的島嶼，看看他們的領地（啟動需 20 星砂）</p>
        <div style="display:flex;gap:8px;max-width:400px">
          <input id="mh-portal-name" type="text" placeholder="好友的名字" aria-label="好友名字">
          <button class="btn btn-primary" id="mh-portal-go" style="white-space:nowrap">拜訪好友</button>
        </div>
        <div id="mh-portal-result" style="margin-top:12px"></div>
      </div>

      <!-- 換膚 -->
      <div class="home-card" style="grid-column:1/-1">
        <h2>島嶼裝扮</h2>
        <p>更換背景、房屋、島嶼風格，拜訪時好友會看到你的裝扮</p>
        <div class="btn-row">
          <a class="btn btn-ghost" href="island.html#skin" style="font-size:13px">去換膚</a>
        </div>
      </div>`;

    // 傳送門邏輯
    const goBtn = document.getElementById("mh-portal-go");
    if (goBtn) {
      goBtn.onclick = async () => {
        const name = document.getElementById("mh-portal-name").value.trim();
        if (!name) { toast("請輸入好友名字"); return; }
        const resultEl = document.getElementById("mh-portal-result");
        goBtn.disabled = true; goBtn.textContent = "傳送中…";
        try {
          const r = await post(`/islands/${userId}/visit`, { friend_name: name });
          resultEl.innerHTML = `<div style="padding:12px;background:#1a2340;border-radius:8px;font-size:13px">
            <p><strong>拜訪 ${escapeHtml(r.friend_name || name)} 的島嶼</strong></p>
            <p>領土：${r.territory ?? "?"} · 寵物：${escapeHtml(r.pet_name || "無")}</p>
            ${r.skin ? `<p style="font-size:12px;color:#8B93C9">裝扮：${escapeHtml(JSON.stringify(r.skin))}</p>` : ""}
          </div>`;
        } catch (e) {
          resultEl.innerHTML = `<p style="color:#ff6b6b;font-size:13px">${escapeHtml(e.message)}</p>`;
        }
        goBtn.disabled = false; goBtn.textContent = "拜訪好友";
      };
    }
  } catch (e) {
    view.innerHTML = `<p style="grid-column:1/-1">載入失敗：${escapeHtml(e.message)}</p>`;
  }
  focusMain();
}

(function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div style="text-align:center;padding:40px;color:#8B93C9;grid-column:1/-1">
      <p>請先登入再查看我的家</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  render();
})();
