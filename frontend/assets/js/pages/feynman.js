/* 費曼說服：用戶說服 AI → AI 反向提問 → 達標入個人課本
 * v4.0：直連 Cloudflare Worker（NVIDIA NIM），不再經 Render 後端
 */
import { chat } from "../core/llm.js";
import { isLoggedIn } from "../core/auth.js";
import { focusMain, toast } from "../core/a11y.js";
import { supabase } from "../core/supabase.js";

const view = document.getElementById("f-view");
let topic = "";
let round = 0;
let history = []; // [{explanation, score, feedback}]

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function extractJson(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}") + 1;
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end));
  } catch (e) {}
  return null;
}

/* 評估解釋完整度 */
async function evaluateExplanation(topic, explanation) {
  const out = await chat([
    { role: "system", content:
      "你是嚴格但友善的老師。學生要用自己的話解釋一個概念來說服你。" +
      "評估他的解釋完整度（0-100 分），用繁體中文回應。" +
      "回傳 JSON：{\"score\": 分數, \"feedback\": \"你的評價（100字內）\", " +
      "\"followup\": \"如果沒滿分，問一個能引導他補足缺口的追問（50字內）\", " +
      "\"missing_points\": [\"缺失的要點1\", \"缺失的要點2\"]}。" +
      "只回 JSON，不要其他文字。" },
    { role: "user", content: `主題：${topic}\n學生的解釋：${explanation}` },
  ], { temperature: 0.3, maxTokens: 800 });

  const parsed = extractJson(out);
  if (parsed && typeof parsed.score === "number") return parsed;

  // 降級：啟發式評分
  let score = 40;
  if (explanation.length > 100) score += 10;
  if (explanation.length > 300) score += 10;
  if (/因為|所以|導致/.test(explanation)) score += 10;
  if (/例如|比如|舉例/.test(explanation)) score += 10;
  if (/但是|然而|相反/.test(explanation)) score += 5;
  return {
    score: Math.min(85, score),
    feedback: "你的解釋有基本架構，但還可以更深入。試著多講一點因果關係和具體例子。",
    followup: `關於「${topic}」，你能說說它為什麼會這樣運作嗎？`,
    missing_points: ["因果機制", "具體例子"],
  };
}

/* 生成課本條目 */
async function buildTextbookEntry(topic, explanation, evaluation) {
  const out = await chat([
    { role: "system", content:
      "你是課本編輯。學生用自己的話解釋了一個概念且通過了評估。" +
      "請用他的話為基礎，重新整理成結構清晰的課本條目，並補充相關數據或背景知識。" +
      "用繁體中文，回傳 JSON：{\"title\": \"標題\", " +
      "\"user_voice_summary\": \"用學生的話重整的核心解釋（200字內）\", " +
      "\"ai_supplement\": \"AI 補充的數據/背景（200字內）\", " +
      "\"key_points\": [\"要點1\", \"要點2\", \"要點3\"]}。" +
      "只回 JSON。" },
    { role: "user", content:
      `主題：${topic}\n學生的解釋：${explanation}\n評估缺失點：${(evaluation.missing_points || []).join("、")}` },
  ], { temperature: 0.5, maxTokens: 1000 });

  const parsed = extractJson(out);
  if (parsed && parsed.title) return parsed;
  return {
    title: topic,
    user_voice_summary: explanation.slice(0, 500),
    ai_supplement: "（AI 補充功能暫時不可用）",
    key_points: evaluation.missing_points || [],
  };
}

/* 存入個人課本（Supabase） */
async function saveToBookshelf(topic, entry) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("textbook_entries").insert({
      user_id: user.id,
      topic,
      title: entry.title,
      user_voice_summary: entry.user_voice_summary,
      ai_supplement: entry.ai_supplement,
      key_points: entry.key_points,
    });
  } catch (e) {
    console.warn("存入課本失敗:", e);
  }
}

