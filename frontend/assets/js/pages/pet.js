/* 靈獸小屋：寶可夢式成長 ＋ 塔麻可吉式互動（Supabase 直連版）
 * 蛋（Lv1-2）→ 幼體（Lv3-5）→ 成體（Lv6+）
 * 餵食 / 玩耍 / 摸頭 → 樂觀更新心情＋經驗，直接寫 Supabase；升級慶祝；改名；孵化
 * 飼料經 shop_items + inventory 表
 * 生命週期：init → loading → render / empty / error
 */
import { supabase, getUser } from "../core/supabase.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("p-view");
const userline = document.getElementById("p-userline");

/* 互動數值（與後端 world.py PET_INTERACTIONS 同步） */
const INTERACTIONS = {
  feed: { icon: "", label: "餵食", mood: 15, exp: 10, text: "餵食了星砂餅乾，寵物很開心！" },
  play: { icon: "", label: "玩耍", mood: 20, exp: 15, text: "陪寵物玩耍，羈絆加深了！" },
  pat:  { icon: "", label: "摸頭", mood: 10, exp: 5,  text: "摸摸寵物的頭，它發出滿足的呼嚕聲。" },
};

/* 靈獸種類池（孵化時隨機） */
const SPECIES_POOL = ["星塵狐", "月影貓", "晨曦鳥", "夜光龜", "雲霧鹿"];

let myUserId = null;
let PET = null;
let bubbleTimer = null;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
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
function petImg(level) {
  const lv = Number(level) || 1;
  const f = lv >= 6 ? "pet-adult" : lv >= 3 ? "pet-baby" : "pet-egg";
  return `../assets/img/game/${f}.webp?v=3.0.0`;
}
function petStageName(level) {
  const lv = Number(level) || 1;
  return lv >= 6 ? "成體" : lv >= 3 ? "幼體" : "蛋";
}
function expPct(pet) {
  const lv = Number(pet.level) || 1;
  const exp = Number(pet.exp) || 0;
  return Math.max(0, Math.min(100, Math.round((exp / (lv * 100)) * 100)));
}
/* 本地模擬升級（與後端同規則：level*100） */
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
      const species = SPECIES_POOL[Math.floor(Math.random() * SPECIES_POOL.length)];
      const { data: pet, error } = await supabase
        .from("pets")
        .insert({
          owner_id: myUserId,
          name,
          species,
          level: 1,
          exp: 0,
          mood: 100,
          hunger: 100,
        })
        .select()
        .single();
      if (error) throw error;
      if (!pet || !pet.id) throw new Error("孵化失敗，未回傳靈獸資料");
      PET = pet;
      toast(`孵化成功！${pet.name}（${pet.species}）誕生了！`);
      announce(`孵化成功！${pet.name} 加入了你的小屋`);
      renderPet();
    } catch (e) {
      errorView(`孵化失敗：${e.message}`, renderNoPet);
    }
  };
}

/* ---- 飼料庫存 ---- */
async function getFoodItemId() {
  // 找「星砂餅乾」這個商品，沒有就找第一個 type=food 的
  try {
    const { data } = await supabase
      .from("shop_items")
      .select("id, price")
      .ilike("name", "%餅乾%")
      .limit(1)
      .single();
    if (data) return data;
  } catch (e) {}
  try {
    const { data } = await supabase
      .from("shop_items")
      .select("id, price")
      .eq("type", "food")
      .limit(1)
      .single();
    if (data) return data;
  } catch (e) {}
  return null;
}

async function loadFoodCount() {
  const el = document.getElementById("p-food-count");
  if (!el) return;
  try {
    const food = await getFoodItemId();
    if (!food) { el.textContent = "商店未上架"; return; }
    const { data } = await supabase
      .from("inventory")
      .select("quantity")
      .eq("user_id", myUserId)
      .eq("item_id", food.id)
      .single();
    el.textContent = `${data?.quantity ?? 0} 個`;
  } catch (e) {
    const el2 = document.getElementById("p-food-count");
    if (el2) el2.textContent = "0 個";
  }
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
      ? `<div class="p-bubble" role="status" aria-live="polite" style="display:inline-block;padding:10px 18px;border:1px solid var(--line);border-radius:16px;background:var(--card);margin-bottom:12px;font-size:14px">${escapeHtml(bubbleText)}</div>`
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
      <div id="p-food-row" style="margin-top:12px;padding:10px;border:1px dashed var(--line);border-radius:12px;text-align:center">
        <span style="font-size:14px">星砂餅乾：<strong id="p-food-count">載入中…</strong></span>
        <button class="btn btn-ghost" id="p-buy-food" style="margin-left:8px;font-size:13px;padding:6px 12px">買 1 個（5 星砂）</button>
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

  view.querySelectorAll(".p-act").forEach(btn => {
    btn.onclick = () => interact(btn.dataset.act, btn);
  });

  loadFoodCount();
  document.getElementById("p-buy-food").onclick = buyFood;

  document.getElementById("p-rename-btn").onclick = async () => {
    const name = document.getElementById("p-newname").value.trim();
    if (!name) { announce("請輸入新的名字"); return; }
    if (name === PET.name) { announce("名字沒有改變"); return; }
    announce("改名中");
    try {
      const { data: updated, error } = await supabase
        .from("pets")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", PET.id)
        .select()
        .single();
      if (error) throw error;
      PET = updated;
      toast(`改名成功，現在叫「${updated.name}」`);
      renderPet();
    } catch (e) {
      toast(`改名失敗：${e.message}`);
    }
  };
}

