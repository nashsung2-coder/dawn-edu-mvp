/* 探索冒險：視覺小說風劇情探索（參照原神劇情演出）
 * 區域大卡片 → 場景圖＋對話框 → 樂觀選項回饋 → 時間線足跡 → 獎勵彈出
 * v4.0：直讀 Supabase（公開知識庫＝探索區域）＋ Worker LLM 生成劇情，不再經 Render 後端
 * 生命週期：init → loading → api → render / empty / error
 */
import { supabase, getUser } from "../core/supabase.js";
import { chat } from "../core/llm.js";
import { isLoggedIn } from "../core/auth.js";
import { announce, focusMain } from "../core/a11y.js";

const view = document.getElementById("x-view");
const userline = document.getElementById("x-userline");
const IMG = "../assets/img/game";
const HIST_KEY = "dawn:explore:history";
const TOTAL_STAGES = 3;

/* 區域名 → 場景圖（無封面時的備用圖） */
const ZONE_IMG = [
  "zone-mist.webp",
  "zone-abyss.webp",
  "zone-desert.webp",
];
function zoneImg(name, coverUrl, idx) {
  if (coverUrl) return coverUrl;
  const f = ZONE_IMG[(idx ?? 0) % ZONE_IMG.length];
  return `${IMG}/${f}?v=3.0.0`;
}

function extractJson(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}") + 1;
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end));
  } catch (e) {}
  return null;
}

/* 注入視覺小說風樣式（只用裸名 token） */
function ensureStyle() {
  if (document.getElementById("x-vn-style")) return;
  const st = document.createElement("style");
  st.id = "x-vn-style";
  st.textContent = `
.x-zone-cards{display:grid;gap:var(--sp-5);margin:var(--sp-6) 0}
.x-zcard{border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;background:var(--card);cursor:pointer;transition:transform .25s var(--ease),box-shadow .25s var(--ease);text-align:left;width:100%;padding:0;color:inherit;font:inherit}
.x-zcard:hover,.x-zcard:focus-visible{transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,0,0,.18);outline:2px solid var(--accent);outline-offset:2px}
.x-zcard img{width:100%;height:190px;object-fit:cover;display:block}
.x-zcard-body{padding:var(--sp-5)}
.x-zcard-body h3{font-size:var(--fs-20);margin-bottom:var(--sp-2)}
.x-zcard-body p{color:var(--muted);font-size:var(--fs-14);margin-bottom:var(--sp-3)}
.x-zcard-cta{display:inline-block;font-size:var(--fs-14);font-weight:700;color:var(--accent)}
.x-scene{position:relative;border-radius:var(--r-lg);overflow:hidden;margin-bottom:var(--sp-5);border:1px solid var(--line)}
.x-scene img{width:100%;height:220px;object-fit:cover;display:block}
.x-scene-cap{position:absolute;left:0;right:0;bottom:0;padding:var(--sp-4) var(--sp-5);background:linear-gradient(transparent,rgba(0,0,0,.65));color:#fff;font-size:var(--fs-13)}
.x-dialog{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);padding:var(--sp-6);margin-bottom:var(--sp-5)}
.x-dialog h2{font-size:var(--fs-20);margin-bottom:var(--sp-3)}
.x-dialog .x-text{font-size:var(--fs-16);line-height:1.9;white-space:pre-wrap}
.x-note{background:var(--bg-soft);border:1px dashed var(--accent);border-radius:var(--r-md);padding:var(--sp-4);margin-bottom:var(--sp-6);font-size:var(--fs-13)}
.x-note b{color:var(--accent)}
.x-choice{display:block;width:100%;text-align:left;padding:var(--sp-5);margin-bottom:var(--sp-3);border:2px solid var(--line);border-radius:var(--r-md);background:var(--card);font-size:var(--fs-15);line-height:1.6;cursor:pointer;transition:border-color .15s var(--ease),background .15s var(--ease),transform .15s var(--ease)}
.x-choice:hover{border-color:var(--accent);background:var(--bg-soft);transform:translateX(6px)}
.x-choice:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.x-choice.picked{border-color:var(--accent);background:var(--bg-soft);opacity:.75}
.x-choice:disabled{cursor:default}
.x-stages{display:flex;gap:var(--sp-3);justify-content:center;align-items:center;margin-bottom:var(--sp-6)}
.x-dot{width:14px;height:14px;border-radius:50%;border:2px solid var(--line);transition:all .3s var(--ease)}
.x-dot.done{background:var(--accent);border-color:var(--accent)}
.x-dot.now{border-color:var(--accent);box-shadow:0 0 0 4px var(--bg-soft);transform:scale(1.25)}
.x-timeline{list-style:none;margin:var(--sp-4) 0;padding:0;text-align:left}
.x-timeline li{position:relative;padding:0 0 var(--sp-4) var(--sp-7);border-left:2px solid var(--line)}
.x-timeline li:last-child{border-left-color:transparent}
.x-timeline li::before{content:"";position:absolute;left:-7px;top:2px;width:12px;height:12px;border-radius:50%;background:var(--accent)}
.x-timeline .x-tl-stage{font-size:var(--fs-12);color:var(--muted)}
.x-timeline .x-tl-choice{font-size:var(--fs-14);margin-top:2px}
@keyframes x-pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.12);opacity:1}100%{transform:scale(1);opacity:1}}
.x-reward-pop{animation:x-pop .5s var(--ease) both}
.x-reward-big{font-size:var(--fs-32);font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums}
.x-flash{animation:x-flash .4s var(--ease)}
@keyframes x-flash{0%{opacity:.2}100%{opacity:1}}`;
  document.head.appendChild(st);
}

