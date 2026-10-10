/* ============================================================
   曙光學習宇宙：世界系前端（學習中心／寵物／島嶼／遠征／交易／週精選）
   依賴 app.js 的 $、api()、toast()、Auth、gotoTab()
   ============================================================ */
(function () {
"use strict";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function needLogin(gateId) {
  const gate = $(gateId);
  const ok = !!(Auth.user && Auth.token);
  if (gate) gate.style.display = ok ? "none" : "block";
  return ok;
}

function stars(n) {
  n = Math.max(0, Math.min(5, Math.round(n || 0)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

/* ---------------- 等待小夥伴（AI 運算中陪伴） ---------------- */
const WAITING_MSGS = [
  "再等一下下，系統正在玩命運算中",
  "AI 正在翻閱星海圖書館",
  "你的小夥伴正在催 AI 快一點",
  "正在把星砂煉成題目",
  "AI 的腦細胞正在加班",
];
let _waitTimer = null;

function stopWaiting() {
  if (_waitTimer) { clearInterval(_waitTimer); _waitTimer = null; }
}

/* 在 el 內顯示等待小夥伴；回傳 stopWaiting（完成時呼叫）。
   寵物階段：沒寵物=🥚蛋 → Lv1-2=🐣 → Lv3-4=🦊 → Lv5+=🐲
   fixedMsg：固定文案（v2：AI 等待時顯示「AI 正在尋找你的邏輯漏洞…」等） */
async function showWaiting(el, fixedMsg) {
  stopWaiting();
  let emoji = "🥚", name = "寵物蛋", isEgg = true;
  try {
    const d = await api("/api/v1/world/pet");
    if (d.pet) {
      const lv = d.pet.level || 1;
      emoji = lv >= 5 ? "🐲" : lv >= 3 ? "🦊" : "🐣";
      name = d.pet.name;
      isEgg = false;
    }
  } catch (e) { /* 未登入或失敗就顯示蛋 */ }
  let mi = 0;
  const render = () => {
    el.innerHTML =
      '<div class="waiting-companion"><div class="waiting-pet' + (isEgg ? " egg" : "") + '">' +
      emoji + '</div><div class="waiting-name">' + esc(name) + " 陪你等</div>" +
      '<div class="waiting-msg">' + esc(fixedMsg || WAITING_MSGS[mi % WAITING_MSGS.length]) +
      '<span class="waiting-dots"><span>.</span><span>.</span><span>.</span></span></div>' +
      '<div class="waiting-bar"><div class="waiting-fill"></div></div></div>';
  };
  render();
  _waitTimer = setInterval(() => { mi++; render(); }, 4000);
  return stopWaiting;
}

/* ---------------- 學習中心 ---------------- */

let battle = null; // {id, question, topic, depth_level, stage}

async function initLearn() {
  if (!needLogin("learnGate")) { $("learnBody").style.display = "none"; return; }
  $("learnBody").style.display = "";
  $("learnStartBtn").onclick = startBattle;
  loadLearnHistory();
  loadMastery();
  // v2：武器庫已搬到「我的」子頁，學習頁只留戰役紀錄＋掌握度
}

async function startBattle() {
  const q = $("learnQ").value.trim();
  if (!q) { toast("請先提出一個問題。"); return; }
  const btn = $("learnStartBtn");
  btn.disabled = true;
  try {
    const d = await api("/api/v1/learn/sessions", {
      method: "POST",
      body: JSON.stringify({
        question: q,
        grade_band: $("learnGrade").value,
        hypothesis: $("learnHyp").value.trim(),
      }),
    });
    battle = { id: d.id, question: d.question, topic: d.topic,
               depth_level: d.depth_level, stage: "reading" };
    try {
      localStorage.setItem("dawn_last_battle",
        JSON.stringify({ sid: d.id, topic: d.topic, question: q, at: Date.now() }));
    } catch (e) {}
    $("learnStart").style.display = "none";
    renderReading(d);
  } catch (e) {
    toast(e.message || "開戰失敗");
  } finally {
    btn.disabled = false;
  }
}

function battleHeader(actName) {
  return '<div class="battle-head"><span class="battle-topic">' + esc(battle.topic) +
    " · Lv" + battle.depth_level + '</span><h3 class="h3">' + esc(actName) + "</h3>" +
    '<p class="small">問題：' + esc(battle.question) + "</p></div>";
}

function renderReading(d) {
  const st = $("learnStage");
  st.style.display = "";
  st.innerHTML = battleHeader("第一幕 · 閱讀文獻") +
    '<div class="callout">' + esc(d.teaching_preview || "") + "</div>" +
    '<p class="sub">先去探究頁或外部閱讀相關內容，準備好後進入測驗（關書作答）。</p>' +
    '<div class="quiz-tip">💡 閱讀時每段問自己：「這段在講什麼？跟上一段什麼關係？」（自我解釋提示卡）</div>' +
    '<button class="btn primary" id="toQuizBtn">進入測驗</button>';
  $("toQuizBtn").onclick = loadQuiz;
}

async function loadQuiz() {
  const st = $("learnStage");
  const done = await showWaiting(st, "AI 正在翻閱星海圖書館，為你出題…（約需 1 分鐘）");
  try {
    // AI 出題慢（推理模型 50 秒～數分鐘），給足超時；失敗不清空戰役狀態
    const d = await api("/api/v1/learn/sessions/" + battle.id + "/quiz",
      { method: "POST", timeout: 360000 });
    done();
    battle.quiz = d.questions;
    let html = battleHeader("第二幕 · 穿插測驗") +
      '<p class="sub">' + esc(d.note || "關書作答") + "</p>";
    d.questions.forEach((q, i) => {
      html += '<div class="quiz-q"><p><b>Q' + (i + 1) + ".</b> " + esc(q.question) + "</p>";
      q.options.forEach((op, j) => {
        html += '<label class="quiz-opt"><input type="radio" name="q' + i + '" value="' + j + '"> ' +
          esc(op) + "</label>";
      });
      html += "</div>";
    });
    html += '<button class="btn primary" id="quizSubmit">交卷</button>';
    st.innerHTML = html;
    $("quizSubmit").onclick = submitQuiz;
  } catch (e) {
    done();
    // 失敗不清空戰役：顯示錯誤＋重試按鈕，保留返回閱讀的路
    st.innerHTML = battleHeader("第二幕 · 穿插測驗") +
      '<div class="callout">測驗生成失敗：' + esc(e.message || "連線超時") + '。</div>' +
      '<p class="sub">AI 出題需要一點時間（約 1 分鐘）。戰役還在，不用重來。</p>' +
      '<div class="qa-box"><button class="btn primary" id="quizRetry">重試出題</button>' +
      '<button class="btn" id="quizBack">回閱讀</button></div>';
    $("quizRetry").onclick = loadQuiz;
    $("quizBack").onclick = () => renderReading({});
  }
}

async function submitQuiz() {
  const answers = battle.quiz.map((_, i) => {
    const el = document.querySelector('input[name="q' + i + '"]:checked');
    return el ? parseInt(el.value, 10) : -1;
  });
  try {
    const d = await api("/api/v1/learn/sessions/" + battle.id + "/quiz/answers", {
      method: "POST", body: JSON.stringify({ answers }),
    });
    let html = battleHeader("測驗結果") +
      '<p>答對 <b>' + d.correct_count + " / " + d.total + "</b> · 主題掌握度 " +
      Math.round(d.mastery * 100) + "%" + (d.mastered ? " 🎓 已精通！" : "") + "</p>";
    d.results.forEach((r, i) => {
      if (!r.correct && r.concept) {
        html += '<div class="callout">Q' + (i + 1) + "：" + esc(r.concept) + "</div>";
      }
    });
    html += '<button class="btn primary" id="toFeynmanBtn">進入費曼解釋</button>';
    $("learnStage").innerHTML = html;
    $("toFeynmanBtn").onclick = renderFeynman;
  } catch (e) {
    toast(e.message || "交卷失敗");
  }
}

/* ---------------- 費曼辯論場（v2：動態 1–3 輪對決 HUD） ----------------
   流程：解釋 → debate/start → 全螢幕 modal → 多輪挑戰／反駁 → 授勳。
   舊 /feynman 端點不再使用（後端保留）。 */

let DBT = null; // {sid, round, challenge, suspicion, judgeNote, lastText, appealUsed, timerId, open, done}

function openDebateModal() {
  $("debateModal").classList.add("show");
  $("debateModal").setAttribute("aria-hidden", "false");
}

function stopDebateTimer() {
  if (DBT && DBT.timerId) { clearInterval(DBT.timerId); DBT.timerId = null; }
}

function closeDebateModal() {
  if (DBT && DBT.open && !DBT.done) {
    if (!confirm("辯論還沒結束，確定要離開嗎？\n（想結算可以按「暫停挑戰」拿參與獎）")) return;
  }
  stopDebateTimer();
  $("debateModal").classList.remove("show");
  $("debateModal").setAttribute("aria-hidden", "true");
  DBT = null;
}

function renderFeynman() {
  const st = $("learnStage");
  st.innerHTML = battleHeader("第三幕 · 費曼解釋") +
    '<div class="quiz-tip">關書時間——憑記憶講，不准偷看。這是效應最強的一幕。</div>' +
    '<p class="sub">用自己的話把整個概念講清楚。AI 怪獸會找出你最強的漏洞，向你宣戰：</p>' +
    '<textarea id="feynmanText" class="input" rows="6" maxlength="2000" ' +
    'placeholder="想像你在教一個聰明但挑剔的朋友…"></textarea>' +
    '<button class="btn primary" id="feynmanSubmit">向 AI 怪獸宣戰</button>' +
    '<div id="feynmanResp"></div>';
  $("feynmanSubmit").onclick = startDebate;
}

async function startDebate() {
  const text = $("feynmanText").value.trim();
  if (text.length < 15) { toast("再多講一點，至少 15 個字，讓 AI 看得出你的思路。"); return; }
  const btn = $("feynmanSubmit");
  btn.disabled = true;
  const done = await showWaiting($("feynmanResp"), "AI 怪獸正在磨刀霍霍…");
  try {
    const r = await api("/api/v1/learn/sessions/" + battle.id + "/debate/start", {
      method: "POST", body: JSON.stringify({ explanation: text }), timeout: 90000,
    });
    done();
    if (r.taunt) {
      $("feynmanResp").innerHTML = '<div class="callout"><b>AI 怪獸</b><br>' + esc(r.taunt) +
        '<br><span class="small">本輪不計分——用自己的話再講一次。</span></div>';
      return;
    }
    DBT = { sid: battle.id, round: 1, challenge: r.challenge, suspicion: r.suspicion,
            judgeNote: "", lastText: "", appealUsed: false, timerId: null,
            open: true, done: false };
    openDebateModal();
    if (r.perfect) {
      showDebateAward(r.finish, {
        title: "完美通關！",
        sub: (r.verdict_text || "AI 怪獸找不到任何漏洞") + "——直接認輸，爆擊獎勵入手。",
      });
    } else {
      renderDebateRound();
    }
  } catch (e) {
    done();
    toast(e.message || "開戰失敗");
  } finally {
    btn.disabled = false;
  }
}

/* ---- HUD 元件 ---- */

function debateHpHTML(s) {
  const def = Math.round((s.avg || 0) * 100);
  const aiv = 100 - def;
  return '<div class="debate-hp">' +
    '<div class="hp-row"><span>你 · 論點防禦</span><div class="hp-bar"><i id="debateMeHp" style="width:' +
    def + '%"></i></div><b>' + def + "</b></div>" +
    '<div class="hp-row"><span>AI 怪獸 · 懷疑值</span><div class="hp-bar opp"><i id="debateAiHp" style="width:' +
    aiv + '%"></i></div><b>' + aiv + "</b></div></div>";
}

function suspicionHTML(s) {
  const pct = (v) => Math.round((v || 0) * 100) + "%";
  const ico = s.state === "完美防禦" ? "●" : s.state === "逐漸穩固" ? "◐" : "○";
  const dim = (label, v) =>
    '<div class="sdim">' + label + '<div class="cap-track"><div class="cap-fill" style="width:' +
    pct(v) + '"></div></div></div>';
  return '<div class="suspicion-box">' +
    '<div class="suspicion-head"><span class="suspicion-badge"><span class="s-ico">' + ico +
    "</span>AI 懷疑度：" + esc(s.state) + "</span>" +
    '<span class="suspicion-note">' + esc(s.note || "即時估計，非考試分數") + "</span></div>" +
    '<div class="suspicion-dims">' +
    dim("論點清晰度", s.clarity) + dim("舉例適切性", s.examples) + dim("邏輯嚴密性", s.logic) +
    "</div></div>";
}

/* 字元集重疊率（鏡像後端 _overlap_ratio）：偵測整段貼上 */
function charOverlap(src, text) {
  const clean = (s) => String(s || "").replace(/[\s，。！？、；：「」『』（）,.!?;:"'()\-]/g, "");
  const a = new Set(clean(src));
  if (!a.size) return 0;
  const b = new Set(clean(text));
  let hit = 0;
  a.forEach((c) => { if (b.has(c)) hit++; });
  return hit / a.size;
}

function startDebateTimer() {
  stopDebateTimer();
  let left = 90;
  const tick = () => {
    const e = $("debateTimer");
    if (!e) { stopDebateTimer(); return; }
    e.textContent = left + "s";
    e.classList.toggle("warn", left <= 15);
    if (left <= 0) {
      stopDebateTimer();
      toast("時間到！自動送出。");
      submitDebate();
      return;
    }
    left--;
  };
  tick();
  DBT.timerId = setInterval(tick, 1000);
}

function renderDebateRound() {
  const d = DBT;
  $("debateBody").innerHTML =
    '<div class="debate-title">費曼辯論 <span class="vs">VS</span> AI 怪獸</div>' +
    '<div class="debate-round">第 ' + d.round + " 輪" + (d.round >= 3 ? " · 終局" : "") + "</div>" +
    debateHpHTML(d.suspicion) + suspicionHTML(d.suspicion) +
    '<div class="challenge-card"><div class="ck">AI 怪獸的挑戰</div><p>' + esc(d.challenge) + "</p></div>" +
    (d.judgeNote ? '<div class="judge-note"><b>上一輪評判：</b>' + esc(d.judgeNote) + "</div>" : "") +
    '<div class="debate-input-zone">' +
    '<textarea id="debateText" class="input" rows="5" maxlength="150" ' +
    'placeholder="用自己的話反駁或補強（150 字內，90 秒）…"></textarea>' +
    '<div class="debate-meta-row"><span id="debateCount">0 / 150</span>' +
    '<span>⏱ <span class="debate-timer" id="debateTimer">90s</span></span></div>' +
    '<div class="paste-warn" id="pasteWarn">用自己的話說說看，別整段貼上——貼上的內容不計分。</div>' +
    '<div class="debate-actions">' +
    '<button class="btn primary" id="debateSubmit" disabled>出招反駁</button>' +
    '<button class="btn" id="debateConcede">暫停挑戰</button>' +
    "</div></div>";
  const ta = $("debateText"), submitBtn = $("debateSubmit");
  ta.addEventListener("input", () => {
    const n = ta.value.trim().length;
    $("debateCount").textContent = ta.value.length + " / 150";
    submitBtn.disabled = n < 15;
  });
  ta.addEventListener("paste", () => {
    setTimeout(() => {
      const sim = charOverlap(battle.question + " " + (DBT.challenge || ""), ta.value);
      if (sim > 0.8 && ta.value.trim().length >= 10)
        $("pasteWarn").classList.add("show");
    }, 0);
  });
  submitBtn.onclick = submitDebate;
  $("debateConcede").onclick = concedeDebate;
  startDebateTimer();
  setTimeout(() => ta.focus(), 100);
}

async function submitDebate() {
  const ta = $("debateText");
  if (!ta) return;
  const text = ta.value.trim();
  if (text.length < 15) { toast("至少 15 個字，讓 AI 看得出你的思路。"); return; }
  stopDebateTimer();
  const done = await showWaiting($("debateBody"), "AI 正在尋找你的邏輯漏洞…");
  try {
    const r = await api("/api/v1/learn/sessions/" + DBT.sid + "/debate/respond", {
      method: "POST", body: JSON.stringify({ text }), timeout: 90000,
    });
    done();
    handleDebateResponse(r, text);
  } catch (e) {
    done();
    toast(e.message || "送出失敗");
    startDebateTimer();
  }
}

function handleDebateResponse(r, text) {
  if (r.taunt) {
    $("debateBody").innerHTML =
      '<div class="verdict-flash"><div class="verdict-big">被看穿了</div>' +
      '<div class="verdict-sub">' + esc(r.taunt) + "<br>本輪不計分。</div></div>" +
      '<div class="debate-actions"><button class="btn primary" id="debateRetry">用自己的話重講</button>' +
      '<button class="btn" id="debateConcede3">暫停挑戰</button></div>';
    $("debateRetry").onclick = renderDebateRound;
    $("debateConcede3").onclick = concedeDebate;
    return;
  }
  if (r.perfect || (r.verdict && r.finish)) {
    showDebateAward(r.finish, {
      title: r.verdict_text || "完美通關！",
      sub: r.judge_note || "",
    });
    return;
  }
  showDebateVerdict(r, text);
}

function showDebateVerdict(r, text) {
  DBT.lastText = text;
  DBT.appealUsed = false;
  const v = r.verdict;
  const big = v === "blocked" ? "破綻！" : v === "partial" ? "還差一點" : "被閃開了";
  let html =
    '<div class="debate-title">費曼辯論 <span class="vs">VS</span> AI 怪獸</div>' +
    '<div class="verdict-flash' + (v === "blocked" ? " blocked" : "") + '">' +
    '<div class="verdict-big">' + big + "</div>" +
    '<div class="verdict-sub">' + esc(r.judge_note || "") +
    (r.hint ? "<br>" + esc(r.hint) : "") + "</div></div>" +
    suspicionHTML(r.suspicion) +
    '<div class="debate-actions">';
  if (v === "blocked" && r.next_round) {
    html += '<button class="btn primary" id="debateDeep">深入追擊（R3 終局）</button>';
  } else if (r.challenge) {
    html += '<button class="btn primary" id="debateNext">迎接下一輪挑戰</button>';
  }
  if (v === "evaded" || v === "partial")
    html += '<button class="btn" id="debateAppeal">申訴一次</button>';
  html += '<button class="btn" id="debateConcede2">暫停挑戰</button></div>';
  $("debateBody").innerHTML = html;
  const deep = $("debateDeep"), next = $("debateNext"),
        appeal = $("debateAppeal"), conc = $("debateConcede2");
  if (deep) deep.onclick = () => {
    DBT.round = r.next_round || 3;
    DBT.suspicion = r.suspicion;
    DBT.judgeNote = r.judge_note || "";
    DBT.challenge = "終局陳述——AI 已總結雙方論點，用最後一段話為你的論點一錘定音。";
    renderDebateRound();
  };
  if (next) next.onclick = () => {
    DBT.round = r.round;
    DBT.challenge = r.challenge;
    DBT.suspicion = r.suspicion;
    DBT.judgeNote = r.judge_note || "";
    renderDebateRound();
  };
  if (appeal) appeal.onclick = appealDebate;
  if (conc) conc.onclick = concedeDebate;
}

/* 申訴：每輪限 1 次，後端重判上一輪。 */
async function appealDebate() {
  if (DBT.appealUsed) { toast("本輪申訴已用過。"); return; }
  DBT.appealUsed = true;
  const btn = $("debateAppeal");
  if (btn) btn.disabled = true;
  const done = await showWaiting($("debateBody"), "AI 正在重新審視你的論點…");
  try {
    const r = await api("/api/v1/learn/sessions/" + DBT.sid + "/debate/appeal", {
      method: "POST", timeout: 90000,
    });
    done();
    handleDebateResponse(r, DBT.lastText);
  } catch (e) {
    done();
    toast(e.message || "申訴失敗");
  }
}

async function concedeDebate() {
  if (!confirm("暫停挑戰並結算參與獎？\n費曼的核心是發現盲點，不是輸贏。")) return;
  stopDebateTimer();
  const done = await showWaiting($("debateBody"), "正在結算戰果…");
  try {
    const r = await api("/api/v1/learn/sessions/" + DBT.sid + "/debate/concede", {
      method: "POST", timeout: 60000,
    });
    done();
    showDebateAward(r.finish, {
      title: "暫停挑戰",
      sub: r.note + (r.award_starsand ? " 參與獎：星砂 +" + r.award_starsand + "。" : "") +
        (r.reward_capped ? "（今日同主題獎勵已達上限，這次只給回饋不給分。）" : ""),
    });
  } catch (e) {
    done();
    toast(e.message || "暫停失敗");
  }
}

function showDebateAward(fin, info) {
  DBT.done = true;
  const b = fin.badge;
  let html = '<div class="debate-award">' +
    '<div class="award-title">' + esc(info.title) + "</div>" +
    (info.sub ? '<p class="verdict-sub">' + esc(info.sub) + "</p>" : "") +
    '<div class="badge-card"><div class="badge-name">' + esc(b.name) + "</div>" +
    '<div class="small">' + esc(b.rarity) + " · 攻擊 " + b.attack + " · 防禦 " + b.defense +
    " · 默契 " + Math.round((b.bond || 0) * 100) + "%</div>" +
    (b.archetype ? '<div class="small">主分類：' + esc(b.archetype) +
      ((b.tags || []).length ? " · " + b.tags.map(esc).join("／") : "") + "</div>" : "") +
    (b.ai_comment ? '<div class="small">「' + esc(b.ai_comment) + "」</div>" : "") + "</div>";
  if (fin.pet) {
    html += fin.pet.hatched
      ? '<div class="callout">寵物孵化了！去島嶼頁看看你的新夥伴。</div>'
      : '<div class="callout">寵物獲得經驗，變強了！</div>';
  }
  html += '<div class="debate-actions"><button class="btn primary" id="debateAgain">再來一場</button>' +
    '<button class="btn" id="debateNameIsland">為這次命名一座島嶼</button></div></div>';
  $("debateBody").innerHTML = html;
  $("debateAgain").onclick = () => {
    closeDebateModal();
    resetBattle();
  };
  $("debateNameIsland").onclick = async () => {
    const nm = prompt("為這座島嶼命名：", battle.topic + "島");
    if (!nm) return;
    try {
      await api("/api/v1/world/islands", {
        method: "POST",
        body: JSON.stringify({ session_id: battle.id, name: nm.trim(), topic: battle.topic }),
      });
      toast("島嶼命名完成！去島嶼頁看看吧。");
    } catch (e) { toast(e.message || "命名失敗"); }
  };
  loadLearnHistory();
  loadMastery();
  if ($("page-armory") && $("page-armory").classList.contains("active")) initArmory();
}

function resetBattle() {
  battle = null;
  $("learnStage").style.display = "none";
  $("learnStage").innerHTML = "";
  $("learnStart").style.display = "";
  $("learnQ").value = ""; $("learnHyp").value = "";
  loadLearnHistory();
  loadMastery();
}

/* 斷點續戰：從任務板或戰役紀錄回到未完成的戰役 */
async function resumeBattle(sid) {
  if (!sid) { gotoTab("learn"); return; }
  gotoTab("learn");
  const st = $("learnStage");
  st.style.display = "";
  st.innerHTML = '<p class="small">正在找回戰役…</p>';
  try {
    const s = await api("/api/v1/learn/sessions/" + sid);
    if (s.status === "done") {
      st.innerHTML = '<div class="callout">這場戰役已經結束了，開一場新的吧。</div>';
      $("learnStart").style.display = "";
      try { localStorage.removeItem("dawn_last_battle"); } catch (e) {}
      loadLearnHistory();
      return;
    }
    battle = { id: s.id, question: s.question, topic: s.topic,
               depth_level: s.depth_level, stage: s.status };
    $("learnStart").style.display = "none";
    if (s.status === "quiz") loadQuiz();
    else if (s.status === "feynman" || s.status === "debate") renderFeynman();
    else renderReading({});
  } catch (e) {
    st.innerHTML = '<div class="callout">找回戰役失敗：' + esc(e.message || "連線問題") +
      '。</div><button class="btn" id="resumeBack">回學習頁</button>';
    $("resumeBack").onclick = () => { st.style.display = "none"; $("learnStart").style.display = ""; };
  }
}

async function loadLearnHistory() {
  const el = $("learnHistory");
  try {
    const d = await api("/api/v1/learn/sessions?limit=10");
    if (!d.sessions.length) { el.innerHTML = '<p class="small">還沒有戰役紀錄。</p>'; return; }
    el.innerHTML = '<ul class="book-list">' + d.sessions.map((s) =>
      s.status === "done"
        ? "<li>" + esc(s.question) + ' <span class="small">（' + esc(s.topic) +
          " Lv" + s.depth_level + " · 已完成）</span></li>"
        : '<li><button class="link-btn" data-resume="' + esc(s.id) + '">' + esc(s.question) +
          '</button> <span class="small">（' + esc(s.topic) +
          " Lv" + s.depth_level + " · " + esc(s.status) + "，點我繼續）</span></li>"
    ).join("") + "</ul>";
    el.querySelectorAll("[data-resume]").forEach((b) => {
      b.onclick = () => resumeBattle(b.dataset.resume);
    });
  } catch (e) { el.innerHTML = ""; }
}

async function loadMastery() {
  const el = $("learnMastery");
  try {
    const d = await api("/api/v1/learn/mastery");
    if (!d.topics.length) { el.innerHTML = '<p class="small">完成戰役後，這裡會顯示各主題掌握度。</p>'; return; }
    el.innerHTML = d.topics.map((t) =>
      '<div class="mastery-row"><span>' + esc(t.topic) + '</span><div class="cap-track">' +
      '<div class="cap-fill" style="width:' + Math.round(t.mastery * 100) + '%"></div></div>' +
      '<span class="small">' + Math.round(t.mastery * 100) + "% · " + t.sessions_count + " 場</span></div>"
    ).join("");
  } catch (e) { el.innerHTML = ""; }
}

/* v2：武器庫搬到「我的」子頁（page-armory），卡片邊框色＝主分類 */
async function initArmory() {
  await loadBadges();
}

async function loadBadges() {
  const el = $("armoryBadges");
  if (!el) return;
  if (!Auth.user) { el.innerHTML = '<p class="small">登入後查看你的武器庫。</p>'; return; }
  try {
    const d = await api("/api/v1/learn/badges");
    if (!d.badges.length) {
      el.innerHTML = '<p class="small">完成戰役可鍛造技能章（武器）。</p>';
      return;
    }
    el.innerHTML = '<div class="armory-grid">' + d.badges.map((b) =>
      '<div class="armory-card arch-' + esc(b.archetype || "") + '">' +
      '<div class="badge-name">' + esc(b.name) + "</div>" +
      '<div class="small">' + esc(b.rarity || "") + " · 攻 " + b.attack + " · 防 " + b.defense +
      " · 默契 " + Math.round((b.bond || 0) * 100) + "%</div>" +
      (b.archetype ? '<div class="small">主分類：' + esc(b.archetype) + "</div>" : "") +
      ((b.tags || []).length
        ? '<div class="tag-pills">' + b.tags.map((t) =>
          '<span class="tag-pill">' + esc(t) + "</span>").join("") + "</div>"
        : "") +
      "</div>"
    ).join("") + "</div>";
  } catch (e) { el.innerHTML = ""; }
}

/* ---------------- 寵物（島嶼頁） ---------------- */

async function loadPet() {
  const body = $("petBody");
  if (!needLogin("petGate")) { body.innerHTML = ""; return; }
  try {
    const d = await api("/api/v1/world/pet");
    const p = d.pet;
    if (!p) {
      body.innerHTML = '<p class="small">完成第一場費曼戰役，寵物蛋就會孵化。🐣</p>';
      return;
    }
    const pct = Math.round((p.exp / (p.level * 100)) * 100);
    body.innerHTML =
      '<div class="pet-card"><div class="pet-emoji">🐾</div>' +
      '<div><b>' + esc(p.name) + '</b> <span class="small">（' + esc(p.species) + "）</span></div>" +
      '<div class="small">Lv.' + p.level + " · 心情 " + p.mood + "%</div>" +
      '<div class="cap-track"><div class="cap-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="acct-form" style="margin-top:8px"><input id="petRename" class="input" maxlength="12" placeholder="改名">' +
      '<button class="btn" id="petRenameBtn">改名</button></div></div>';
    $("petRenameBtn").onclick = async () => {
      const nm = $("petRename").value.trim();
      if (!nm) return;
      try {
        await api("/api/v1/world/pet/rename", {
          method: "POST", body: JSON.stringify({ name: nm, species: "" }),
        });
        toast("改名完成！");
        loadPet();
      } catch (e) { toast(e.message || "改名失敗"); }
    };
  } catch (e) { body.innerHTML = ""; }
}

/* ---------------- 學習島嶼與建築（島嶼頁） ---------------- */

const BTYPES = ["圖書館", "訓練場", "瞭望塔"];

async function loadLearnIslands() {
  const el = $("learnIslands");
  if (!Auth.user) { el.innerHTML = ""; return; }
  try {
    const d = await api("/api/v1/world/islands");
    if (!d.islands.length) {
      el.innerHTML = '<p class="small">完成戰役後，在此命名你的第一座島嶼。</p>';
      return;
    }
    el.innerHTML = d.islands.map((isl) => {
      const blds = (isl.buildings || []).map((b) => esc(b.btype) + " Lv" + b.level).join("、") || "尚未建設";
      return '<div class="panel island-card"><b>🏝️ ' + esc(isl.name) + '</b> <span class="small">（' +
        esc(isl.topic) + "）</span>" +
        '<div class="small">建築：' + blds + "</div>" +
        '<div class="build-btns">' + BTYPES.map((t) =>
          '<button class="btn sm" data-isl="' + isl.id + '" data-bt="' + t + '">蓋' + t + "</button>"
        ).join("") + "</div></div>";
    }).join("");
    el.querySelectorAll("button[data-isl]").forEach((btn) => {
      btn.onclick = async () => {
        try {
          const r = await api("/api/v1/world/build", {
            method: "POST",
            body: JSON.stringify({ island_id: btn.dataset.isl, btype: btn.dataset.bt }),
          });
          toast(r.btype + " Lv" + r.level + "！" + r.desc);
          loadLearnIslands();
        } catch (e) { toast(e.message || "建築失敗"); }
      };
    });
  } catch (e) { el.innerHTML = ""; }
}

/* ---------------- 遠征 ---------------- */

let journeyState = null;

async function initJourney() {
  if (!needLogin("journeyGate")) { $("journeyBody").innerHTML = ""; return; }
  const body = $("journeyBody");
  try {
    const d = await api("/api/v1/world/zones");
    body.innerHTML = '<div class="zone-grid">' + d.zones.map((z) =>
      '<div class="panel zone-card"><b>🗺️ ' + esc(z.name) + "</b>" +
      '<p class="small">' + esc(z.desc) + "</p>" +
      '<button class="btn primary sm" data-zone="' + esc(z.name) + '">出發</button></div>'
    ).join("") + "</div><div id='journeyStage'></div>";
    body.querySelectorAll("button[data-zone]").forEach((b) => {
      b.onclick = () => startJourney(b.dataset.zone);
    });
  } catch (e) { body.innerHTML = ""; }
  loadJourneyHistory();
}

async function startJourney(zone) {
  try {
    const d = await api("/api/v1/world/explore", {
      method: "POST", body: JSON.stringify({ zone }),
    });
    journeyState = d;
    renderJourneyStage();
  } catch (e) { toast(e.message || "出發失敗"); }
}

function renderJourneyStage() {
  const el = $("journeyStage");
  if (!journeyState) return;
  const cur = journeyState.current;
  if (!cur) { el.innerHTML = ""; return; }
  el.innerHTML = '<div class="panel story-panel"><h4 class="h3">' +
    esc(journeyState.zone) + " · " + esc(cur.title) + "</h4>" +
    '<p>' + esc(cur.text) + "</p>" +
    cur.choices.map((c, i) =>
      '<button class="btn story-choice" data-i="' + i + '">' + esc(c) + "</button>"
    ).join("") + "</div>";
  el.querySelectorAll("button[data-i]").forEach((b) => {
    b.onclick = () => chooseJourney(parseInt(b.dataset.i, 10));
  });
}

async function chooseJourney(i) {
  try {
    const d = await api("/api/v1/world/explore/" + journeyState.id + "/choose", {
      method: "POST", body: JSON.stringify({ choice_index: i }),
    });
    let html = '<div class="callout">💡 ' + esc(d.hint) + "</div>";
    if (d.done) {
      html += '<div class="callout">🎉 遠征完成！星砂 +' + (d.reward.starsand || 0) + "</div>";
      journeyState = null;
      loadJourneyHistory();
    } else {
      journeyState.stage += 1;
      const full = await api("/api/v1/world/explore/" + journeyState.id);
      journeyState = full;
    }
    $("journeyStage").innerHTML = html;
    if (journeyState) renderJourneyStageAppend();
  } catch (e) { toast(e.message || "選擇失敗"); }
}

function renderJourneyStageAppend() {
  const cur = journeyState.current;
  if (!cur) return;
  const el = $("journeyStage");
  el.innerHTML += '<div class="panel story-panel"><h4 class="h3">' +
    esc(cur.title) + "</h4><p>" + esc(cur.text) + "</p>" +
    cur.choices.map((c, i) =>
      '<button class="btn story-choice" data-i="' + i + '">' + esc(c) + "</button>"
    ).join("") + "</div>";
  el.querySelectorAll("button[data-i]").forEach((b) => {
    b.onclick = () => chooseJourney(parseInt(b.dataset.i, 10));
  });
}

async function loadJourneyHistory() {
  const el = $("journeyHistory");
  try {
    const d = await api("/api/v1/world/explore");
    if (!d.explorations.length) { el.innerHTML = '<p class="small">還沒有遠征紀錄。</p>'; return; }
    el.innerHTML = '<ul class="book-list">' + d.explorations.map((e) =>
      "<li>" + esc(e.zone) + ' <span class="small">（' + esc(e.status) + "）</span></li>"
    ).join("") + "</ul>";
  } catch (e) { el.innerHTML = ""; }
}

/* ---------------- 交易市集 ---------------- */

/* ---------------- 交易市集 v2：主分類＋標籤＋卡牌化 ---------------- */

let marketCat = ""; // "" | 攻擊型 | 防禦型 | 輔助型 | 經濟型

async function initMarket() {
  if (!needLogin("marketGate")) { $("marketBody").innerHTML = ""; return; }
  const chips = $("marketChips");
  if (chips && !chips.dataset.wired) {
    chips.dataset.wired = "1";
    chips.querySelectorAll("button[data-cat]").forEach((c) => {
      c.onclick = () => {
        chips.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        c.classList.add("active");
        marketCat = c.dataset.cat;
        loadMarket();
      };
    });
  }
  await loadMarket();
  await renderPublish();
}

async function loadMarket() {
  const el = $("marketBody");
  const q = marketCat ? "?category=" + encodeURIComponent(marketCat) : "";
  try {
    const d = await api("/api/v1/world/market" + q);
    if (!d.listings.length) { await renderMarketEmpty(el); return; }
    el.innerHTML = d.listings.map((l) => {
      const arch = l.archetype || "";
      const kind = l.item_type === "badge" ? "武器" : "島嶼";
      const tags = (l.tags || []).map((t) =>
        '<span class="tag-pill">' + esc(t) + "</span>").join("");
      return '<div class="stall-card arch-' + esc(arch) + '" data-lid="' + l.id + '">' +
        '<div class="stall-head"><span class="stall-kind">' + kind + "</span>" +
        (arch ? '<span class="arch-tag">' + esc(arch) + "</span>" : "") +
        '<span class="stall-price">' +
        (l.trade_kind === "sell" ? "星砂 " + l.price : "以物易物") + "</span></div>" +
        (l.trade_kind === "barter" && l.want_text
          ? '<div class="small">想換：' + esc(l.want_text) + "</div>" : "") +
        (tags ? '<div class="tag-pills">' + tags + "</div>" : "") +
        '<div class="stall-foot"><span class="small">點擊查看對比</span>' +
        (l.trade_kind === "sell"
          ? '<button class="btn sm primary" data-buy="' + l.id + '">購買</button>'
          : '<button class="btn sm" disabled>僅以物易物</button>') +
        "</div></div>";
    }).join("");
    el.querySelectorAll(".stall-card").forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest("button")) return;
        const l = d.listings.find((x) => x.id === card.dataset.lid);
        if (l) openCompare(l);
      };
    });
    el.querySelectorAll("button[data-buy]").forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        try {
          const r = await api("/api/v1/world/market/" + b.dataset.buy + "/buy", { method: "POST" });
          toast("購入成功！" + (r.note || ""));
          loadMarket();
        } catch (e2) { toast(e2.message || "購買失敗"); }
      };
    });
  } catch (e) { el.innerHTML = ""; }
}

