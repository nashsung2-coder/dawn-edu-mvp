/* ============================================================
 * 曙光教育 3.0 · 學習深層系統 sys-learn.js
 * 三個獨立可運作系統：Trial 試煉場 / Dex 知識圖鑑 / Debate 辯論台
 * 依賴 window.Dawn（sys-core.js）：api / toast / esc / store /
 * wallet / inv / modal / ensureSession。全部繁體中文。
 * ============================================================ */
"use strict";

/* ================= Trial 試煉場 ================= */
(function () {
  const SUBJECTS = ["國文", "英文", "數學", "自然", "社會"];

  // 離線備用題庫：每科 2 題
  const OFFLINE_Q = [
    { s: "國文", q: "「曾經滄海難為水」的下一句是？",
      options: ["除卻巫山不是雲", "春風又綠江南岸", "明月何時照我還", "桃花依舊笑春風"],
      answer: 0, explain: "出自元稹《離思五首·其四》，以滄海巫山之水雲比喻刻骨銘心的愛情。" },
    { s: "國文", q: "下列哪個成語用來形容做事有始有終？",
      options: ["虎頭蛇尾", "半途而廢", "善始善終", "淺嘗輒止"],
      answer: 2, explain: "「善始善終」指做事情有好的開頭也有好的結尾。" },
    { s: "英文", q: "She has lived here ___ 2019.",
      options: ["since", "for", "from", "at"],
      answer: 0, explain: "since + 時間起點（2019），for + 一段時間長度。" },
    { s: "英文", q: "Which word is a synonym of “rapid”?",
      options: ["slow", "quick", "quiet", "rare"],
      answer: 1, explain: "rapid = 快速的，同義詞為 quick。" },
    { s: "數學", q: "若 3x + 5 = 20，則 x =？",
      options: ["3", "5", "6", "15"],
      answer: 1, explain: "3x = 15，x = 5。" },
    { s: "數學", q: "一個三角形三邊長為 3、4、5，它是什麼三角形？",
      options: ["銳角三角形", "直角三角形", "鈍角三角形", "等邊三角形"],
      answer: 1, explain: "3² + 4² = 5²，符合畢氏定理，為直角三角形。" },
    { s: "自然", q: "水的化學式是？",
      options: ["CO₂", "H₂O", "O₂", "NaCl"],
      answer: 1, explain: "水由兩個氫原子與一個氧原子組成，化學式為 H₂O。" },
    { s: "自然", q: "植物進行光合作用的主要場所是？",
      options: ["粒線體", "細胞核", "葉綠體", "細胞壁"],
      answer: 2, explain: "葉綠體含有葉綠素，是光合作用的場所。" },
    { s: "社會", q: "台灣的最高立法機關是？",
      options: ["行政院", "立法院", "司法院", "監察院"],
      answer: 1, explain: "立法院為我國最高立法機關，由立法委員組成。" },
    { s: "社會", q: "「三權分立」不包含下列哪一權？",
      options: ["行政權", "立法權", "司法權", "考試權"],
      answer: 3, explain: "三權分立指行政、立法、司法三權；考試權是我國五權憲法特有的設計。" },
  ];

  let st = null; // 本次試煉狀態

  function bestOf(subject) {
    try {
      const h = Dawn.store.get("trial_history", []);
      const mine = h.filter((x) => x.subject === subject);
      if (!mine.length) return null;
      return mine.reduce((a, b) => (b.score > a.score ? b : a));
    } catch (e) { return null; }
  }

  function normQuestions(raw, subject) {
    // 把後端各種題型轉成 {q, options, answer, explain}
    let arr = [];
    if (Array.isArray(raw)) arr = raw;
    else if (raw && Array.isArray(raw.questions)) arr = raw.questions;
    else if (raw && Array.isArray(raw.quiz)) arr = raw.quiz;
    const out = [];
    for (const q of arr) {
      const text = q.question || q.text || q.stem || q.q || "";
      const opts = q.options || q.choices || [];
      if (!text || !Array.isArray(opts) || opts.length < 2) continue;
      let ans = q.answer;
      if (typeof ans !== "number") ans = (typeof q.correct_index === "number") ? q.correct_index : -1;
      if (ans < 0 || ans >= opts.length) {
        // 嘗試用正確選項文字比對
        const cw = q.correct || q.correct_answer;
        ans = opts.indexOf(cw);
      }
      if (ans < 0) ans = 0;
      out.push({
        q: String(text),
        options: opts.map((o) => String(o)),
        answer: ans,
        explain: q.explanation || q.explain || q.parse || "",
        id: q.id || q.qid || null,
      });
    }
    return out.slice(0, 5);
  }

  async function fetchQuestions(sid, subject) {
    const data = await Dawn.api("/api/v1/learn/sessions/" + sid + "/quiz?n=5", {
      method: "POST",
      body: JSON.stringify({ subject: subject, n: 5 }),
      timeout: 20000,
    });
    return normQuestions(data, subject);
  }

  function offlineQuestions(subject) {
    const pool = OFFLINE_Q.filter((q) => q.s === subject);
    const list = pool.length ? pool : OFFLINE_Q;
    return list.slice(0, 5).map((q) => Object.assign({}, q));
  }

  function renderSetup(el) {
    const chips = SUBJECTS.map((s) =>
      '<span class="chip' + (st.subject === s ? " on" : "") + '" data-subj="' + s + '">' + s + "</span>"
    ).join("");
    const best = bestOf(st.subject);
    el.innerHTML =
      '<div class="sys-card"><h3>🏟️ 試煉場</h3>' +
      '<p class="desc">選擇科目，挑戰 5 道題目。答對率越高，獲得的記憶微粒越多！</p>' +
      '<div class="chipset">' + chips + "</div>" +
      (best
        ? '<p class="desc">📜 歷史最佳：' + Dawn.esc(best.subject) + " " + best.score + " 分（" +
          Dawn.esc(best.date) + "）</p>"
        : '<p class="desc">📜 尚無挑戰紀錄，來寫下第一筆吧！</p>') +
      '<div class="btn-row"><button class="btn primary" id="trialStart">⚔️ 開始試煉</button></div></div>';
    el.querySelectorAll("[data-subj]").forEach((c) => {
      c.onclick = () => { st.subject = c.dataset.subj; renderSetup(el); };
    });
    el.querySelector("#trialStart").onclick = startTrial;
  }

  async function startTrial() {
    const el = document.getElementById("trialBody");
    el.innerHTML = '<div class="sys-loading">正在生成試煉題目</div>';
    let questions = [], online = true, sid = "";
    try {
      sid = await Dawn.ensureSession("試煉場·" + st.subject);
      questions = await fetchQuestions(sid, st.subject);
      if (!questions.length) throw new Error("後端未回傳題目");
    } catch (e) {
      online = false;
      questions = offlineQuestions(st.subject);
      Dawn.toast("後端連線失敗，使用離線題庫");
    }
    st.sid = sid; st.online = online;
    st.questions = questions; st.idx = 0; st.picked = -1;
    st.results = []; st.picks = [];
    renderQuestion(el);
  }

  function renderQuestion(el) {
    const q = st.questions[st.idx];
    const total = st.questions.length;
    let html =
      '<div class="sys-card"><h3>第 ' + (st.idx + 1) + " / " + total + " 題 · " + Dawn.esc(st.subject) + "</h3>" +
      '<div class="quiz-progress"><i style="width:' + Math.round((st.idx / total) * 100) + '%"></i></div>' +
      "<p style=\"font-size:16px;line-height:1.7;margin:8px 0\">" + Dawn.esc(q.q) + "</p>";
    q.options.forEach((op, i) => {
      html += '<button class="quiz-opt" data-opt="' + i + '">' +
        String.fromCharCode(65 + i) + ". " + Dawn.esc(op) + "</button>";
    });
    html += '<div id="trialExplain"></div><div class="btn-row" style="margin-top:12px">' +
      '<button class="btn primary" id="trialNext" disabled>' +
      (st.idx + 1 >= total ? "交卷 🎯" : "下一題 →") + "</button></div></div>";
    el.innerHTML = html;
    el.querySelectorAll(".quiz-opt").forEach((b) => {
      b.onclick = () => pickOption(el, parseInt(b.dataset.opt, 10));
    });
    el.querySelector("#trialNext").onclick = nextQuestion;
  }

  function pickOption(el, i) {
    if (st.picked >= 0) return; // 已鎖定
    const q = st.questions[st.idx];
    st.picked = i;
    const ok = i === q.answer;
    st.results.push(ok);
    st.picks.push(i);
    el.querySelectorAll(".quiz-opt").forEach((b) => {
      const bi = parseInt(b.dataset.opt, 10);
      b.disabled = true;
      if (bi === q.answer) b.classList.add("right");
      else if (bi === i) b.classList.add("wrong");
      else b.classList.add("picked");
    });
    const ex = el.querySelector("#trialExplain");
    ex.innerHTML = '<div class="quiz-explain">' + (ok ? "✅ 答對了！" : "❌ 答錯了，正確答案是 " +
      String.fromCharCode(65 + q.answer)) + (q.explain ? "<br>" + Dawn.esc(q.explain) : "") + "</div>";
    el.querySelector("#trialNext").disabled = false;
  }

  async function nextQuestion() {
    const el = document.getElementById("trialBody");
    if (st.idx + 1 >= st.questions.length) { await finishTrial(el); return; }
    st.idx++; st.picked = -1;
    renderQuestion(el);
  }

  async function finishTrial(el) {
    const total = st.questions.length;
    const correct = st.results.filter(Boolean).length;
    const rate = total ? Math.round((correct / total) * 100) : 0;
    const score = rate;
    // 交卷（後端）
    if (st.online && st.sid) {
      try {
        await Dawn.api("/api/v1/learn/sessions/" + st.sid + "/quiz/answers", {
          method: "POST",
          body: JSON.stringify({
            answers: st.questions.map((q, i) => ({
              question_id: q.id, index: i, selected: st.picks[i],
              correct: !!st.results[i],
            })),
          }),
          timeout: 15000,
        });
      } catch (e) { /* 離線計分，不影響 */ }
    }
    // 記憶微粒獎勵
    let reward = 10;
    if (rate === 100) reward = 50; else if (rate >= 60) reward = 30;
    try { await Dawn.wallet.addParticles(reward, "試煉場 " + st.subject + " " + score + "分"); }
    catch (e) { Dawn.toast("獎勵發放失敗"); }
    // 戰績存檔
    try {
      const h = Dawn.store.get("trial_history", []);
      h.unshift({
        date: new Date().toLocaleDateString("zh-TW"),
        t: Date.now(), subject: st.subject, score: score,
        correct: correct, total: total,
      });
      Dawn.store.set("trial_history", h.slice(0, 50));
    } catch (e) {}
    // 徽章：首次完成 / 全對
    try {
      const obt = Dawn.store.get("dex_obtained", {});
      const give = (id, item) => {
        if (!obt[id]) {
          obt[id] = Date.now();
          Dawn.store.set("dex_obtained", obt);
          Dawn.inv.add(item);
        }
      };
      give("badge_first", { icon: "🌱", name: "初心者之證" });
      if (rate === 100) give("badge_combo", { icon: "🏅", name: "連擊徽章" });
    } catch (e) {}
    // 結算畫面
    const face = rate === 100 ? "🏆" : rate >= 60 ? "🎉" : "💪";
    el.innerHTML =
      '<div class="sys-card" style="text-align:center;padding:32px 16px"><div style="font-size:56px">' + face + "</div>" +
      "<h3>試煉完成！</h3>" +
      '<p class="desc">' + Dawn.esc(st.subject) + " · 答對 " + correct + " / " + total + " 題</p>" +
      '<div style="font-size:44px;font-weight:800;color:var(--gold)">' + score + " 分</div>" +
      '<p class="desc">獲得記憶微粒 ×' + reward + "</p>" +
      '<div class="btn-row"><button class="btn primary" id="trialAgain">再來一場</button>' +
      '<button class="btn" id="trialBack">返回選科</button></div></div>';
    el.querySelector("#trialAgain").onclick = startTrial;
    el.querySelector("#trialBack").onclick = () => { st.idx = 0; renderSetup(el); };
  }

  window.Trial = {
    enter() {
      try {
        const el = document.getElementById("trialBody");
        if (!el) return;
        st = { subject: st && st.subject ? st.subject : "國文", sid: "", online: false, questions: [], idx: 0, picked: -1, results: [] };
        renderSetup(el);
      } catch (e) {
        Dawn.toast("試煉場載入失敗");
        console.warn("[Trial]", e);
      }
    },
  };
})();


