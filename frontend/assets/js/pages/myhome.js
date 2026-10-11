/* 我的家：溫馨小屋版 */
import { get, post } from "../core/api.js";
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

function petMood(mood) {
  const m = Number(mood) || 50;
  if (m >= 80) return "今天心情超好！";
  if (m >= 60) return "心情不錯喔";
  if (m >= 40) return "有點想你了";
  return "快來陪陪我吧…";
}

async function render() {
  view.innerHTML = `<p class="center" style="color:#A08060">正在點亮壁爐…</p>`;
  try {
    const [statusR, petR] = await Promise.allSettled([
      get(`/islands/${userId}`),
      get("/world/pet"),
    ]);
    const st = statusR.status === "fulfilled" ? (statusR.value.island || statusR.value) : null;
    const pet = petR.status === "fulfilled" ? (petR.value.pet || petR.value.data?.pet) : null;
    const territory = st ? (Number(st.territory) || 0) : 0;
    const explorePct = Math.min(100, Math.round((territory / 50) * 100));

    view.innerHTML = `
      <div class="cards">
        <div class="card-wood">
          <h2>靈獸夥伴</h2>
          <div class="pet-wrap">
            ${pet ? `
              <img class="pet-img" src="${petImg(pet.level)}" alt="">
              <div class="pet-name">${escapeHtml(pet.name || "無名")}</div>
              <div class="pet-status">Lv.${pet.level || 1}</div>
              <div><span class="speech">${petMood(pet.mood)}</span></div>
              <a class="btn-warm" href="pet.html">去陪牠玩</a>` : `
              <div style="font-size:56px">🥚</div>
              <div class="pet-name">還沒有夥伴</div>
              <div><span class="speech">孵化一顆蛋，開始你們的故事吧</span></div>
              <a class="btn-warm" href="pet.html">去孵化</a>`}
          </div>
        </div>

        <div class="card-wood">
          <h2>我的領地</h2>
          <div class="big-num">${territory}</div>
          <p class="center" style="color:#A08060;font-size:13px">領土單位</p>
          <div class="deco">🏡</div>
          <p class="center" style="font-size:13px;color:#A08060">每一塊土地都是你努力的證明</p>
          <div class="center" style="margin-top:12px"><a class="btn-soft" href="island.html">開疆拓土</a></div>
        </div>

        <div class="card-wood">
          <h2>探索回憶</h2>
          <div class="bar"><div style="width:${explorePct}%"></div></div>
          <p class="center" style="font-size:14px"><strong>${explorePct}%</strong></p>
          <p class="center" style="font-size:13px;color:#A08060">走過的路，都會變成星光</p>
          <div class="center" style="margin-top:12px"><a class="btn-soft" href="explore.html">繼續冒險</a></div>
        </div>

        <div class="card-wood" style="grid-column:1/-1">
          <h2>傳送門</h2>
          <p style="font-size:14px;color:#A08060">去拜訪好友的家，看看他們過得怎麼樣（需要 20 星砂）</p>
          <div class="row">
            <input class="warm" id="mh-portal-name" type="text" placeholder="輸入好友的名字…" aria-label="好友名字">
            <button class="btn-warm" id="mh-portal-go" style="white-space:nowrap">出發</button>
          </div>
          <div id="mh-portal-result" style="margin-top:12px"></div>
        </div>

        <div class="card-wood" style="grid-column:1/-1">
          <h2>佈置小屋</h2>
          <p style="font-size:14px;color:#A08060">換個壁紙、擺設，讓家更有你的味道。拜訪時好友也會看到喔。</p>
          <div style="margin-top:12px"><a class="btn-soft" href="island.html#skin">去佈置</a></div>
        </div>
      </div>`;

    const goBtn = document.getElementById("mh-portal-go");
    if (goBtn) {
      goBtn.onclick = async () => {
        const name = document.getElementById("mh-portal-name").value.trim();
        if (!name) { toast("請輸入好友名字"); return; }
        const resultEl = document.getElementById("mh-portal-result");
        goBtn.disabled = true; goBtn.textContent = "出發中…";
        try {
          const r = await post(`/islands/${userId}/visit`, { friend_name: name });
          resultEl.innerHTML = `<div style="background:#FFF8F0;border:2px solid #E8D5B8;border-radius:12px;padding:14px">
            <p style="margin:0 0 6px"><strong>🏠 ${escapeHtml(r.friend_name || name)} 的家</strong></p>
            <p style="margin:0;font-size:13px;color:#A08060">領土 ${r.territory ?? "?"} · 夥伴 ${escapeHtml(r.pet_name || "無")}</p>
          </div>`;
        } catch (e) {
          resultEl.innerHTML = `<p style="color:#c0392b;font-size:13px">${escapeHtml(e.message)}</p>`;
        }
        goBtn.disabled = false; goBtn.textContent = "出發";
      };
    }
  } catch (e) {
    view.innerHTML = `<p class="center">載入失敗：${escapeHtml(e.message)}</p>`;
  }
  focusMain();
}

(function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="center" style="padding:40px">
      <p style="color:#A08060">請先登入再回家</p>
      <a class="btn-warm" href="settings.html">去登入</a></div>`;
    return;
  }
  render();
})();
