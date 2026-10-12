/* 我的家：溫馨小屋版 v2.1
 * 直連 Supabase，不再經 Render 後端
 */
import { supabase, getUser } from "../core/supabase.js";
import { isLoggedIn, clearAuth } from "../core/auth.js";
import { toast } from "../core/a11y.js";

const view = document.getElementById("mh-view");
if (!view) throw new Error("找不到 #mh-view");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function showLogin(msg) {
  view.innerHTML = '<div class="center" style="padding:40px">'
    + '<p style="color:#A08060">' + esc(msg || "請先登入再回家") + '</p>'
    + '<a class="btn-warm" href="settings.html">去登入</a></div>';
}

function showLoading() {
  view.innerHTML = '<p class="center" style="color:#A08060">正在點亮壁爐…</p>';
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
  showLoading();

  let user = null;
  try {
    user = await getUser();
    if (!user) throw new Error("no user");
  } catch (e) {
    if (isLoggedIn()) clearAuth();
    showLogin("登入已過期，請重新登入");
    return;
  }
  const userId = user.id;

  // 並行載入島嶼和靈獸資料（直讀 Supabase）
  const [islandR, petR] = await Promise.allSettled([
    supabase.from("islands").select("*").eq("user_id", userId).limit(1).single(),
    supabase.from("pets").select("*").eq("owner_id", userId).limit(1).single(),
  ]);

  const st = islandR.status === "fulfilled" ? islandR.value.data : null;
  const pet = petR.status === "fulfilled" ? petR.value.data : null;
  const territory = st ? (Number(st.territory) || 0) : 0;
  const explorePct = Math.min(100, Math.round((territory / 50) * 100));

  const petHtml = pet
    ? '<img class="pet-img" src="' + petImg(pet.level) + '" alt="靈獸">'
      + '<div class="pet-name">' + esc(pet.name || "無名") + '</div>'
      + '<div class="pet-status">Lv.' + (pet.level || 1) + '</div>'
      + '<div><span class="speech">' + petMood(pet.mood) + '</span></div>'
      + '<a class="btn-warm" href="pet.html">去陪牠玩</a>'
    : '<img src="../assets/img/game/pet-egg.webp?v=3.0.0" alt="靈獸蛋" style="width:72px;height:72px;object-fit:contain">'
      + '<div class="pet-name">還沒有夥伴</div>'
      + '<div><span class="speech">孵化一顆蛋，開始你們的故事吧</span></div>'
      + '<a class="btn-warm" href="pet.html">去孵化</a>';

  view.innerHTML = ''
    + '<div class="cards">'
    + '<div class="card-wood"><h2>靈獸夥伴</h2><div class="pet-wrap">' + petHtml + '</div></div>'
    + '<div class="card-wood"><h2>我的領地</h2><div class="big-num">' + territory + '</div>'
    + '<p class="center" style="color:#A08060;font-size:13px">領土單位</p>'
    + '<div class="deco"><img src="../assets/img/game/island-1.webp?v=3.0.0" alt="島嶼" style="width:48px;height:48px;object-fit:contain"></div>'
    + '<p class="center" style="font-size:13px;color:#A08060">每一塊土地都是你努力的證明</p>'
    + '<div class="center" style="margin-top:12px"><a class="btn-soft" href="island.html">開疆拓土</a></div></div>'
    + '<div class="card-wood"><h2>探索回憶</h2><div class="bar"><div style="width:' + explorePct + '%"></div></div>'
    + '<p class="center" style="font-size:14px"><strong>' + explorePct + '%</strong></p>'
    + '<p class="center" style="font-size:13px;color:#A08060">走過的路，都會變成星光</p>'
    + '<div class="center" style="margin-top:12px"><a class="btn-soft" href="explore.html">繼續冒險</a></div></div>'
    + '<div class="card-wood" style="grid-column:1/-1"><h2>傳送門</h2>'
    + '<p style="font-size:14px;color:#A08060">去拜訪好友的家，看看他們過得怎麼樣</p>'
    + '<div class="row"><input class="warm" id="mh-portal-name" type="text" placeholder="輸入好友的名字…" aria-label="好友名字">'
    + '<button class="btn-warm" id="mh-portal-go" style="white-space:nowrap">出發</button></div>'
    + '<div id="mh-portal-result" style="margin-top:12px"></div></div>'
    + '</div>';

  // 傳送門：查 profiles 找好友，再查他的島嶼和靈獸
  const goBtn = document.getElementById("mh-portal-go");
  if (goBtn) {
    goBtn.onclick = async () => {
      const nameEl = document.getElementById("mh-portal-name");
      const name = nameEl ? nameEl.value.trim() : "";
      if (!name) { toast("請輸入好友名字"); return; }
      const resultEl = document.getElementById("mh-portal-result");
      goBtn.disabled = true; goBtn.textContent = "出發中…";
      try {
        const { data: friend } = await supabase.from("profiles").select("id, name")
          .ilike("name", `%${name}%`).limit(1).single();
        if (!friend) throw new Error("找不到這位好友");
        const [fIsland, fPet] = await Promise.allSettled([
          supabase.from("islands").select("territory").eq("user_id", friend.id).limit(1).single(),
          supabase.from("pets").select("name").eq("owner_id", friend.id).limit(1).single(),
        ]);
        const fTerritory = fIsland.status === "fulfilled" ? (fIsland.value.data?.territory ?? "?") : "?";
        const fPetName = fPet.status === "fulfilled" ? (fPet.value.data?.name || "無") : "無";
        resultEl.innerHTML = '<div style="background:#FFF8F0;border:2px solid #E8D5B8;border-radius:12px;padding:14px">'
          + '<p style="margin:0 0 6px"><strong>' + esc(friend.name) + ' 的家</strong></p>'
          + '<p style="margin:0;font-size:13px;color:#A08060">領土 ' + fTerritory + ' · 夥伴 ' + esc(fPetName) + '</p></div>';
      } catch (e) {
        resultEl.innerHTML = '<p style="color:#c0392b;font-size:13px">' + esc(e.message) + '</p>';
      } finally {
        goBtn.disabled = false; goBtn.textContent = "出發";
      }
    };
  }
}

// 超時保護
const timeout = setTimeout(() => {
  if (view.innerHTML.includes("正在點亮壁爐")) {
    view.innerHTML = '<div class="center" style="padding:40px">'
      + '<p style="color:#A08060">載入有點慢，再試一次吧</p>'
      + '<button class="btn-warm" onclick="location.reload()">重新載入</button></div>';
  }
}, 10000);

render().finally(() => clearTimeout(timeout));