/* ================= Dex 知識圖鑑 ================= */
(function () {
  // 12 種圖鑑定義：id / 圖示 / 名稱 / 稀有度 / 描述 / 獲得方式
  const DEFS = [
    { id: "blade_evap", icon: "⚔️", name: "蒸發之刃", rar: "R", type: "武器",
      desc: "以液體蒸發吸熱為靈感的知識之刃，能蒸發對手的論點水分。",
      how: "在試煉場自然科取得 60 分以上" },
    { id: "wall_refract", icon: "🛡️", name: "折射壁壘", rar: "R", type: "武器",
      desc: "光線折射般扭曲攻擊軌道的防禦壁壘，物理科的智慧結晶。",
      how: "在試煉場累計完成 3 場試煉" },
    { id: "badge_combo", icon: "🏅", name: "連擊徽章", rar: "N", type: "徽章",
      desc: "完美無缺的證明。一次試煉全部答對的勇者才能佩戴。",
      how: "試煉場單場 100 分" },
    { id: "atk_insecure", icon: "🌀", name: "安全感喪失攻擊", rar: "SR", type: "專屬武器",
      desc: "使對方 LV1 防禦武器陷入 5 秒空窗的靈魂攻擊。續能 3 小時。",
      how: "在閉門造車中說服 AI，鍛造專屬武器" },
    { id: "badge_first", icon: "🌱", name: "初心者之證", rar: "N", type: "徽章",
      desc: "每一位旅人都有起點。這是你完成第一場試煉的紀念。",
      how: "完成第一場試煉" },
    { id: "blade_debate", icon: "🗡️", name: "思辨之鋒", rar: "R", type: "武器",
      desc: "在辯論台上千錘百鍊的言語之刃，邏輯越清晰越鋒利。",
      how: "在辯論台贏得一場辯論" },
    { id: "badge_traveler", icon: "🚀", name: "星海旅人", rar: "N", type: "徽章",
      desc: "第一次仰望宇宙星海的證明。未知在前方等你。",
      how: "進入遊歷宇宙首頁" },
    { id: "core_guard", icon: "💠", name: "守護星核", rar: "SR", type: "武器",
      desc: "凝聚星球核心能量的防禦裝置，能抵擋強力的遠端攻擊。",
      how: "在宇宙戰鬥中取得勝利" },
    { id: "badge_pioneer", icon: "🌅", name: "曙光先驅", rar: "SSR", type: "徽章",
      desc: "曙光教育最早的一批開拓者。傳說中的存在。",
      how: "完成特殊里程碑（敬請期待）" },
    { id: "badge_weaver", icon: "🕸️", name: "知識織者", rar: "R", type: "徽章",
      desc: "將零散知識編織成網的人。圖鑑收集過半的智者象徵。",
      how: "圖鑑收集達 6 種" },
    { id: "atk_void", icon: "🌌", name: "虛空低語", rar: "SR", type: "專屬武器",
      desc: "來自宇宙深處的低語，能讓對手陷入短暫的思考停滯。",
      how: "探索未知星域並發現新星球" },
    { id: "badge_legend", icon: "⭐", name: "傳說之星", rar: "SSR", type: "徽章",
      desc: "集齊所有圖鑑的究極榮耀。你的名字將刻在曙光豐碑上。",
      how: "圖鑑收集達 12 種（全收集）" },
  ];

  const norm = (s) => String(s || "").toLowerCase().replace(/[\s　]/g, "");

  // 收集已獲得：後端徽章 + 背包 + 本地成就紀錄
  async function ownedMap() {
    const owned = {}; // id -> {t, src}
    const mark = (id, t, src) => { if (!owned[id]) owned[id] = { t: t || Date.now(), src: src }; };
    // ① 本地成就紀錄（試煉/辯論頒發時寫入）
    try {
      const obt = Dawn.store.get("dex_obtained", {});
      Object.keys(obt).forEach((id) => mark(id, obt[id], "成就"));
    } catch (e) {}
    // ② 背包物品（按名稱比對）
    try {
      Dawn.inv.list().forEach((it) => {
        const n = norm(it.name);
        DEFS.forEach((d) => { if (n && (n === norm(d.name) || n.indexOf(norm(d.name)) >= 0)) mark(d.id, it.t, "背包"); });
      });
    } catch (e) {}
    // ③ 後端徽章
    try {
      const data = await Dawn.api("/api/v1/learn/badges", { timeout: 12000 });
      const arr = Array.isArray(data) ? data : (data.badges || data.items || []);
      arr.forEach((b) => {
        const key = norm(b.id || b.badge_id || "") + "|" + norm(b.name || b.title || "");
        DEFS.forEach((d) => {
          if (key.indexOf(norm(d.id)) >= 0 || key.indexOf(norm(d.name)) >= 0) {
            mark(d.id, b.obtained_at || b.t || Date.now(), "後端");
          }
        });
      });
    } catch (e) { /* 離線：用本地資料即可 */ }
    // ④ 試煉戰績推導
    try {
      const h = Dawn.store.get("trial_history", []);
      if (h.length) mark("badge_first", h[h.length - 1].t, "試煉");
      if (h.some((x) => x.score === 100)) mark("badge_combo", Date.now(), "試煉");
      if (h.length >= 3) mark("wall_refract", Date.now(), "試煉");
      if (h.some((x) => x.subject === "自然" && x.score >= 60)) mark("blade_evap", Date.now(), "試煉");
    } catch (e) {}
    // ⑤ 辯論勝利推導
    try {
      const w = Dawn.store.get("debate_wins", 0);
      if (w > 0) mark("blade_debate", Date.now(), "辯論");
    } catch (e) {}
    // ⑥ 收集進度成就
    const count = Object.keys(owned).length;
    if (count >= 6) mark("badge_weaver", Date.now(), "收集");
    if (count >= 12) mark("badge_legend", Date.now(), "收集");
    return owned;
  }

  function fmtTime(t) {
    try { return new Date(t).toLocaleDateString("zh-TW"); } catch (e) { return ""; }
  }

  window.Dex = {
    async enter() {
      const el = document.getElementById("dexBody");
      if (!el) return;
      try {
        el.innerHTML = '<div class="sys-loading">正在翻開圖鑑</div>';
        const owned = await ownedMap();
        const n = Object.keys(owned).length;
        let html =
          '<div class="sys-card"><h3>📖 知識圖鑑</h3>' +
          '<p class="desc">收集進度 <b style="color:var(--gold)">' + n + " / " + DEFS.length +
          "</b> · 在試煉場、辯論台、戰鬥中獲得徽章與武器</p>" +
          '<div class="quiz-progress"><i style="width:' + Math.round((n / DEFS.length) * 100) + '%"></i></div></div>' +
          '<div class="dex-grid">';
        DEFS.forEach((d) => {
          const o = owned[d.id];
          html += '<div class="dex-cell' + (o ? "" : " locked") + '" data-dex="' + d.id + '">' +
            '<span style="font-size:30px">' + (o ? d.icon : "❔") + "</span>" +
            '<small>' + (o ? Dawn.esc(d.name) : "???") + "</small>" +
            '<span class="rar rar-' + d.rar + '">' + (o ? d.rar : "??") + "</span></div>";
        });
        html += "</div>";
        el.innerHTML = html;
        el.querySelectorAll("[data-dex]").forEach((cell) => {
          cell.onclick = () => {
            const d = DEFS.find((x) => x.id === cell.dataset.dex);
            const o = owned[d.id];
            if (!o) { Dawn.toast("尚未獲得：" + d.how); return; }
            Dawn.modal({
              title: d.icon + " " + d.name,
              html: '<p style="margin:0 0 8px"><span class="rar rar-' + d.rar + '">' + d.rar +
                '</span> <span style="color:var(--ink-2);font-size:13px">' + Dawn.esc(d.type) + "</span></p>" +
                '<p style="line-height:1.7;margin:0 0 8px">' + Dawn.esc(d.desc) + "</p>" +
                '<p style="color:var(--ink-2);font-size:13px;margin:0">🕰️ 獲得時間：' + fmtTime(o.t) +
                "<br>📍 獲得方式：" + Dawn.esc(d.how) + "</p>",
              actions: [{ label: "知道了", primary: true }],
            });
          };
        });
      } catch (e) {
        el.innerHTML = '<div class="sys-empty"><div class="big">📖</div><p>圖鑑載入失敗，點我重試</p></div>';
        el.querySelector(".sys-empty").onclick = () => window.Dex.enter();
        Dawn.toast("圖鑑載入失敗");
        console.warn("[Dex]", e);
      }
    },
  };
})();