/* 生成應用挑戰 */
async function generateAppChallenge(topic, explanation) {
  const out = await chat([
    { role: "system", content:
      "你是學習設計師。學生剛學了一個概念，請設計一個小情境應用題，" +
      "讓他把剛學的知識用出來。題目要具體、有趣、貼近生活。" +
      "用繁體中文，回傳 JSON：{\"scenario\": \"情境描述（100字內）\", " +
      "\"task\": \"要完成的任務（50字內）\", " +
      "\"hints\": [\"提示1\", \"提示2\"]}。" +
      "只回 JSON。" },
    { role: "user", content: `主題：${topic}\n學生的理解：${explanation.slice(0, 500)}` },
  ], { temperature: 0.7, maxTokens: 600 });

  const parsed = extractJson(out);
  if (parsed && parsed.scenario) return parsed;
  return {
    scenario: `想像你要向一個完全沒聽過「${topic}」的朋友解釋它，你會怎麼說？`,
    task: "用生活中的例子，把這個概念講清楚。",
    hints: ["想想這個概念在哪裡出現過", "用比喻會更容易理解"],
  };
}

function renderStart() {
  const params = new URLSearchParams(location.search);
  const presetTopic = params.get("topic") || "";

  view.innerHTML = `
    <div class="card" style="padding:24px;max-width:600px;margin:0 auto">
      <h2 style="margin-top:0">說服 AI，你真的懂了</h2>
      <p style="color:var(--muted)">用你自己的話解釋一個概念，說服 AI 你真的理解了。
      如果 AI 覺得不完整，會反向提問；達標後，AI 會用你的話整理成課本條目，存入你的個人課本。</p>
      <input id="f-topic" type="text" placeholder="要解釋的主題，如：光合作用"
        value="${escapeHtml(presetTopic)}"
        style="width:100%;padding:12px;margin:12px 0;font-size:15px" aria-label="主題">
      <button class="btn btn-primary" id="f-start" style="width:100%">開始挑戰</button>
    </div>`;
  document.getElementById("f-start").onclick = async () => {
    const t = document.getElementById("f-topic").value.trim();
    if (!t) { toast("請輸入主題"); return; }
    topic = t;
    round = 0;
    history = [];
    renderChallenge(`用你自己的話解釋「${t}」，說服我你真的懂了。越具體越好，舉例子更好。`);
  };
  focusMain();
}

function renderChallenge(prompt) {
  view.innerHTML = `
    <div class="card" style="padding:24px;max-width:600px;margin:0 auto">
      <p style="font-size:13px;color:var(--muted)">主題：${escapeHtml(topic)}</p>
      <p style="font-size:15px;margin:12px 0">${escapeHtml(prompt)}</p>
      <textarea id="f-explain" rows="8" placeholder="在這裡寫下你的解釋…"
        style="width:100%;padding:12px;font-size:15px" aria-label="你的解釋"></textarea>
      <button class="btn btn-primary" id="f-submit" style="width:100%;margin-top:12px">提交，說服 AI</button>
      <div id="f-result" style="margin-top:16px"></div>
    </div>`;
  document.getElementById("f-submit").onclick = submitExplanation;
  focusMain();
}

async function submitExplanation() {
  const text = document.getElementById("f-explain").value.trim();
  if (text.length < 20) { toast("解釋太短了，再多講一點"); return; }
  const btn = document.getElementById("f-submit");
  btn.disabled = true; btn.textContent = "AI 評估中…（約需 15 秒）";
  try {
    round++;
    const evaluation = await evaluateExplanation(topic, text);
    history.push({ explanation: text, score: evaluation.score, feedback: evaluation.feedback });
    const passed = evaluation.score >= 80;
    let textbookEntry = null;
    if (passed) {
      textbookEntry = await buildTextbookEntry(topic, text, evaluation);
      await saveToBookshelf(topic, textbookEntry);
    }
    renderResult({ ...evaluation, passed, round, textbook_entry: textbookEntry });
  } catch (e) {
    toast(e.message || "AI 回應失敗，請再試一次");
    btn.disabled = false; btn.textContent = "提交，說服 AI";
  }
}

