/* 知識對決 —— 爐石式對戰體驗（Supabase 直連版）
 * 著陸（競技場主視覺）→ VS 畫面 → 逐題對戰 → 勝敗結算
 * 出題經 Cloudflare Worker 直連，不再經 Render 後端
 * 對決記錄存 Supabase duels 表
 * 生命週期：init → loading(skeleton) → render / empty / error
 */
import { supabase, getUser } from "../core/supabase.js";
import { isLoggedIn } from "../core/auth.js";
import { chat } from "../core/llm.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("d-view");
const ARENA_IMG = "../assets/img/game/duel-arena.webp?v=3.0.0";

let myUserId = null;
let myName = "旅人";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function skeleton(h = 160) {
  view.innerHTML = `<div class="skeleton" style="height:${h}px" aria-hidden="true"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="錯誤插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="d-retry">重試</button></div>`;
  document.getElementById("d-retry").onclick = retry;
}
function loginView() {
  view.innerHTML = `<div class="state-empty">
    <p>請先登入再發起知識對決</p>
    <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
}
function extractJsonArr(text) {
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]") + 1;
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end));
  } catch (e) {}
  return null;
}
function extractJson(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}") + 1;
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end));
  } catch (e) {}
  return null;
}

/* 共用：競技場主視覺橫幅 */
function arenaHero(subtitle) {
  return `<div style="position:relative;border-radius:16px;overflow:hidden;margin-bottom:16px;min-height:200px;
      background:linear-gradient(135deg,#160d2e 0%,#3d1f5c 60%,#6b2d7a 100%)">
    <img src="${ARENA_IMG}" alt="對決競技場" loading="lazy"
      style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"
      onerror="this.style.display='none'">
    <div style="position:relative;padding:36px 20px 28px;text-align:center;
        background:linear-gradient(180deg,rgba(12,7,26,.35) 0%,rgba(12,7,26,.88) 100%)">
      <p style="color:#ffd97a;letter-spacing:6px;font-size:12px;margin:0 0 8px">KNOWLEDGE DUEL</p>
      <h2 style="color:#fff;font-size:26px;margin:0 0 8px;text-shadow:0 2px 12px rgba(0,0,0,.6)">知識對決</h2>
      <p style="color:#e8ddf5;font-size:14px;margin:0">${subtitle}</p>
    </div>
  </div>`;
}

/* LLM 出題 */
async function generateDuelQuestions(tag) {
  const out = await chat([
    { role: "system", content:
      "你是出題助手。為知識對決生成 3 題理解型選擇題。" +
      "只輸出 JSON 陣列，每題含 question、options（4個）、answer_index（0-3）、concept（一句話概念）。" +
      "題目要有挑戰性，需要推理。全部繁體中文。" },
    { role: "user", content: `對決領域：${tag}\n請出 3 題。只回 JSON，不要其他文字。` },
  ], { temperature: 0.6, maxTokens: 1600 });

  const items = extractJsonArr(out);
  if (items && items.length) {
    return items.slice(0, 3).map(q => ({
      question: String(q.question || "").slice(0, 300),
      options: Array.isArray(q.options) ? q.options.slice(0, 4).map(o => String(o).slice(0, 100)) : [],
      answer_index: Math.min(3, Math.max(0, parseInt(q.answer_index) || 0)),
      concept: String(q.concept || "").slice(0, 100),
    })).filter(q => q.question && q.options.length === 4);
  }
  throw new Error("AI 出題失敗，請再試一次");
}

/* LLM：思考斷裂分析 */
async function analyzeThinkingGap(question, userAnswer, correctAnswer) {
  const out = await chat([
    { role: "system", content:
      "你是學習診斷師。學生答錯了一題，不要責備，而是分析他的思考路徑在哪裡斷裂。" +
      "用繁體中文，回傳 JSON：{\"thinking_path\": \"學生的思考路徑描述（80字內）\", " +
      "\"gap_point\": \"斷裂點分析（80字內）\", " +
      "\"correct_logic\": \"正確的邏輯鏈（100字內）\", " +
      "\"example_fix\": \"用具體例子說明正確理解（80字內）\"}。只回 JSON。" },
    { role: "user", content: `問題：${question}\n學生答案：${userAnswer}\n正確答案：${correctAnswer}` },
  ], { temperature: 0.4, maxTokens: 800 });
  const p = extractJson(out);
  if (p) return p;
  return {
    thinking_path: "從你的選擇來看，你可能混淆了相關概念。",
    gap_point: "關鍵概念的區分不夠清楚。",
    correct_logic: "建議回到基本定義，釐清每個選項的差異。",
    example_fix: "試著為每個選項舉一個具體例子，就能看出差別。",
  };
}

/* ---- 著陸：競技場＋選領域＋指定對手 ---- */
async function renderLanding() {
  skeleton();
  announce("載入對決資訊");

  // 我的歷史對決記錄
  let history = [];
  try {
    const { data } = await supabase
      .from("duels")
      .select("id, opponent_id, winner_id, status, created_at")
      .or(`challenger_id.eq.${myUserId},opponent_id.eq.${myUserId}`)
      .order("created_at", { ascending: false })
      .limit(5);
    history = data || [];
  } catch (e) { /* 忽略，顯示空歷史 */ }

  const histHtml = history.length
    ? `<div class="card" style="margin-bottom:16px"><h3 style="margin-top:0">最近對決</h3>` +
      history.map(h => {
        const won = h.winner_id === myUserId;
        return `<div style="padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">`
          + `<span>${won ? "🏆 勝" : h.winner_id ? "🛡 敗" : "⏳ 進行中"}</span>`
          + `<span style="color:var(--muted);margin-left:8px">${(h.created_at || "").slice(0, 10)}</span></div>`;
      }).join("") + `</div>`
    : "";

  view.innerHTML = arenaHero("在共同領域一決高下，勝者贏得星砂與榮耀") + histHtml + `
    <div class="card" style="margin-bottom:16px;border:1px solid var(--line)">
      <h2 style="margin-top:0">選擇對決領域</h2>
      <p style="color:var(--muted);font-size:13px;margin:0 0 4px">輸入一個知識領域，AI 會為你們出題</p>
      <input id="d-tag" type="text" placeholder="例如：光合作用、二次函數、世界史"
        aria-label="對決領域"
        style="width:100%;padding:14px 16px;border:1px solid var(--line);border-radius:12px;font-size:15px;margin-top:12px">
    </div>
    <div class="card" style="margin-bottom:16px">
      <h2 style="margin-top:0">指定對手</h2>
      <input id="d-opponent" type="text" placeholder="對手的暱稱"
        aria-label="對手暱稱" autocomplete="off"
        style="width:100%;padding:14px 16px;border:1px solid var(--line);border-radius:12px;font-size:15px">
      <p style="color:var(--muted);font-size:12px;margin:8px 0 0">輸入對方在曙光教育的暱稱</p>
      <button class="btn btn-primary" id="d-start"
        style="width:100%;margin-top:14px;padding:16px;font-size:18px;font-weight:800;letter-spacing:4px;
        background:linear-gradient(135deg,#b8860b,#ffd97a);border:none;color:#2a1a05;cursor:pointer">
        ⚔ 開 戰
      </button>
    </div>`;

  document.getElementById("d-start").onclick = async () => {
    const tag = document.getElementById("d-tag").value.trim();
    const oppName = document.getElementById("d-opponent").value.trim();
    if (!tag) { announce("請輸入對決領域"); return; }
    if (!oppName) { announce("請輸入對手暱稱"); return; }
    // 找對手
    try {
      const { data: opp, error } = await supabase
        .from("profiles")
        .select("id, name")
        .ilike("name", oppName)
        .neq("id", myUserId)
        .limit(1)
        .single();
      if (error || !opp) {
        announce("找不到這位對手，檢查暱稱是否正確");
        return;
      }
      startDuel(opp, tag);
    } catch (e) {
      announce("搜尋對手失敗：" + e.message);
    }
  };
  focusMain();
}

/* ---- 發起對決 → VS 畫面 ---- */
async function startDuel(opponent, tag) {
  skeleton(220);
  announce("AI 正在出題，雙方入場");
  try {
    const questions = await generateDuelQuestions(tag);
    if (!questions.length) throw new Error("AI 出題失敗");
    // 在 Supabase 建立對決記錄
    let duelId = null;
    try {
      const { data, error } = await supabase
        .from("duels")
        .insert({
          challenger_id: myUserId,
          opponent_id: opponent.id,
          status: "in_progress",
        })
        .select("id")
        .single();
      if (!error && data) duelId = data.id;
    } catch (e) { /* 記錄失敗不影響對決進行 */ }
    announce("對決成立，雙方入場");
    renderVS(duelId, opponent, tag, questions);
  } catch (e) {
    errorView(`對決發起失敗：${e.message}`, renderLanding);
  }
}

/* VS 畫面：左右雙方＋中央 VS */
function renderVS(duelId, opponent, tag, questions) {
  const fighterCard = (name, sub, side) => `
    <div style="flex:1;min-width:0;text-align:${side};padding:16px;border-radius:14px;
      background:linear-gradient(135deg,rgba(20,12,40,.92),rgba(60,30,90,.92));
      border:1px solid ${side === "left" ? "#4da3ff" : "#ff5a5a"}">
      <div style="font-size:12px;letter-spacing:3px;color:var(--muted)">
        ${side === "left" ? "挑戰者" : "應戰者"}</div>
      <div style="font-size:18px;font-weight:800;color:#fff;margin:6px 0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(name)}</div>
      <div style="font-size:13px;color:#d9cdf0">${sub}</div>
    </div>`;

  view.innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      <p style="color:#ffd97a;letter-spacing:4px;font-size:12px;margin:0 0 4px">領域 · ${escapeHtml(tag)}</p>
      <p style="color:var(--muted);font-size:13px;margin:0">共 ${questions.length} 回合</p>
    </div>
    <div style="display:flex;align-items:stretch;gap:10px;margin-bottom:20px">
      ${fighterCard(myName, "挑戰者", "left")}
      <div style="display:flex;align-items:center;justify-content:center;min-width:64px">
        <span style="font-size:38px;font-weight:900;font-style:italic;color:#ff5a5a;
          text-shadow:0 0 18px rgba(255,90,90,.55)">VS</span>
      </div>
      ${fighterCard(opponent.name || "對手", "應戰者", "right")}
    </div>
    <button class="btn btn-primary" id="d-enter"
      style="width:100%;padding:16px;font-size:17px;font-weight:800;letter-spacing:3px;
      background:linear-gradient(135deg,#b8860b,#ffd97a);border:none;color:#2a1a05;cursor:pointer">
      進入第 1 回合
    </button>`;

  document.getElementById("d-enter").onclick = () =>
    renderRound(duelId, opponent, tag, questions, 0, new Array(questions.length).fill(null));
  announce(`對決成立，${myName} 對戰 ${opponent.name}，共 ${questions.length} 回合`);
  focusMain();
}

/* ---- 逐題對戰：一題一畫面 ---- */
function renderRound(duelId, opponent, tag, questions, idx, answers) {
  const q = questions[idx];
  const total = questions.length;
  const opts = q.options || [];
  const picked = answers[idx];

  const dots = questions.map((_, i) =>
    `<span aria-hidden="true" style="display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 3px;
      background:${i < idx ? "#4caf50" : i === idx ? "#ffd97a" : "var(--line)"}"></span>`
  ).join("");

  view.innerHTML = `
    <div style="text-align:center;margin-bottom:12px" aria-label="第 ${idx + 1} 回合，共 ${total} 回合">
      <div style="margin-bottom:8px">${dots}</div>
      <p style="color:#ffd97a;letter-spacing:4px;font-size:12px;margin:0">ROUND ${idx + 1} / ${total}</p>
    </div>
    <div class="card" style="margin-bottom:16px;border:1px solid var(--line)">
      <h3 style="margin-top:0;font-size:17px;line-height:1.6">${escapeHtml(q.question || "")}</h3>
      <div role="radiogroup" aria-label="第 ${idx + 1} 回合選項" style="margin-top:12px">` +
      opts.map((opt, j) => {
        const isPicked = picked === j;
        const locked = picked !== null;
        return `<button class="q-opt" data-o="${j}" role="radio"
          aria-checked="${isPicked}" ${locked && !isPicked ? "disabled" : ""}
          aria-label="選項：${escapeHtml(String(opt))}${isPicked ? "（已選擇）" : ""}"
          style="display:flex;align-items:center;justify-content:space-between;gap:8px;
          width:100%;text-align:left;padding:15px 16px;margin-top:10px;font-size:15px;cursor:${locked ? "default" : "pointer"};
          border:2px solid ${isPicked ? "#ffd97a" : "var(--line)"};border-radius:12px;
          background:${isPicked ? "linear-gradient(135deg,#3d2b12,#5c441a)" : "var(--card)"};
          color:${isPicked ? "#ffd97a" : "inherit"};
          opacity:${locked && !isPicked ? ".55" : "1"}">
          <span>${escapeHtml(String(opt))}</span>
          ${isPicked ? `<span style="font-size:13px;font-weight:800;white-space:nowrap">✓ 已選擇</span>` : ""}
        </button>`;
      }).join("") + `</div>
    </div>
    <div style="display:flex;gap:10px">
      ${idx > 0 ? `<button class="btn btn-ghost" id="d-prev" style="padding:14px 20px">← 上一題</button>` : ""}
      <button class="btn btn-primary" id="d-next" ${picked === null ? "disabled" : ""}
        style="flex:1;padding:14px;font-size:16px;font-weight:800;letter-spacing:2px;opacity:${picked === null ? ".45" : "1"}">
        ${idx === total - 1 ? "⚔ 出招結算" : "下一題 →"}
      </button>
    </div>
    <p style="color:var(--muted);font-size:12px;text-align:center;margin-top:10px">選定後鎖定，可按「上一題」回去修改</p>`;

  view.querySelectorAll(".q-opt[data-o]:not([disabled])").forEach(btn => {
    btn.onclick = () => {
      answers[idx] = +btn.dataset.o;
      announce(`第 ${idx + 1} 回合已選擇`);
      renderRound(duelId, opponent, tag, questions, idx, answers);
    };
  });

  const prev = document.getElementById("d-prev");
  if (prev) prev.onclick = () => renderRound(duelId, opponent, tag, questions, idx - 1, answers);

  document.getElementById("d-next").onclick = async () => {
    if (answers[idx] === null) { announce("請先選擇一個答案"); return; }
    if (idx < total - 1) {
      announce(`進入第 ${idx + 2} 回合`);
      renderRound(duelId, opponent, tag, questions, idx + 1, answers);
      return;
    }
    // 最後一題 → 本地結算
    let score = 0;
    const feedback = questions.map((qq, i) => {
      const correct = answers[i] === qq.answer_index;
      if (correct) score++;
      return {
        round: i + 1,
        question: qq.question,
        correct,
        your_choice: qq.options[answers[i]] || "",
        correct_answer: qq.options[qq.answer_index] || "",
        concept_note: qq.concept || "",
      };
    });
    // 更新對決記錄
    if (duelId) {
      try {
        await supabase.from("duels").update({
          winner_id: score >= Math.ceil(total / 2) ? myUserId : opponent.id,
          status: "completed",
        }).eq("id", duelId);
      } catch (e) { /* 忽略 */ }
    }
    renderResult({ your_score: score, total, feedback }, tag);
  };
  focusMain();
}

/* ---- 結果：勝敗大字＋比分＋逐回合回顧 ---- */
function renderResult(r, tag) {
  const score = r.your_score ?? 0;
  const total = r.total ?? 0;
  const feedback = r.feedback || [];
  const win = score >= Math.ceil(total / 2);

  view.innerHTML = `
    <div style="text-align:center;border-radius:16px;padding:36px 20px;margin-bottom:20px;
      background:${win
        ? "linear-gradient(135deg,#3d2b12 0%,#6b4d1a 60%,#8a6a1f 100%)"
        : "linear-gradient(135deg,#1c1c26 0%,#2c2c3a 100%)"};
      border:2px solid ${win ? "#ffd97a" : "var(--line)"}">
      <p style="font-size:44px;margin:0 0 8px">${win ? "🏆" : "🛡"}</p>
      <h2 style="font-size:34px;margin:0 0 8px;letter-spacing:8px;
        color:${win ? "#ffd97a" : "var(--muted)"}">${win ? "勝 利" : "敗 北"}</h2>
      <p style="font-size:15px;color:${win ? "#f5e6c4" : "var(--muted)"};margin:0 0 12px">
        領域 · ${escapeHtml(tag || "")}</p>
      <p style="font-size:46px;font-weight:900;margin:0;color:#fff"
        aria-label="得分 ${score}，共 ${total} 題">${score}
        <span style="font-size:20px;color:var(--muted)">/ ${total}</span></p>
      <p style="color:#a8e6a3;font-size:13px;margin:12px 0 0">✓ 對決已結算</p>
    </div>` +
    (feedback.length ? `<h2 style="margin:0 0 12px">逐回合回顧</h2>` +
      feedback.map(fb => `
        <div class="card" style="margin-bottom:12px;
          border-left:5px solid ${fb.correct ? "#4caf50" : "#f44336"}">
          <h3 style="margin-top:0">第 ${fb.round} 回合
            <span style="color:${fb.correct ? "#4caf50" : "#f44336"}">${fb.correct ? "✅ 答對" : "❌ 答錯"}</span></h3>
          <p>你的選擇：<strong>${escapeHtml(fb.your_choice ?? "")}</strong></p>
          ${fb.correct ? "" : `<p>正確答案：<strong style="color:#4caf50">${escapeHtml(fb.correct_answer ?? "")}</strong></p>
            <button class="btn btn-ghost d-gap" data-idx="${feedback.indexOf(fb)}"
              style="font-size:12px;margin-top:8px">此念有隙 · 看思考斷裂分析</button>
            <div class="d-gap-box" style="margin-top:8px" hidden></div>`}
          ${fb.concept_note ? `<div style="margin-top:10px;padding:10px 12px;border-radius:8px;
            background:var(--card);border:1px dashed var(--line)">
            <p style="font-size:12px;color:var(--muted);margin:0 0 4px">觀念提醒</p>
            <p style="font-size:13px;margin:0">${escapeHtml(fb.concept_note)}</p></div>` : ""}
        </div>`).join("") : "") + `
    <div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn btn-primary" id="d-again" style="padding:14px 28px;font-size:16px;font-weight:800">⚔ 再戰一場</button>
      <a class="btn btn-ghost" href="bookshelf.html" style="padding:14px 20px">回書架</a>
    </div>`;

  document.getElementById("d-again").onclick = renderLanding;

  // 此念有隙：答錯時的思考斷裂分析（直連 Worker）
  view.querySelectorAll(".d-gap").forEach(btn => {
    btn.onclick = async () => {
      const fb = feedback[+btn.dataset.idx];
      const box = btn.nextElementSibling;
      btn.disabled = true; btn.textContent = "分析中…";
      try {
        const a = await analyzeThinkingGap(fb.question || "", fb.your_choice || "", fb.correct_answer || "");
        box.hidden = false;
        box.innerHTML = `
          <div style="padding:12px;background:var(--surface);border-radius:8px;font-size:13px">
            <p><strong>你的思考路徑：</strong>${escapeHtml(a.thinking_path || "")}</p>
            <p><strong>斷裂點：</strong>${escapeHtml(a.gap_point || "")}</p>
            <p><strong>正確邏輯：</strong>${escapeHtml(a.correct_logic || "")}</p>
            <p><strong>例子：</strong>${escapeHtml(a.example_fix || "")}</p>
          </div>`;
        btn.textContent = "已展開分析";
      } catch (e) {
        btn.disabled = false; btn.textContent = "此念有隙 · 看思考斷裂分析";
        announce("分析失敗：" + e.message);
      }
    };
  });
  announce(`對決結束：${win ? "勝利" : "敗北"}，得分 ${score}，共 ${total} 題`);
  focusMain();
}

/* ---- 啟動 ---- */
(async function init() {
  if (!isLoggedIn()) { loginView(); return; }
  try {
    const user = await getUser();
    if (!user) throw new Error("無法取得使用者");
    myUserId = user.id;
    const { data: profile } = await supabase
      .from("profiles").select("name").eq("id", user.id).single();
    myName = profile?.name || "旅人";
  } catch (e) {
    errorView("載入使用者資料失敗：" + e.message, () => location.reload());
    return;
  }
  renderLanding();
})();