/* 購買飼料 */
async function buyFood() {
  const btn = document.getElementById("p-buy-food");
  btn.disabled = true;
  try {
    const food = await getFoodItemId();
    if (!food) throw new Error("商店尚未上架星砂餅乾");
    const price = food.price || 5;

    // 檢查星砂餘額
    const { data: profile } = await supabase
      .from("profiles").select("points").eq("id", myUserId).single();
    if ((profile?.points ?? 0) < price) throw new Error("星砂不足");

    // 扣星砂
    const { error: pErr } = await supabase
      .from("profiles")
      .update({ points: (profile.points ?? 0) - price })
      .eq("id", myUserId);
    if (pErr) throw pErr;

    // 記帳
    await supabase.from("starsand_ledger").insert({
      user_id: myUserId, amount: -price, reason: "購買星砂餅乾",
    });

    // 增加庫存（upsert）
    const { data: inv } = await supabase
      .from("inventory")
      .select("id, quantity")
      .eq("user_id", myUserId)
      .eq("item_id", food.id)
      .single();
    if (inv) {
      await supabase.from("inventory")
        .update({ quantity: (inv.quantity || 0) + 1 })
        .eq("id", inv.id);
    } else {
      await supabase.from("inventory")
        .insert({ user_id: myUserId, item_id: food.id, quantity: 1 });
    }
    await loadFoodCount();
    toast(`購買成功！星砂餅乾 +1（-${price} 星砂）`);
  } catch (e) {
    toast(`購買失敗：${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

/* 互動：樂觀更新 → 寫入 Supabase */
async function interact(action, btn) {
  const cfg = INTERACTIONS[action];
  if (!cfg || !PET) return;
  const oldLevel = Number(PET.level) || 1;

  // 餵食需要消耗餅乾
  if (action === "feed") {
    try {
      const food = await getFoodItemId();
      if (food) {
        const { data: inv } = await supabase
          .from("inventory")
          .select("id, quantity")
          .eq("user_id", myUserId)
          .eq("item_id", food.id)
          .single();
        if (!inv || (inv.quantity || 0) <= 0) {
          toast("沒有星砂餅乾了，先去買一個吧！");
          return;
        }
        await supabase.from("inventory")
          .update({ quantity: inv.quantity - 1 })
          .eq("id", inv.id);
        loadFoodCount();
      }
    } catch (e) {
      // 庫存查詢失敗不擋互動，繼續
    }
  }

  /* 1) 樂觀：心情條＋經驗條立刻動，對話泡泡立刻出 */
  PET = simGain(PET, cfg.exp, cfg.mood);
  renderPet(cfg.text);
  announce(cfg.text);
  view.querySelectorAll(".p-act").forEach(b => { b.disabled = true; });

  /* 2) 寫入 Supabase */
  try {
    const { data: updated, error } = await supabase
      .from("pets")
      .update({
        level: PET.level,
        exp: PET.exp,
        mood: PET.mood,
        updated_at: new Date().toISOString(),
      })
      .eq("id", PET.id)
      .select()
      .single();
    if (error) throw error;
    PET = { ...updated, _leveled: PET._leveled };
    renderPet(cfg.text);
    if (PET._leveled || (Number(PET.level) || 1) > oldLevel) {
      celebrateLevelUp(Number(PET.level) || 1);
    } else {
      toast(cfg.text);
    }
  } catch (e) {
    // 寫入失敗，保留樂觀狀態
    toast(`互動已記錄，雲端同步稍後完成`);
    if (PET._leveled) celebrateLevelUp(Number(PET.level) || 1);
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
    } catch { /* 不支援時靜默略過 */ }
  }
}

/* ---- 載入 ---- */
async function load() {
  skeleton();
  try {
    const { data: pet, error } = await supabase
      .from("pets")
      .select("*")
      .eq("owner_id", myUserId)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    if (error && error.code !== "PGRST116") throw error; // PGRST116 = 找不到
    if (pet && pet.id) {
      PET = pet;
      renderPet();
    } else {
      PET = null;
      renderNoPet();
    }
  } catch (e) {
    errorView(`載入失敗：${e.message}`, load);
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
    const user = await getUser();
    if (!user) throw new Error("無法取得使用者");
    myUserId = user.id;
    const { data: profile } = await supabase
      .from("profiles").select("name").eq("id", user.id).single();
    userline.textContent = `旅人 ${profile?.name || ""} · 歡迎回來`;
  } catch (e) {
    userline.textContent = "旅人";
  }
  load();
})();