/* 空狀態三層：①系統現貨 → ②合成推薦 → ③UGC 上架 */
async function renderMarketEmpty(el) {
  let reco = "多打幾場費曼戰役，鍛造武器後再來上架。";
  try {
    const d = await api("/api/v1/learn/badges");
    const counts = { "攻擊型": 0, "防禦型": 0, "輔助型": 0, "經濟型": 0 };
    d.badges.forEach((b) => {
      if (counts[b.archetype] !== undefined) counts[b.archetype]++;
    });
    const weakest = Object.keys(counts).sort((a, b) => counts[a] - counts[b])[0];
    reco = "你的武器庫裡「" + weakest + "」最少（" + counts[weakest] +
      " 件）——多打幾場費曼戰役，鍛造「" + weakest + "」武器再來上架。";
  } catch (e) { /* 用預設文案 */ }
  el.innerHTML =
    '<div class="empty-layer"><div class="el-kicker">第一層 · 系統現貨</div>' +
    "<h4>市集今晚打烊了</h4>" +
    "<p>還沒有其他旅人上架物品。別空手而回——試煉場雷達頁的兵器庫有系統現貨，星砂可以直接換武器。</p>" +
    '<button class="btn primary" id="emptyShop">去兵器庫看看</button></div>' +
    '<div class="empty-layer"><div class="el-kicker">第二層 · 合成推薦</div>' +
    "<h4>先鍛造，再交易</h4><p>" + esc(reco) + "</p>" +
    '<button class="btn" id="emptyBattle">去打一場戰役</button></div>' +
    '<div class="empty-layer"><div class="el-kicker">第三層 · 開張大吉</div>' +
    "<h4>成為第一個上架的人</h4>" +
    "<p>把你鍛造的武器或命名的島嶼掛上來，定個好價錢——市集的第一筆交易可能就是你的。</p>" +
    '<button class="btn" id="emptyPublish">上架我的物品</button></div>';
  $("emptyShop").onclick = () => gotoTab("radar");
  $("emptyBattle").onclick = () => gotoTab("learn");
  $("emptyPublish").onclick = () =>
    $("marketPublish").scrollIntoView({ behavior: "smooth", block: "center" });
}

