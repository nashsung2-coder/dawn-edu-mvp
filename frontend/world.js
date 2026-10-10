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

/* ---------------- 學習中心 ---------------- */

let battle = null; // {id, question, topic, depth_level, stage}

async function initLearn() {
  if (!needLogin("learnGate")) { $("learnBody").style.display = "none"; return; }
  $("learnBody").style.display = "";
  $("learnStartBtn").onclick = startBattle;
  loadLearnHistory();
  loadMastery();
  loadBadges();
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
  st.innerHTML = battleHeader("第二幕 · 穿插測驗") + '<p class="sub">載入題目中…</p>';
  try {
    const d = await api("/api/v1/learn/sessions/" + battle.id + "/quiz", { method: "POST" });
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
    toast(e.message || "載入測驗失敗");
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

function renderFeynman() {
  const st = $("learnStage");
  st.innerHTML = battleHeader("第三幕 · 費曼解釋") +
    '<div class="quiz-tip">🔒 關書時間——憑記憶講，不准偷看。這是效應最強的一幕。</div>' +
    '<p class="sub">用自己的話把整個概念講清楚，試圖說服 AI：</p>' +
    '<textarea id="feynmanText" class="input" rows="6" maxlength="2000" ' +
    'placeholder="想像你在教一個聰明但挑剔的朋友…"></textarea>' +
    '<button class="btn primary" id="feynmanSubmit">說服 AI</button>' +
    '<div id="feynmanResp"></div>';
  $("feynmanSubmit").onclick = submitFeynman;
}

async function submitFeynman() {
  const text = $("feynmanText").value.trim();
  if (text.length < 10) { toast("再多講一點，講到別人能聽懂為止。"); return; }
  const btn = $("feynmanSubmit");
  btn.disabled = true;
  btn.textContent = "AI 思考中…";
  try {
    const d = await api("/api/v1/learn/sessions/" + battle.id + "/feynman", {
      method: "POST", body: JSON.stringify({ explanation: text }),
    });
    let html = '<div class="callout"><b>🤖 AI 回饋</b><br>' + esc(d.feedback) + "</div>";
    if (d.followup) html += '<div class="callout"><b>追問</b><br>' + esc(d.followup) + "</div>";
    html += '<p class="small">知識建構度：' + Math.round(d.build_score * 100) + "%" +
      (d.llm ? " · AI 驅動" : " · 規則引導") + "</p>";
    html += '<div class="acct-form"><label class="lbl-h">為這次學習命名一枚技能章（選填）</label>' +
      '<input id="badgeName" class="input" maxlength="12" placeholder="例如：啼哭悖論之刃">' +
      '<button class="btn primary" id="finishBtn">完成戰役 · 授勳</button></div>';
    $("feynmanResp").innerHTML = html;
    $("finishBtn").onclick = finishBattle;
  } catch (e) {
    toast(e.message || "提交失敗");
  } finally {
    btn.disabled = false;
    btn.textContent = "說服 AI";
  }
}

async function finishBattle() {
  const name = ($("badgeName") || {}).value || "";
  try {
    const d = await api("/api/v1/learn/sessions/" + battle.id + "/finish", {
      method: "POST", body: JSON.stringify({ badge_name: name.trim() }),
    });
    const b = d.badge;
    let html = battleHeader("🏆 授勳") +
      '<div class="badge-card"><div class="badge-name">' + esc(b.name) + "</div>" +
      '<div class="small">' + esc(b.rarity) + " · 攻擊 " + b.attack + " · 防禦 " + b.defense +
      " · 默契 " + Math.round(b.bond * 100) + "%</div>" +
      (b.ai_comment ? '<div class="small">「' + esc(b.ai_comment) + "」</div>" : "") + "</div>";
    if (d.pet) {
      html += d.pet.hatched
        ? '<div class="callout">🐾 寵物孵化了！去島嶼頁看看你的新夥伴。</div>'
        : '<div class="callout">🐾 寵物獲得經驗，變強了！</div>';
    }
    html += '<button class="btn" id="newBattleBtn">再來一場</button> ' +
      '<button class="btn" id="nameIslandBtn">為這次命名一座島嶼</button>';
    $("learnStage").innerHTML = html;
    $("newBattleBtn").onclick = () => {
      battle = null;
      $("learnStage").style.display = "none";
      $("learnStage").innerHTML = "";
      $("learnStart").style.display = "";
      $("learnQ").value = ""; $("learnHyp").value = "";
      loadLearnHistory(); loadMastery(); loadBadges();
    };
    $("nameIslandBtn").onclick = async () => {
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
    loadLearnHistory(); loadMastery(); loadBadges();
  } catch (e) {
    toast(e.message || "授勳失敗");
  }
}

async function loadLearnHistory() {
  const el = $("learnHistory");
  try {
    const d = await api("/api/v1/learn/sessions?limit=10");
    if (!d.sessions.length) { el.innerHTML = '<p class="small">還沒有戰役紀錄。</p>'; return; }
    el.innerHTML = '<ul class="book-list">' + d.sessions.map((s) =>
      "<li>" + esc(s.question) + ' <span class="small">（' + esc(s.topic) +
      " Lv" + s.depth_level + " · " + esc(s.status) + "）</span></li>"
    ).join("") + "</ul>";
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

async function loadBadges() {
  const el = $("learnBadges");
  try {
    const d = await api("/api/v1/learn/badges");
    if (!d.badges.length) { el.innerHTML = '<p class="small">完成戰役可鍛造技能章。</p>'; return; }
    el.innerHTML = '<div class="badge-grid">' + d.badges.map((b) =>
      '<div class="badge-card"><div class="badge-name">' + esc(b.name) + "</div>" +
      '<div class="small">' + esc(b.rarity) + " · 攻 " + b.attack + " · 防 " + b.defense +
      " · 默契 " + Math.round((b.bond || 0) * 100) + "%</div></div>"
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

async function initMarket() {
  if (!needLogin("marketGate")) { $("marketBody").innerHTML = ""; return; }
  await loadMarket();
  await renderPublish();
}

async function loadMarket() {
  const el = $("marketBody");
  try {
    const d = await api("/api/v1/world/market");
    if (!d.listings.length) {
      el.innerHTML = '<p class="small">市集空空如也——成為第一個上架的人吧。</p>';
      return;
    }
    el.innerHTML = d.listings.map((l) =>
      '<div class="panel market-card"><b>' +
      (l.item_type === "badge" ? "🗡️ 武器" : "🏝️ 島嶼") + "</b> " +
      '<span class="small">' + (l.trade_kind === "sell" ? "星砂 " + l.price : "以物易物：" + esc(l.want_text || "")) + "</span>" +
      '<button class="btn sm primary" data-buy="' + l.id + '"' +
      (l.trade_kind !== "sell" ? " disabled" : "") + ">購買</button></div>"
    ).join("");
    el.querySelectorAll("button[data-buy]").forEach((b) => {
      b.onclick = async () => {
        try {
          const r = await api("/api/v1/world/market/" + b.dataset.buy + "/buy", { method: "POST" });
          toast("購入成功！" + (r.note || ""));
          loadMarket();
        } catch (e) { toast(e.message || "購買失敗"); }
      };
    });
  } catch (e) { el.innerHTML = ""; }
}

async function renderPublish() {
  const el = $("marketPublish");
  try {
    const [badges, islands] = await Promise.all([
      api("/api/v1/learn/badges"), api("/api/v1/world/islands"),
    ]);
    const opts = [
      ...badges.badges.map((b) => ({ v: "badge:" + b.id, t: "🗡️ " + b.name })),
      ...islands.islands.map((i) => ({ v: "island:" + i.id, t: "🏝️ " + i.name })),
    ];
    if (!opts.length) {
      el.innerHTML = '<p class="small">你還沒有可交易的武器或島嶼。</p>';
      return;
    }
    el.innerHTML = '<div class="acct-form">' +
      '<select id="pubItem" class="input">' +
      opts.map((o) => '<option value="' + o.v + '">' + esc(o.t) + "</option>").join("") +
      "</select>" +
      '<select id="pubKind" class="input"><option value="sell">星砂交易</option>' +
      '<option value="barter">以物易物</option></select>' +
      '<input id="pubPrice" class="input" type="number" min="0" placeholder="定價（星砂）">' +
      '<input id="pubWant" class="input" maxlength="100" placeholder="以物易物想換什麼（選填）">' +
      '<button class="btn primary" id="pubBtn">上架</button></div>';
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

window.WorldUI = {
  initLearn, initJourney, initMarket, initWeekly,
  loadPet, loadLearnIslands, buildNotesChapter,
};

})();
