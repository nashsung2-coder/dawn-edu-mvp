/* 角色選擇：像 PaGamO 一樣，6 種角色各有能力加成（Supabase 直連版）
 * 角色目錄為前端靜態定義（與後端 character.py 同步）
 * 用戶選擇存在 characters 表（is_active 標記當前角色）
 */
import { supabase, getUser } from "../core/supabase.js";
import { isLoggedIn } from "../core/auth.js";
import { focusMain, toast } from "../core/a11y.js";

const view = document.getElementById("ch-view");

/* 角色目錄（與後端 character.py CHARACTERS 同步） */
const CHARACTERS = {
  scholar: {
    name: "博學者", desc: "知識就是力量。學習時獲得更多經驗。",
    bonuses: { exp_gain: 1.2, review_interval: 1.1 }, color: "#4A90D9",
  },
  warrior: {
    name: "戰士", desc: "無畏的挑戰者。對決時攻擊力提升。",
    bonuses: { duel_attack: 1.2, weapon_dmg: 1.1 }, color: "#E74C3C",
  },
  explorer: {
    name: "探索家", desc: "好奇心驅動。圖書館探索進度更快。",
    bonuses: { explore_gain: 1.2, page_progress: 1.1 }, color: "#27AE60",
  },
  diplomat: {
    name: "外交家", desc: "人脈就是資源。交易和社交收益提升。",
    bonuses: { trade_bonus: 1.15, social_exp: 1.2 }, color: "#9B59B6",
  },
  craftsman: {
    name: "工匠", desc: "巧手打造。武器鍛造和升級更強。",
    bonuses: { craft_quality: 1.2, upgrade_cost: 0.9 }, color: "#F39C12",
  },
  sage: {
    name: "智者", desc: "深思熟慮。費曼說服更容易達標。",
    bonuses: { feynman_score: 1.15, question_quality: 1.2 }, color: "#1ABC9C",
  },
};

let myUserId = null;

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const BONUS_LABELS = {
  exp_gain: "經驗值",
  review_interval: "複習間隔",
  duel_attack: "對決攻擊",
  weapon_dmg: "武器傷害",
  explore_gain: "探索進度",
  page_progress: "閱讀進度",
  trade_bonus: "交易收益",
  social_exp: "社交經驗",
  craft_quality: "鍛造品質",
  upgrade_cost: "升級費用",
  feynman_score: "費曼評分",
  question_quality: "提問品質",
};

function bonusText(bonuses) {
  return Object.entries(bonuses || {}).map(([k, v]) => {
    const label = BONUS_LABELS[k] || k;
    const pct = v >= 1 ? `+${Math.round((v - 1) * 100)}%` : `-${Math.round((1 - v) * 100)}%`;
    return `${label} ${pct}`;
  }).join(" · ");
}

/* 讀取用戶當前角色 */
async function getMyCharacter() {
  try {
    const { data, error } = await supabase
      .from("characters")
      .select("name")
      .eq("user_id", myUserId)
      .eq("is_active", true)
      .limit(1)
      .single();
    if (error) return null;
    // name 存的是角色 id（如 "scholar"）
    return data?.name || null;
  } catch (e) {
    return null;
  }
}

/* 設定用戶角色 */
async function setMyCharacter(charId) {
  // 先把舊的設為非 active
  await supabase
    .from("characters")
    .update({ is_active: false })
    .eq("user_id", myUserId);
  // 插入或更新新的
  const { data: existing } = await supabase
    .from("characters")
    .select("id")
    .eq("user_id", myUserId)
    .eq("name", charId)
    .limit(1)
    .single();
  if (existing) {
    const { error } = await supabase
      .from("characters")
      .update({ is_active: true })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("characters")
      .insert({ user_id: myUserId, name: charId, is_active: true });
    if (error) throw error;
  }
}

async function render() {
  view.innerHTML = `<p style="color:var(--muted);text-align:center">載入中…</p>`;
  try {
    const current = await getMyCharacter();

    view.innerHTML = `
      <p style="text-align:center;color:var(--muted);margin-bottom:20px">
        選擇你的角色。每種角色有不同的能力加成，選擇是策略，不只是外觀。<br>
        隨時可以更換。
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${Object.entries(CHARACTERS).map(([id, c]) => `
          <div class="card" style="padding:20px;text-align:center;
            ${current === id ? "border:2px solid var(--accent);" : ""}">
            <div style="width:80px;height:80px;border-radius:50%;margin:0 auto 12px;
              background:${c.color}22;border:2px solid ${c.color};
              display:flex;align-items:center;justify-content:center;
              font-size:32px;font-weight:800;color:${c.color}">
              ${escapeHtml(c.name[0])}
            </div>
            <h3 style="margin:0 0 8px">${escapeHtml(c.name)}</h3>
            <p style="font-size:13px;color:var(--muted);margin-bottom:12px">${escapeHtml(c.desc)}</p>
            <p style="font-size:12px;color:var(--accent);margin-bottom:16px">${escapeHtml(bonusText(c.bonuses))}</p>
            ${current === id
              ? `<span style="font-size:13px;color:var(--accent)">當前角色</span>`
              : `<button class="btn btn-primary ch-select" data-id="${id}" style="width:100%">選擇</button>`}
          </div>`).join("")}
      </div>`;

    view.querySelectorAll(".ch-select").forEach(b => {
      b.onclick = async () => {
        b.disabled = true; b.textContent = "選擇中…";
        try {
          await setMyCharacter(b.dataset.id);
          toast("角色已更換！");
          render();
        } catch (e) {
          toast("更換失敗：" + e.message);
          b.disabled = false; b.textContent = "選擇";
        }
      };
    });
  } catch (e) {
    view.innerHTML = `<p>載入失敗：${escapeHtml(e.message)}</p>`;
  }
  focusMain();
}

(async function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">
      <p>請先登入再選擇角色</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  try {
    const user = await getUser();
    if (!user) throw new Error("無法取得使用者");
    myUserId = user.id;
  } catch (e) {
    view.innerHTML = `<p>載入失敗：${escapeHtml(e.message)}</p>`;
    return;
  }
  render();
})();