function renderResult(r) {
  const box = document.getElementById("f-result");
  const passed = r.passed;

  box.innerHTML = `
    <div style="padding:16px;background:var(--surface);border-radius:12px;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong>第 ${r.round} 輪</strong>
        <span style="font-size:20px;font-weight:800;color:${passed ? "var(--accent)" : "var(--muted)"}">${r.score} 分</span>
      </div>
      <p style="white-space:pre-wrap">${escapeHtml(r.feedback)}</p>
      ${r.followup ? `
        <div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:8px">
          <strong>AI 追問：</strong>${escapeHtml(r.followup)}
        </div>` : ""}
      ${passed && r.textbook_entry ? `
        <div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:8px">
          <strong>已存入個人課本</strong>
          <p style="font-size:14px;margin:8px 0"><strong>${escapeHtml(r.textbook_entry.title || "")}</strong></p>
          <p style="font-size:13px;color:var(--muted)">${escapeHtml((r.textbook_entry.user_voice_summary || "").slice(0, 200))}…</p>
          <a href="bookshelf.html" class="btn btn-ghost" style="margin-top:8px;font-size:13px">去看我的課本</a>
        </div>
        <div style="margin-top:12px">
          <button class="btn btn-ghost" id="f-app-challenge" style="font-size:13px">來個應用挑戰</button>
          <div id="f-app-box" style="margin-top:8px"></div>
        </div>` : ""}
      ${!passed ? `
        <textarea id="f-explain2" rows="6" placeholder="根據 AI 的追問，繼續補充你的解釋…"
          style="width:100%;padding:12px;font-size:15px;margin-top:12px" aria-label="繼續解釋"></textarea>
        <button class="btn btn-primary" id="f-submit2" style="width:100%;margin-top:8px">再試一次</button>` : `
        <button class="btn btn-primary" id="f-again" style="width:100%;margin-top:12px">挑戰新主題</button>`}
    </div>`;

  if (!passed) {
    document.getElementById("f-submit2").onclick = async () => {
      const text = document.getElementById("f-explain2").value.trim();
      if (text.length < 20) { toast("再多講一點"); return; }
      const b = document.getElementById("f-submit2");
      b.disabled = true; b.textContent = "AI 評估中…";
      // 把追問上下文帶入
      const combined = history.map(h => h.explanation).join("\n\n") + "\n\n補充：" + text;
      try {
        round++;
        const evaluation = await evaluateExplanation(topic, combined);
        history.push({ explanation: text, score: evaluation.score, feedback: evaluation.feedback });
        const passed2 = evaluation.score >= 80;
        let entry2 = null;
        if (passed2) {
          entry2 = await buildTextbookEntry(topic, combined, evaluation);
          await saveToBookshelf(topic, entry2);
        }
        renderChallenge(`繼續說服我關於「${topic}」——上一輪得了 ${evaluation.score} 分`);
        renderResult({ ...evaluation, passed: passed2, round, textbook_entry: entry2 });
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = "再試一次"; }
    };
  } else {
    document.getElementById("f-again").onclick = () => { renderStart(); };
  }

  const appBtn = document.getElementById("f-app-challenge");
  if (appBtn) {
    appBtn.onclick = async () => {
      appBtn.disabled = true; appBtn.textContent = "生成中…";
      try {
        const lastExplain = history.length ? history[history.length - 1].explanation : "";
        const c = await generateAppChallenge(topic, lastExplain);
        document.getElementById("f-app-box").innerHTML = `
          <div style="padding:12px;background:var(--surface);border-radius:8px;margin-top:8px">
            <strong>情境：</strong><p style="font-size:14px">${escapeHtml(c.scenario || "")}</p>
            <strong>任務：</strong><p style="font-size:14px">${escapeHtml(c.task || "")}</p>
            ${(c.hints || []).length ? `<p style="font-size:12px;color:var(--muted)">提示：${c.hints.map(escapeHtml).join(" / ")}</p>` : ""}
          </div>`;
      } catch (e) { toast(e.message); }
      appBtn.disabled = false; appBtn.textContent = "再來一個";
    };
  }
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

(function init() {
  if (!isLoggedIn()) {
    view.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">
      <p>請先登入再使用費曼說服</p>
      <a class="btn btn-primary" href="settings.html">去登入</a></div>`;
    return;
  }
  renderStart();
})();