function skeleton() {
  view.innerHTML = `<div class="skeleton" style="height:220px;border-radius:var(--r-lg)"></div>
    <div class="skeleton" style="height:120px;margin-top:12px;border-radius:var(--r-lg)"></div>
    <div class="skeleton" style="height:20px;margin-top:12px"></div>`;
}
function errorView(msg, retry) {
  view.innerHTML = `<div class="state-error">
    <img src="../assets/img/empty-error.webp?v=3.0.0" alt="燈籠插圖">
    <p>${escapeHtml(msg)}</p>
    <button class="btn btn-primary" id="x-retry">重試</button></div>`;
  document.getElementById("x-retry").onclick = retry;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function stageBar(stage, total) {
  if (!total || total < 1) return "";
  let dots = "";
  for (let i = 0; i < total; i++) {
    dots += `<span class="x-dot ${i < stage ? "done" : i === stage ? "now" : ""}" aria-hidden="true"></span>`;
  }
  return `<div class="x-stages" role="img" aria-label="探索進度：第 ${stage + 1} 幕，共 ${total} 幕">${dots}</div>`;
}

/* 探索紀錄（localStorage 簡化版） */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveHistory(entry) {
  try {
    const arr = loadHistory();
    arr.unshift(entry);
    localStorage.setItem(HIST_KEY, JSON.stringify(arr.slice(0, 20)));
  } catch (e) {}
}

/* 探索中的狀態（記憶體） */
let EXP = null;

/* ---- 著陸：區域大卡片 + 探索紀錄 ---- */
async function renderLanding() {
  skeleton();
  let zones = [];
  try {
    const { data, error } = await supabase
      .from("libraries")
      .select("id, title, description, cover_url")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    zones = data || [];
  } catch (e) {
    console.warn("[explore] libraries failed:", e.message);
  }
  const history = loadHistory();

  const zoneHtml = zones.length
    ? `<div class="x-zone-cards">` + zones.map((z, i) => {
        const name = z.title || "未知區域";
        const img = zoneImg(name, z.cover_url, i);
        return `<button class="x-zcard x-go" data-zone-id="${escapeHtml(z.id)}" data-zone="${escapeHtml(name)}" aria-label="前往${escapeHtml(name)}">
          <img src="${escapeHtml(img)}" alt="${escapeHtml(name)}場景" loading="lazy">
          <span class="x-zcard-body">
            <h3>${escapeHtml(name)}</h3>
            <p>${escapeHtml(z.description || "")}</p>
            <span class="x-zcard-cta">${TOTAL_STAGES} 幕劇情 → 啟程</span>
          </span>
        </button>`;
      }).join("") + `</div>`
    : `<div class="state-empty">
        <img src="../assets/img/empty-zen.webp?v=3.0.0" alt="空卷軸插圖">
        <p>目前沒有可探索的區域</p></div>`;

  const histHtml = history.length
    ? `<div class="x-history"><h2>探索紀錄</h2>` + history.slice(0, 10).map(h => `
        <div class="x-hrow">
          <span>${escapeHtml(h.zone || "未知區域")}</span>
          <span>${h.status === "done" ? "完成" : escapeHtml(h.status || "")} · ${escapeHtml((h.created_at || "").slice(0, 10))}</span>
        </div>`).join("") + `</div>`
    : "";

  view.innerHTML = `<div class="x-landing">
    <h2>啟程</h2>
    <p>選一個知識庫出發。每個選擇都會引向不同的劇情——<br>沒有標準答案，只有屬於你的冒險。</p>
    </div>${zoneHtml}${histHtml}`;

  view.querySelectorAll(".x-go").forEach(btn => {
    btn.onclick = () => startExplore(btn.dataset.zoneId, btn.dataset.zone);
  });
  focusMain();
}

/* ---- LLM：生成劇情幕 ---- */
async function genStage(zoneName, nodesText, stage, prevChoice) {
  const sysPrompt = "你是視覺小說編劇。學生正在探索一個以真實知識為背景的區域，" +
    "請寫一段 150 字內的劇情（繁體中文，有畫面感），並給 3 個劇情選項、" +
    "一句旅行者筆記（把劇情裡出現的知識點出來，60字內）。" +
    "回傳 JSON：{\"title\": \"本幕標題\", \"text\": \"劇情\", " +
    "\"choices\": [\"選項1\", \"選項2\", \"選項3\"], \"hint\": \"旅行者筆記\"}。只回 JSON。";
  const userPrompt = prevChoice == null
    ? `區域：${zoneName}\n背景知識：${nodesText.slice(0, 1500)}\n這是第 1 幕（開場），請引出冒險。`
    : `區域：${zoneName}\n背景知識：${nodesText.slice(0, 1500)}\n` +
      `這是第 ${stage + 1} 幕。上一幕學生選擇了：「${prevChoice}」。請延續劇情推進。`;
  const out = await chat(
    [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
    { temperature: 0.8, maxTokens: 900 }
  );
  const parsed = extractJson(out);
  if (parsed && parsed.text && Array.isArray(parsed.choices) && parsed.choices.length) {
    return {
      title: String(parsed.title || "劇情").slice(0, 60),
      text: String(parsed.text).slice(0, 600),
      choices: parsed.choices.slice(0, 3).map(c => String(c).slice(0, 80)),
      hint: String(parsed.hint || "").slice(0, 120),
    };
  }
  // 降級：通用劇情
  return {
    title: `第 ${stage + 1} 幕`,
    text: `你踏入了「${zoneName}」。空氣中瀰漫著未知的氣息，前方有三條路——每條都通往不同的發現。`,
    choices: ["往光亮處走", "往幽深處走", "先觀察四周再決定"],
    hint: "旅行者筆記：保持好奇，每個選擇都是學習。",
  };
}

/* ---- 開始探索 ---- */
async function startExplore(libraryId, zoneName) {
  skeleton();
  announce(`啟程前往${zoneName}`);
  try {
    let nodesText = "";
    try {
      const { data } = await supabase
        .from("knowledge_nodes")
        .select("title, content")
        .eq("library_id", libraryId)
        .limit(10);
      nodesText = (data || []).map(n => `${n.title}：${(n.content || "").slice(0, 300)}`).join("\n");
    } catch (e) { console.warn("[explore] nodes failed:", e.message); }
    if (!nodesText) nodesText = `「${zoneName}」知識庫`;

    const first = await genStage(zoneName, nodesText, 0, null);
    EXP = { libraryId, zoneName, stage: 0, trail: [], nodesText };
    renderStory(first);
  } catch (e) {
    errorView(`啟程失敗：${e.message}`, () => startExplore(libraryId, zoneName));
  }
}

/* ---- 劇情：場景圖 + 對話框 + 選項 ---- */
function renderStory(cur) {
  EXP.current = cur;
  const stage = EXP.stage;
  const zoneName = EXP.zoneName;
  const choices = cur.choices || [];
  const hint = cur.hint || "";
  const img = zoneImg(zoneName, null, 0);

  view.innerHTML = `${stageBar(stage, TOTAL_STAGES)}
    <div class="x-scene">
      <img src="${escapeHtml(img)}" alt="${escapeHtml(zoneName)}場景">
      <div class="x-scene-cap">${escapeHtml(zoneName)} · 第 ${stage + 1} 幕</div>
    </div>
    <div class="x-dialog x-flash">
      <h2>${escapeHtml(cur.title || "劇情")}</h2>
      <p class="x-text">${escapeHtml(cur.text || "")}</p>
    </div>
    ${hint ? `<div class="x-note"><b>📓 旅行者筆記：</b>${escapeHtml(hint)}</div>` : ""}
    <div class="x-choices" role="group" aria-label="劇情選項">
      ${choices.map((c, i) =>
        `<button class="x-choice" data-i="${i}"><span aria-hidden="true">▸ </span>${escapeHtml(String(c))}</button>`).join("")}
    </div>
    <button class="btn btn-ghost" id="x-back" style="margin-top:12px">← 返回區域列表</button>`;

  view.querySelectorAll(".x-choice").forEach(btn => {
    btn.onclick = () => choose(+btn.dataset.i, btn);
  });
  document.getElementById("x-back").onclick = () => { EXP = null; renderLanding(); };
  focusMain();
}

/* ---- 劇情選擇：樂觀回饋 ---- */
async function choose(index, btn) {
  const all = view.querySelectorAll(".x-choice");
  all.forEach(b => { b.disabled = true; });
  btn.classList.add("picked");
  const label = btn.textContent.trim();
  announce(`選擇了：${label}，劇情推進中`);
  const fb = document.createElement("p");
  fb.className = "x-note";
  fb.innerHTML = `<b>已選擇：</b>${escapeHtml(label)} —— 劇情推進中…`;
  btn.parentElement.after(fb);

  try {
    const cur = EXP.current || {};
    EXP.trail.push({ stage: EXP.stage, title: cur.title || "", choice: label });
    EXP.stage += 1;
    if (EXP.stage >= TOTAL_STAGES) {
      await renderDone();
    } else {
      const next = await genStage(EXP.zoneName, EXP.nodesText, EXP.stage, label);
      renderStory(next);
    }
  } catch (e) {
    all.forEach(b => { b.disabled = false; b.classList.remove("picked"); });
    fb.remove();
    EXP.stage -= 1;
    EXP.trail.pop();
    announce(`選擇失敗：${e.message}，請再試一次`);
  }
}

/* ---- 完成：時間線足跡 + 獎勵彈出 ---- */
async function renderDone() {
  const zone = EXP.zoneName;
  const trail = EXP.trail || [];
  const rewardStarsand = 20;

  // 發放星砂獎勵
  let rewardOk = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase.rpc("transfer_starsand", {
        p_user_id: user.id,
        p_amount: rewardStarsand,
        p_reason: `探索完成：${zone}`,
      });
      if (error) throw error;
    }
  } catch (e) {
    console.warn("[explore] reward failed:", e.message);
    rewardOk = false;
  }
  saveHistory({ zone, status: "done", created_at: new Date().toISOString() });

  view.innerHTML = `<div class="x-done">
    <h2>探索完成</h2>
    <p class="x-zone-tag">${escapeHtml(zone || "")}</p>
    ${trail.length ? `<h3 style="text-align:left;margin-top:var(--sp-6)">你的足跡</h3>
      <ol class="x-timeline">` +
      trail.map(t => `<li>
        <div class="x-tl-stage">第 ${t.stage + 1} 幕 · ${escapeHtml(t.title || "")}</div>
        <div class="x-tl-choice">▸ ${escapeHtml(t.choice || "")}</div>
      </li>`).join("") + `</ol>` : ""}
    <div class="card x-reward x-reward-pop">
      <h3>獲得獎勵</h3>
      ${rewardOk
        ? `<p><span class="x-reward-big">✨ +${rewardStarsand}</span><br><span>星砂</span></p>`
        : "<p>這次沒有額外獎勵，但收穫了故事。</p>"}
    </div>
    <div style="margin-top:16px">
      <button class="btn btn-primary" id="x-again">再探一處</button>
      <a class="btn btn-ghost" href="bookshelf.html" style="margin-left:8px">去書架看看</a>
    </div>
  </div>`;

  announce(`探索完成，獲得 ${rewardOk ? rewardStarsand + " 星砂" : "故事"}`);
  document.getElementById("x-again").onclick = () => { EXP = null; renderLanding(); };
  focusMain();
}

/* ---- 啟動 ---- */
(async function init() {
  ensureStyle();
  if (!isLoggedIn()) {
    view.innerHTML = `<div class="state-empty">
      <p>請先登入再開始探索冒險</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    userline.textContent = "未登入";
    return;
  }
  try {
    const user = await getUser();
    userline.textContent = user ? `旅人 ${user.user_metadata?.name || user.email?.split("@")[0] || ""} · 歡迎回來` : "旅人";
  } catch { userline.textContent = "旅人"; }
  renderLanding();
})();
