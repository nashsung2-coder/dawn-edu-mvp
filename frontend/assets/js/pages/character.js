/* 角色選擇：像 PaGamO 一樣，6 種角色各有能力加成 */
import { get, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { focusMain, toast } from "../core/a11y.js";

const view = document.getElementById("ch-view");

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

async function render() {
  view.innerHTML = `<p style="color:var(--muted);text-align:center">載入中…</p>`;
  try {
    const [charsR, meR] = await Promise.all([
      get("/characters"),
      get("/characters/me").catch(() => ({ character: null })),
    ]);
    const chars = charsR.characters || {};
    const current = meR.character?.id || null;

    view.innerHTML = `
      <p style="text-align:center;color:var(--muted);margin-bottom:20px">
        選擇你的角色。每種角色有不同的能力加成，選擇是策略，不只是外觀。<br>
        隨時可以更換。
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${Object.entries(chars).map(([id, c]) => `
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
          await post("/characters/me", { character_id: b.dataset.id });
          toast("角色已更換！");
          render();
        } catch (e) {
          toast(e.message);
          b.disabled = false; b.textContent = "選擇";
        }
      };
    });
  } catch (e) {
    view.innerHTML = `<p>載入失敗：${escapeHtml(e.message)}</p>`;
  }
  focusMain();
}

(function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">
      <p>請先登入再選擇角色</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  render();
})();