/* 對比浮窗：賣家物品 vs 你的同 archetype 最佳 */
function cmpArrow(theirs, mine) {
  if (mine == null || theirs == null) return "";
  if (theirs > mine) return ' <span class="cmp-up">↑</span>';
  if (theirs < mine) return ' <span class="cmp-dn">↓</span>';
  return ' <span class="cmp-eq">＝</span>';
}
async function openCompare(l) {
  const modal = $("compareModal"), body = $("compareBody");
  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  body.innerHTML = '<p class="small">載入對比中…</p>';
  let mine = null;
  try {
    const d = await api("/api/v1/learn/badges");
    const same = d.badges.filter((b) => b.archetype === l.archetype);
    if (same.length) {
      mine = same.sort((a, b) =>
        (b.attack + b.defense + (b.bond || 0) * 100) -
        (a.attack + a.defense + (a.bond || 0) * 100))[0];
    }
  } catch (e) { /* 無武器庫也照常顯示賣家資訊 */ }
  const arch = l.archetype || "未分類";
  body.innerHTML =
    '<h3 class="h3" style="margin-bottom:4px">武器對比</h3>' +
    '<p class="small">賣家物品 vs 你的同類型最佳</p>' +
    '<div class="compare-cols">' +
    '<div class="compare-col"><h4>賣家物品</h4>' +
    '<div class="compare-stat"><span>類型</span><b>' +
    (l.item_type === "badge" ? "武器" : "島嶼") + "</b></div>" +
    '<div class="compare-stat"><span>主分類</span><b>' + esc(arch) + "</b></div>" +
    '<div class="compare-stat"><span>標籤</span><b>' +
    ((l.tags || []).map(esc).join("／") || "—") + "</b></div>" +
    '<div class="compare-stat"><span>價格</span><b>' +
    (l.trade_kind === "sell" ? "星砂 " + l.price : esc(l.want_text || "以物易物")) +
    "</b></div>" +
    '<div class="compare-stat"><span>攻擊</span><b>' +
    (l.snap_attack != null ? l.snap_attack + cmpArrow(l.snap_attack, mine && mine.attack) : "—") +
    "</b></div>" +
    '<div class="compare-stat"><span>防禦</span><b>' +
    (l.snap_defense != null ? l.snap_defense + cmpArrow(l.snap_defense, mine && mine.defense) : "—") +
    "</b></div>" +
    '<div class="compare-stat"><span>默契潛力</span><b>' +
    (l.snap_bond != null ? Math.round(l.snap_bond * 100) + "%" : "—") + "</b></div>" +
    "</div>" +
    '<div class="compare-col mine"><h4>你的同類型最佳</h4>' +
    (mine
      ? '<div class="compare-stat"><span>名稱</span><b>' + esc(mine.name) + "</b></div>" +
        '<div class="compare-stat"><span>攻擊</span><b>' + mine.attack + "</b></div>" +
        '<div class="compare-stat"><span>防禦</span><b>' + mine.defense + "</b></div>" +
        '<div class="compare-stat"><span>默契</span><b>' +
        Math.round((mine.bond || 0) * 100) + "%</b></div>"
      : '<p class="small">你還沒有「' + esc(arch) +
        "」武器——買下它就是你的第一件。</p>") +
    "</div></div>" +
    '<p class="compare-note">數值為上架時快照。' +
    "買到的武器默契歸零——真正的默契要靠自己的學習重建。</p>" +
    (l.trade_kind === "sell"
      ? '<button class="btn primary" id="compareBuy" style="width:100%">星砂 ' +
        l.price + " 購入</button>"
      : "");
  const close = () => {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  };
  $("compareClose").onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  const buyBtn = $("compareBuy");
  if (buyBtn) buyBtn.onclick = async () => {
    buyBtn.disabled = true;
    try {
      const r = await api("/api/v1/world/market/" + l.id + "/buy", { method: "POST" });
      toast("購入成功！" + (r.note || ""));
      close();
      loadMarket();
    } catch (e) {
      toast(e.message || "購買失敗");
      buyBtn.disabled = false;
    }
  };
}

