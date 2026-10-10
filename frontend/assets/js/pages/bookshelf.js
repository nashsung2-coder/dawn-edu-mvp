/* 我的書架：個人化課本陳列。
 * 資料來源（全真端點，零假數據）：
 * - GET /learn/textbook → 課本章節（每章 = 一本書）
 * - GET /learn/sessions/{sid} → 章節詳情（測驗題目、作答）
 * - GET /learn/mastery → 主題掌握度
 * - GET /learn/badges → 技能章
 */
import { swr, get } from "../core/api.js";
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
    const [tb, mastery] = await Promise.all([
      swr("learn:textbook", "/learn/textbook"),
      swr("learn:mastery", "/learn/mastery").catch(() => ({ data: { topics: [] } })),
    ]);
    const chapters = tb.data?.chapters || [];
    const masteryMap = Object.fromEntries((mastery.data?.topics || []).map(t => [t.topic, t]));

    if (!chapters.length) {
      shelf.innerHTML = `<div class="state-empty">
        <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空書架">
        <p>書架還是空的。去打一場費曼戰役，第一章會自動上架。</p>
        <a class="btn btn-primary" href="quiz.html">開始第一戰</a></div>`;
      return;
    }

    // 統計
    const avgMastery = chapters.length
      ? chapters.reduce((s, c) => s + (masteryMap[c.topic]?.mastery || 0), 0) / chapters.length : 0;
    stats.innerHTML = `
      <div class="bs-stat"><span class="bs-stat-n">${chapters.length}</span><span class="bs-stat-l">藏書</span></div>
      <div class="bs-stat"><span class="bs-stat-n">${Math.round(avgMastery * 100)}%</span><span class="bs-stat-l">平均掌握度</span></div>
      <div class="bs-stat"><span class="bs-stat-n">${chapters.filter(c => c.badge).length}</span><span class="bs-stat-l">技能章</span></div>`;
    userline.textContent = `共 ${chapters.length} 章`;

    // 書架陳列
    shelf.innerHTML = `<div class="bs-grid">` + chapters.map((c, i) => {
      const m = masteryMap[c.topic];
      const r = c.badge?.rarity || "普通";
      return `<button class="bs-book" data-idx="${i}" style="--rarity:${rarityColor(r)}">
        <span class="bs-book-spine"></span>
        <span class="bs-book-title">${esc(c.topic || c.question)}</span>
        <span class="bs-book-meta">${esc(c.quiz_score || "")} · ${fmtDate(c.completed_at)}</span>
        ${c.badge ? `<span class="bs-book-badge" style="border-color:${rarityColor(r)}">${esc(c.badge.name)}</span>` : ""}
        ${m ? `<span class="bs-book-mastery">掌握 ${Math.round(m.mastery * 100)}%</span>` : ""}
      </button>`;
    }).join("") + `</div>`;

    shelf.querySelectorAll(".bs-book").forEach(btn => {
      btn.onclick = () => showDetail(chapters[+btn.dataset.idx]);
    });
    announce(`書架載入完成，共 ${chapters.length} 章`);
  } catch (e) {
    shelf.innerHTML = `<div class="state-error">
      <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤">
      <p>書架載入失敗：${esc(e.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">重試</button></div>`;
  }
}

async function showDetail(chapter) {
  detail.innerHTML = `<div class="bs-detail-card"><div class="skeleton" style="height:80px"></div></div>`;
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const [sessRes, badgeRes] = await Promise.all([
      chapter.session_id ? get(`/learn/sessions/${chapter.session_id}`).catch(() => null) : null,
      swr("learn:badges", "/learn/badges").catch(() => ({ data: { badges: [] } })),
    ]);
    const sess = sessRes?.data || {};
    const badge = (badgeRes.data?.badges || []).find(b => b.session_id === chapter.session_id) || chapter.badge;

    // 測驗題目
    const quizEvents = (sess.events || []).filter(e => e.kind === "quiz");
    const questions = quizEvents.length ? quizEvents[0].payload?.questions || [] : [];

    detail.innerHTML = `
    <div class="bs-detail-card">
      <button class="btn btn-ghost bs-close" id="bs-close">✕ 關閉</button>
      <h2>${esc(chapter.topic || chapter.question)}</h2>
      <p class="bs-detail-sub">完成於 ${fmtDate(chapter.completed_at)} · 測驗 ${esc(chapter.quiz_score || "—")} · ${esc(chapter.grade_band || "")}</p>

      ${badge ? `<div class="bs-badge-card" style="border-color:${rarityColor(badge.rarity)}">
        <h3>🏅 ${esc(badge.name)}</h3>
        <p>稀有度 ${esc(badge.rarity)} · ${esc(badge.archetype || "")}</p>
        <p>攻擊 ${badge.attack ?? "—"} · 防禦 ${badge.defense ?? "—"}</p>
        ${badge.ai_comment ? `<p class="bs-ai-comment">「${esc(badge.ai_comment)}」</p>` : ""}
      </div>` : ""}

      ${chapter.ai_feedback ? `<div class="bs-section"><h3>AI 回饋</h3><p>${esc(chapter.ai_feedback)}</p></div>` : ""}

      ${questions.length ? `<div class="bs-section"><h3>測驗回顧（${questions.length} 題）</h3>` +
        questions.map((q, i) => `
          <div class="bs-q">
            <p><strong>Q${i + 1}.</strong> ${esc(q.question)}</p>
            <ul>${(q.options || []).map((opt, j) =>
              `<li class="${j === q.answer_index ? "bs-correct" : ""}">${esc(opt)}${j === q.answer_index ? " ✓" : ""}</li>`
            ).join("")}</ul>
            ${q.concept ? `<p class="bs-concept">💡 ${esc(q.concept)}</p>` : ""}
          </div>`).join("") + `</div>` : ""}

      <a class="btn btn-primary" href="quiz.html" style="width:100%;margin-top:12px">再打一場</a>
    </div>`;
    document.getElementById("bs-close").onclick = () => { detail.innerHTML = ""; };
  } catch (e) {
    detail.innerHTML = `<div class="state-error"><p>詳情載入失敗：${esc(e.message)}</p></div>`;
  }
}

renderShelf();
