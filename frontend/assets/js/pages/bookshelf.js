/* 我的書架：個人化課本陳列。
 * v4.0：直讀 Supabase，不再經 Render 後端。
 * - textbook_entries → 費曼說服課本條目
 * - battle_records → 戰役紀錄（含技能章）
 */
import { supabase, getUser } from "../core/supabase.js";
import { isLoggedIn } from "../core/auth.js";
import { announce } from "../core/a11y.js";

const shelf = document.getElementById("bs-shelf");
const detail = document.getElementById("bs-detail");
const stats = document.getElementById("bs-stats");
const userline = document.getElementById("bs-userline");

const RARITY_COLORS = { "普通": "#9aa0a6", "稀有": "#4da3ff", "史詩": "#b16dff", "傳說": "#ffb300" };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function rarityColor(r) { return RARITY_COLORS[r] || "#9aa0a6"; }

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }); }
  catch { return ""; }
}

async function renderShelf() {
  if (!isLoggedIn()) {
    shelf.innerHTML = `<div class="state-empty">
      <p>登入後，你的個人化課本會陳列在這裡。</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  shelf.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("登入已過期，請重新登入");

    const [tbRes, battleRes] = await Promise.all([
      supabase.from("textbook_entries").select("*").eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase.from("battle_records").select("*").eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);
    if (tbRes.error) throw tbRes.error;
    if (battleRes.error) throw battleRes.error;

    const feynmanEntries = tbRes.data || [];
    const battles = battleRes.data || [];

    // 費曼說服條目
    let feynmanHtml = "";
    if (feynmanEntries.length) {
      feynmanHtml = `<div style="margin-bottom:24px">
        <h2 style="font-size:18px;margin-bottom:12px">費曼說服 · 我的解釋</h2>
        ${feynmanEntries.map(e => `
          <div class="card" style="padding:16px;margin-bottom:12px">
            <h3 style="margin:0 0 8px">${esc(e.title || e.topic)}</h3>
            ${e.user_voice_summary ? `<p style="font-size:14px"><strong>我的話：</strong>${esc(e.user_voice_summary.slice(0, 200))}…</p>` : ""}
            ${e.ai_supplement ? `<p style="font-size:13px;color:var(--muted)"><strong>AI 補充：</strong>${esc(e.ai_supplement.slice(0, 200))}…</p>` : ""}
            ${(e.key_points || []).length ? `<div style="margin-top:8px">` +
              e.key_points.map(k => `<span style="display:inline-block;background:var(--surface);padding:4px 10px;border-radius:12px;font-size:12px;margin:2px">${esc(k)}</span>`).join("") + `</div>` : ""}
            <p style="font-size:12px;color:var(--muted);margin-top:8px">${fmtDate(e.created_at)}</p>
          </div>`).join("")}
      </div>`;
    }

    if (!battles.length && !feynmanEntries.length) {
      shelf.innerHTML = `<div class="state-empty">
        <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空書架">
        <p>書架還是空的。去打一場費曼戰役，第一章會自動上架。</p>
        <a class="btn btn-primary" href="quiz.html">開始第一戰</a>
        <a class="btn btn-ghost" href="feynman.html" style="margin-left:8px">試試費曼說服</a></div>`;
      stats.innerHTML = "";
      userline.textContent = "";
      return;
    }

    shelf.innerHTML = feynmanHtml + `<div id="bs-chapters"></div>`;
    const chaptersEl = document.getElementById("bs-chapters");

    // 統計
    const badgeCount = battles.filter(b => b.badge_name).length;
    const avgScore = battles.length
      ? battles.reduce((s, b) => s + (b.feynman_score || 0), 0) / battles.length : 0;
    stats.innerHTML = `
      <div class="bs-stat"><span class="bs-stat-n">${battles.length}</span><span class="bs-stat-l">戰役</span></div>
      <div class="bs-stat"><span class="bs-stat-n">${Math.round(avgScore)}</span><span class="bs-stat-l">平均分數</span></div>
      <div class="bs-stat"><span class="bs-stat-n">${badgeCount}</span><span class="bs-stat-l">技能章</span></div>`;
    userline.textContent = `共 ${battles.length} 場戰役 · ${feynmanEntries.length} 篇課本`;

    // 書架陳列
    chaptersEl.innerHTML = `<div class="bs-grid">` + battles.map((b, i) => {
      const r = b.badge_rarity || "普通";
      const quizText = b.quiz_total ? `${b.quiz_score}/${b.quiz_total}` : "";
      return `<button class="bs-book" data-idx="${i}" style="--rarity:${rarityColor(r)}">
        <span class="bs-book-spine"></span>
        <span class="bs-book-title">${esc(b.question)}</span>
        <span class="bs-book-meta">${esc(quizText)} · ${fmtDate(b.created_at)}</span>
        ${b.badge_name ? `<span class="bs-book-badge" style="border-color:${rarityColor(r)}">${esc(b.badge_name)}</span>` : ""}
      </button>`;
    }).join("") + `</div>`;

    chaptersEl.querySelectorAll(".bs-book").forEach(btn => {
      btn.onclick = () => showDetail(battles[+btn.dataset.idx]);
    });
    announce(`書架載入完成，共 ${battles.length} 場戰役`);
  } catch (e) {
    shelf.innerHTML = `<div class="state-error">
      <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤">
      <p>書架載入失敗：${esc(e.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">重試</button></div>`;
  }
}

async function showDetail(battle) {
  detail.innerHTML = `<div class="bs-detail-card"><div class="skeleton" style="height:80px"></div></div>`;
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const r = battle.badge_rarity || "普通";
    detail.innerHTML = `
    <div class="bs-detail-card">
      <button class="btn btn-ghost bs-close" id="bs-close">✕ 關閉</button>
      <h2>${esc(battle.question)}</h2>
      <p class="bs-detail-sub">完成於 ${fmtDate(battle.created_at)} · 測驗 ${battle.quiz_score ?? "—"}/${battle.quiz_total ?? "—"} · 費曼 ${battle.feynman_score ?? "—"} 分</p>

      ${battle.badge_name ? `<div class="bs-badge-card" style="border-color:${rarityColor(r)}">
        <h3>🏅 ${esc(battle.badge_name)}</h3>
        <p>稀有度 ${esc(r)}</p>
        ${battle.badge_comment ? `<p class="bs-ai-comment">「${esc(battle.badge_comment)}」</p>` : ""}
      </div>` : ""}

      <div class="bs-section"><h3>戰績</h3>
        <p>辯論 ${battle.debate_blocked ?? 0}/${battle.debate_rounds ?? 0} 輪守住</p>
      </div>

      <a class="btn btn-primary" href="quiz.html" style="width:100%;margin-top:12px">再打一場</a>
    </div>`;
    document.getElementById("bs-close").onclick = () => { detail.innerHTML = ""; };
  } catch (e) {
    detail.innerHTML = `<div class="state-error"><p>詳情載入失敗：${esc(e.message)}</p></div>`;
  }
}

renderShelf();