async function renderPublish() {
  const el = $("marketPublish");
  try {
    const [badges, islands] = await Promise.all([
      api("/api/v1/learn/badges"), api("/api/v1/world/islands"),
    ]);
    const badgeMap = {};
    badges.badges.forEach((b) => { badgeMap["badge:" + b.id] = b; });
    const opts = [
      ...badges.badges.map((b) => ({ v: "badge:" + b.id, t: b.name })),
      ...islands.islands.map((i) => ({ v: "island:" + i.id, t: i.name + "（島嶼）" })),
    ];
    if (!opts.length) {
      el.innerHTML = '<p class="small">你還沒有可交易的武器或島嶼。</p>';
      return;
    }
    el.innerHTML = '<div class="acct-form">' +
      '<label class="lbl-h">選擇物品</label>' +
      '<select id="pubItem" class="input">' +
      opts.map((o) => '<option value="' + o.v + '">' + esc(o.t) + "</option>").join("") +
      "</select>" +
      '<div class="pub-info" id="pubInfo"></div>' +
      '<label class="lbl-h">交易方式</label>' +
      '<select id="pubKind" class="input"><option value="sell">星砂交易</option>' +
      '<option value="barter">以物易物</option></select>' +
      '<input id="pubPrice" class="input" type="number" min="0" placeholder="定價（星砂）">' +
      '<input id="pubWant" class="input" maxlength="100" placeholder="以物易物想換什麼（選填）">' +
      '<button class="btn primary" id="pubBtn">上架</button></div>';
    const updInfo = () => {
      const b = badgeMap[$("pubItem").value];
      $("pubInfo").innerHTML = b
        ? "<span>主分類：<b>" + esc(b.archetype || "未分類") + "</b></span>" +
          "<span>標籤：" + ((b.tags || []).map(esc).join("／") || "無") + "</span>" +
          "<span>攻 " + b.attack + "／防 " + b.defense + "</span>"
        : "<span>島嶼上架：無武器分類</span>";
    };
    $("pubItem").onchange = updInfo;
    updInfo();
    $("pubBtn").onclick = async () => {
      const [item_type, item_id] = $("pubItem").value.split(":");
      try {
        await api("/api/v1/world/market", {
          method: "POST",
          body: JSON.stringify({
            item_type, item_id,
            price: parseInt($("pubPrice").value || "0", 10),
            trade_kind: $("pubKind").value,
            want_text: $("pubWant").value.trim(),
          }),
        });
        toast("上架成功！");
        loadMarket(); renderPublish();
      } catch (e) { toast(e.message || "上架失敗"); }
    };
  } catch (e) { el.innerHTML = ""; }
}