/* ================= Debate 辯論台 ================= */
(function () {
const TOPICS = [
{ tag: "科技", title: "AI 應該擁有創作著作權嗎？"},
{ tag: "教育", title: "高中應該全面採用 AI 輔助教學嗎？"},
{ tag: "社會", title: "社群平台應該為假訊息負法律責任嗎？"},
];
const ROUNDS = 3;
const TURN_SECS = 60;

// 離線模擬 AI 反駁句庫
const AI_LINES = [
"這個觀點很有意思，但我必須指出：你提到的前提假設了一個理想情境，而現實往往複雜得多。你能否舉出具體的實證來支撐？",
"我理解你的立場，不過換個角度想：如果這個主張被推到極端，會產生什麼後果？任何政策都需要考慮邊界情況。",
"你說得有道理，但這忽略了成本問題。資源是有限的，當我們把資源投入這裡，就意味著其他地方的犧牲。這個取捨你怎麼看？",
"讓我挑戰一下你的邏輯：如果對方的論點同樣成立，你的標準是否應該一視同仁？一致性是辯論的基本要求。",
"這是一個常見的論點，但近年的研究顯示情況可能恰恰相反。你願意重新檢視一下這個假設背後的證據強度嗎？",
"很好的嘗試！不過我注意到你的論證跳過了關鍵的一步：從現象到結論之間，還需要一座橋樑。你能把那座橋補上嗎？",
];

let st = null;

function clearTimer() {
if (st && st.timerId) { clearInterval(st.timerId); st.timerId = null;}
}

function aiSay(text) {
return { who: "ai", text: text};
}
function meSay(text) {
return { who: "me", text: text};
}

function offlineReply(userText) {
// 簡單呼應用戶內容 + 句庫輪替
const n = st.rounds.filter((r) => r.who === "ai").length;
const line = AI_LINES[n % AI_LINES.length];
const echo = userText && userText.length > 8
? "你提到「" + userText.slice(0, 24) + "」，"
: "";
return echo + line;
}

function parseReply(d) {
if (!d) return "";
const r = d.reply || d.message || d.ai_response || d.ai || d.text || d.content;
return typeof r === "string"? r: "";
}

function renderSetup(el) {
const topics = TOPICS.map((t, i) =>
'<span class="chip' + (st.topicIdx === i? " on": "") + '" data-topic="' + i + '">' +
t.tag + " · " + Dawn.esc(t.title) + "</span>"
).join("");
el.innerHTML =
'<div class="sys-card"><h3>🎙️ 辯論台</h3>' +
'<p class="desc">選擇辯題與立場，撰寫開場陳述，與 AI 展開 3 回合辯論。勝利可獲得星砂！</p>' +
"<h3 style=\"font-size:14px;margin:12px 0 4px\">① 選擇辯題</h3>" +
'<div class="chipset">' + topics + "</div>" +
'<input id="debCustom" placeholder="或自訂辯題…" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--card-2);color:var(--ink);font-size:14px;margin:4px 0 8px" value="' + Dawn.esc(st.customTopic) + '">' +
"<h3 style=\"font-size:14px;margin:12px 0 4px\">② 選擇立場</h3>" +
'<div class="chipset">' +
'<span class="chip' + (st.stance === "正方"? " on": "") + '" data-stance="正方">👍 正方</span>' +
'<span class="chip' + (st.stance === "反方"? " on": "") + '" data-stance="反方">👎 反方</span></div>' +
"<h3 style=\"font-size:14px;margin:12px 0 4px\">③ 開場陳述</h3>" +
'<div class="debate-input"><textarea id="debOpen" placeholder="寫下你的開場陳述（建議 50 字以上）…">' +
Dawn.esc(st.opening) + "</textarea></div>" +
'<div class="btn-row" style="margin-top:12px"><button class="btn primary" id="debStart">🔥 開戰</button></div></div>';
el.querySelectorAll("[data-topic]").forEach((c) => {
c.onclick = () => { st.topicIdx = parseInt(c.dataset.topic, 10); st.customTopic = ""; renderSetup(el);};
});
el.querySelectorAll("[data-stance]").forEach((c) => {
c.onclick = () => { st.stance = c.dataset.stance; renderSetup(el);};
});
el.querySelector("#debCustom").oninput = (e) => { st.customTopic = e.target.value;};
el.querySelector("#debOpen").oninput = (e) => { st.opening = e.target.value;};
el.querySelector("#debStart").onclick = startDebate;
}

function curTopic() {
return st.customTopic.trim() || TOPICS[st.topicIdx].title;
}

async function startDebate() {
const el = document.getElementById("debateBody");
const topic = curTopic();
if (!topic) { Dawn.toast("請選擇或輸入辯題"); return;}
if (st.opening.trim().length < 10) { Dawn.toast("開場陳述至少寫 10 個字"); return;}
st.topic = topic;
el.innerHTML = '<div class="sys-loading">AI 辯手正在閱讀你的陳述</div>';
st.rounds = [meSay("" + st.opening.trim())];
st.roundIdx = 0; st.userChars = st.opening.trim().length; st.ended = false;
let aiText = "", online = true, sid = "";
try {
sid = await Dawn.ensureSession("辯論台·" + topic.slice(0, 12));
const d = await Dawn.api("/api/v1/learn/sessions/" + sid + "/debate/start", {
method: "POST",
body: JSON.stringify({ topic: topic, stance: st.stance, explanation: st.opening.trim()}),
timeout: 60000,
});
aiText = parseReply(d) || offlineReply(st.opening);
st.lastScore = d;
} catch (e) {
online = false;
aiText = offlineReply(st.opening);
Dawn.toast("後端連線失敗，啟用本地 AI 陪練");
}
st.sid = sid; st.online = online;
st.rounds.push(aiSay(aiText));
renderBattle(el);
}

function renderBattle(el) {
let html = '<div class="sys-card"><h3>⚔️ ' + Dawn.esc(st.topic) + "</h3>" +
'<p class="desc">你是 <b>' + Dawn.esc(st.stance) + "</b> · 第 " + (st.roundIdx + 1) + " / " + ROUNDS + " 回合</p>" +
'<div id="debLog">';
st.rounds.forEach((r) => {
html += '<div class="debate-turn ' + r.who + '"><div class="who">' +
(r.who === "me"? "🙋 你": "🤖 AI 辯手") + "</div>" + Dawn.esc(r.text) + "</div>";
});
html += "</div>";
if (!st.ended) {
html += '<div class="debate-timer">⏱️ 回應時間 <b id="debSecs">' + TURN_SECS + "</b> 秒（超時自動送出）</div>" +
'<div class="debate-input"><textarea id="debReply" placeholder="寫下你的反駁…"></textarea></div>' +
'<div class="btn-row" style="margin-top:10px"><button class="btn primary" id="debSend">送出反駁</button>' +
'<button class="btn danger" id="debGive">🏳️ 認輸</button></div>';
}
html += "</div>";
el.innerHTML = html;
const log = el.querySelector("#debLog");
if (log) log.scrollTop = log.scrollHeight;
if (st.ended) return;
// 倒數計時
clearTimer();
let left = TURN_SECS;
const secsEl = el.querySelector("#debSecs");
st.timerId = setInterval(() => {
left--;
if (secsEl) secsEl.textContent = left;
if (left <= 0) { submitRebuttal(true);}
}, 1000);
el.querySelector("#debSend").onclick = () => submitRebuttal(false);
el.querySelector("#debGive").onclick = concede;
}

async function submitRebuttal(auto) {
if (st.ended) return;
const el = document.getElementById("debateBody");
const ta = el.querySelector("#debReply");
const text = ta? ta.value.trim(): "";
if (!text &&!auto) { Dawn.toast("先寫下你的反駁再送出"); return;}
clearTimer();
const finalText = text || "（時間到，自動送出）";
st.rounds.push(meSay(finalText));
st.userChars += finalText.length;
st.roundIdx++;
el.innerHTML = '<div class="sys-loading">AI 辯手思考中</div>';
let aiText = "";
try {
if (st.online && st.sid) {
const d = await Dawn.api("/api/v1/learn/sessions/" + st.sid + "/debate/respond", {
method: "POST",
body: JSON.stringify({ text: finalText, round: st.roundIdx}),
timeout: 60000,
});
aiText = parseReply(d) || offlineReply(finalText);
st.lastScore = d;
} else {
aiText = offlineReply(finalText);
}
} catch (e) {
st.online = false;
aiText = offlineReply(finalText);
}
st.rounds.push(aiSay(aiText));
if (st.roundIdx >= ROUNDS) { await judge(el); return;}
renderBattle(el);
}

async function concede() {
if (st.ended) return;
clearTimer();
st.ended = true;
if (st.online && st.sid) {
try {
await Dawn.api("/api/v1/learn/sessions/" + st.sid + "/debate/concede", { method: "POST", timeout: 15000});
} catch (e) {}
}
await finishDebate(document.getElementById("debateBody"), false, "你選擇了認輸。");
}

async function judge(el) {
clearTimer();
st.ended = true;
el.innerHTML = '<div class="sys-loading">AI 裁判正在評分</div>';
let userScore = null, aiScore = null, comment = "";
try {
const d = st.lastScore || {};
const s = d.score;
if (typeof s === "number") userScore = s;
else if (s && typeof s.user === "number") { userScore = s.user; aiScore = s.ai;}
else if (typeof d.user_score === "number") { userScore = d.user_score; aiScore = d.ai_score;}
if (typeof d.winner === "string") {
st._winner = d.winner === "user" || d.winner === "me"? "user": "ai";
}
comment = d.feedback || d.comment || d.judge || d.remark || "";
} catch (e) {}
// 解析不到 → 按投入程度給基礎分
if (userScore == null) {
userScore = Math.min(95, 55 + Math.floor(st.userChars / 20));
aiScore = 76;
}
if (aiScore == null) aiScore = 76;
let win;
if (st._winner) win = st._winner === "user";
else win = userScore >= aiScore;
await finishDebate(el, win, comment, userScore, aiScore);
}

async function finishDebate(el, win, comment, userScore, aiScore) {
try {
if (win) {
await Dawn.wallet.addSands(20, "辯論台獲勝");
const wins = Dawn.store.get("debate_wins", 0);
Dawn.store.set("debate_wins", wins + 1);
// 頒發思辨之鋒
const obt = Dawn.store.get("dex_obtained", {});
if (!obt.blade_debate) {
obt.blade_debate = Date.now();
Dawn.store.set("dex_obtained", obt);
Dawn.inv.add({ icon: "🗡️", name: "思辨之鋒"});
}
} else {
await Dawn.wallet.addParticles(5, "辯論台參與獎勵");
}
} catch (e) { Dawn.toast("獎勵發放失敗");}
renderBattle(el); // 顯示完整對話紀錄（ended=true，不再顯示輸入區）
const card = document.createElement("div");
card.className = "sys-card";
card.style.textAlign = "center";
card.innerHTML =
'<div style="font-size:52px">' + (win? "🏆": "🤝") + "</div>" +
"<h3>" + (win? "辯論勝利！": "雖敗猶榮！") + "</h3>" +
(userScore!= null
? '<p class="desc">你 ' + userScore + " 分 · AI " + aiScore + " 分</p>"
: "") +
(comment? '<p class="desc">💬 裁判評語：' + Dawn.esc(comment) + "</p>": "") +
'<p class="desc">' + (win? "獲得星砂 ×20 🪙": "獲得記憶微粒 ×5 安慰獎") + "</p>" +
'<div class="btn-row"><button class="btn primary" id="debAgain">再辯一場</button></div>';
el.appendChild(card);
card.querySelector("#debAgain").onclick = () => window.Debate.enter();
}

window.Debate = {
enter() {
try {
const el = document.getElementById("debateBody");
if (!el) return;
if (st && st.timerId) clearInterval(st.timerId);
st = {
topicIdx: st && typeof st.topicIdx === "number"? st.topicIdx: 0,
customTopic: "", stance: "正方", opening: "",
topic: "", sid: "", online: false, rounds: [], roundIdx: 0,
userChars: 0, ended: false, timerId: null, lastScore: null, _winner: null,
};
renderSetup(el);
} catch (e) {
Dawn.toast("辯論台載入失敗");
console.warn("[Debate]", e);
}
},
};
})();