/* ---------------- 週精選 ---------------- */

async function initWeekly() {
  if (!needLogin("weeklyGate")) {
    $("weeklyBody").innerHTML = ""; $("weeklyReview").innerHTML = ""; $("weeklyAttr").innerHTML = "";
    return;
  }
  try {
    const d = await api("/api/v1/world/weekly", { method: "POST" });
    renderWeeklyItems(d);
    renderWeeklyReview(d);
  } catch (e) {
    $("weeklyBody").innerHTML = '<p class="small">載入失敗。</p>';
  }
  renderAttr();
}

function renderWeeklyItems(d) {
  const el = $("weeklyBody");
  if (!d.items.length) {
    el.innerHTML = '<p class="small">本週還沒有精選——多完成幾場戰役，系統會更懂你。</p>';
    return;
  }
  el.innerHTML = d.items.map((it) =>
    '<div class="panel weekly-card"><div class="weekly-ctype">' + esc(it.ctype) + "</div>" +
    "<b>" + esc(it.title) + "</b>" +
    '<p class="small">' + esc(it.summary || "") + "</p>" +
    '<div class="small">深度 ' + stars(it.depth) + " · 趣味 " + stars(it.fun) + "</div>" +
    '<div class="small" style="opacity:.7">' + esc(it.why || "") + "</div>" +
    (it.url ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener" class="small">開啟 →</a>' : "") +
    "</div>"
  ).join("");
}

function renderWeeklyReview(d) {
  const el = $("weeklyReview");
  const r = d.review || {};
  el.innerHTML =
    '<div class="review-grid">' +
    '<div class="stat-box"><div class="num">' + (r.battles || 0) + '</div><div class="lbl">本週戰役</div></div>' +
    '<div class="stat-box"><div class="num">' + (r.badges || 0) + '</div><div class="lbl">技能章</div></div>' +
    '<div class="stat-box"><div class="num">+' + (d.attr_points || 0) + '</div><div class="lbl">屬性點</div></div>' +
    "</div>" +
    '<div class="callout"><b>🪞 反思</b><br>' + esc(r.reflect_prompt || "") + "</div>" +
    '<div class="callout"><b>🎯 校準</b><br>' + esc(r.calibration_prompt || "") + "</div>" +
    ((r.topics || []).length
      ? '<div class="small">系統估計：' + r.topics.map((t) =>
        esc(t.topic) + " " + Math.round(t.mastery * 100) + "%").join(" · ") + "</div>"
      : "") +
    '<div class="callout"><b>🔭 預想</b><br>' + esc(r.plan_prompt || "") + "</div>";
}

async function renderAttr() {
  const el = $("weeklyAttr");
  try {
    const [pts, badges] = await Promise.all([
      api("/api/v1/world/attr-points"), api("/api/v1/learn/badges"),
    ]);
    if (!badges.badges.length) {
      el.innerHTML = "<p class='small'>擁有 " + pts.points + " 點。完成戰役鍛造武器後可加乘。</p>";
      return;
    }
    el.innerHTML = "<p>擁有 <b>" + pts.points + "</b> 點自由屬性點</p>" +
      '<div class="acct-form"><select id="attrBadge" class="input">' +
      badges.badges.map((b) => '<option value="' + b.id + '">🗡️ ' + esc(b.name) +
        "（攻" + b.attack + "/防" + b.defense + "）</option>").join("") + "</select>" +
      '<select id="attrRoute" class="input"><option value="attack">攻擊路線</option>' +
      '<option value="defense">防禦路線</option><option value="bond">默契路線</option></select>' +
      '<input id="attrNum" class="input" type="number" min="1" value="1">' +
      '<button class="btn primary" id="attrBtn">投入</button></div>' +
      '<p class="small">攻擊／防禦：1點=+3；默契：1點=+10%。路線分化，謹慎選擇。</p>';
    $("attrBtn").onclick = async () => {
      try {
        const r = await api("/api/v1/world/attr-points/spend", {
          method: "POST",
          body: JSON.stringify({
            badge_id: $("attrBadge").value,
            points: parseInt($("attrNum").value || "1", 10),
            route: $("attrRoute").value,
          }),
        });
        toast("加乘完成！剩餘 " + r.points_left + " 點。");
        renderAttr(); loadBadges();
      } catch (e) { toast(e.message || "投入失敗"); }
    };
  } catch (e) { el.innerHTML = ""; }
}

/* ---------------- 課本筆記章節 ---------------- */

async function buildNotesChapter() {
  if (!Auth.user) return "";
  try {
    const d = await api("/api/v1/learn/textbook");
    const chs = d.chapters || [];
    if (!chs.length) return "";
    // 按主題分卷
    const vols = {};
    chs.forEach((c) => {
      const k = c.topic || "雜記";
      (vols[k] = vols[k] || []).push(c);
    });
    let html = '<div class="panel"><h2 class="h2"><span class="ch-num">卷首</span>我的筆記</h2>' +
      '<p class="sub">每次戰役的學習筆記——你的話為主，AI 只做眉批。</p>';
    Object.keys(vols).forEach((topic) => {
      const list = vols[topic].slice().reverse(); // 舊→新
      html += '<h3 class="h3">📖 ' + esc(topic) + "卷</h3>";
      list.forEach((c, i) => {
        html += '<div class="note-chapter"><h4>第' + (i + 1) + "章：" + esc(c.question) + "</h4>" +
          '<div class="small">Lv' + c.depth + " · " + esc(c.grade_band || "") + " · " +
          String(c.completed_at || "").slice(0, 10) +
          (c.quiz_score ? " · 測驗 " + esc(c.quiz_score) : "") + "</div>";
        if (c.hypothesis) html += '<p><b>💭 我的假設：</b>' + esc(c.hypothesis) + "</p>";
        if (c.explanation) html += '<p><b>✍️ 我的理解：</b>' + esc(c.explanation) + "</p>";
        if (c.ai_feedback) html += '<p class="small"><b>🤖 AI 眉批：</b>' + esc(c.ai_feedback).slice(0, 300) + "</p>";
        if (c.badge) html += '<p class="small">🏆 戰利品：' + esc(c.badge.name) +
          "（" + esc(c.badge.rarity) + "）</p>";
        html += "</div>";
      });
    });
    return html + "</div>";
  } catch (e) {
    return "";
  }
}

/* ---------------- 對外接口 ---------------- */

/* 辯論 modal 關閉接線（DOM 已就緒：script 在 body 尾端） */
$("debateClose").onclick = closeDebateModal;
$("debateModal").addEventListener("click", (e) => {
  if (e.target === $("debateModal")) closeDebateModal();
});

window.WorldUI = {
  initLearn, initJourney, initMarket, initWeekly, initArmory,
  loadPet, loadLearnIslands, buildNotesChapter,
  showWaiting, stopWaiting,
};

})();
