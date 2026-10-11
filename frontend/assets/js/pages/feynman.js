/* 費曼說服：用戶說服 AI → AI 反向提問 → 達標入個人課本 */
import { get, post } from "../core/api.js";
import { isLoggedIn } from "../core/auth.js";
import { focusMain, toast } from "../core/a11y.js";

const view = document.getElementById("f-view");
let sessionId = null;
let topic = "";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderStart() {
  // 從 URL 取主題（圖書館可帶入）
  const params = new URLSearchParams(location.search);
  const presetTopic = params.get("topic") || "";
  const libId = params.get("lib") || "";

  view.innerHTML = `
    <div class="card" style="padding:24px;max-width:600px;margin:0 auto">
      <h2 style="margin-top:0">說服 AI，你真的懂了</h2>
      <p style="color:var(--muted)">用你自己的話解釋一個概念，說服 AI 你真的理解了。
      如果 AI 覺得不完整，會反向提問；達標後，AI 會用你的話整理成課本條目，存入你的個人課本。</p>
      <input id="f-topic" type="text" placeholder="要解釋的主題，如：光合作用"
        value="${escapeHtml(presetTopic)}"
        style="width:100%;padding:12px;margin:12px 0;font-size:15px" aria-label="主題">
      <input id="f-lib" type="hidden" value="${escapeHtml(libId)}">
      <button class="btn btn-primary" id="f-start" style="width:100%">開始挑戰</button>
    </div>`;
  document.getElementById("f-start").onclick = async () => {
    const t = document.getElementById("f-topic").value.trim();
    if (!t) { toast("請輸入主題"); return; }
    try {
      const r = await post("/feynman/persuade", {
        topic: t, library_id: document.getElementById("f-lib").value });
      sessionId = r.session_id;
      topic = t;
      renderChallenge(r.prompt);
    } catch (e) { toast(e.message); }
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
  btn.disabled = true; btn.textContent = "AI 評估中…";
  try {
    const r = await post(`/feynman/persuade/${sessionId}`, { explanation: text });
    renderResult(r);
  } catch (e) {
    toast(e.message);
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
      <p style="white-space:pre-wrap">${escapeHtml(r.ai_says)}</p>
      ${r.followup_question ? `
        <div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:8px">
          <strong>AI 追問：</strong>${escapeHtml(r.followup_question)}
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
      try {
        const r2 = await post(`/feynman/persuade/${sessionId}`, { explanation: text });
        // 重新渲染整個挑戰區
        renderChallenge(`繼續說服我關於「${topic}」——上一輪得了 ${r.score} 分`);
        renderResult(r2);
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = "再試一次"; }
    };
  } else {
    document.getElementById("f-again").onclick = () => {
      sessionId = null; renderStart();
    };
  }

  // 應用挑戰
  const appBtn = document.getElementById("f-app-challenge");
  if (appBtn) {
    appBtn.onclick = async () => {
      appBtn.disabled = true; appBtn.textContent = "生成中…";
      try {
        const r2 = await post("/feynman/application-challenge", {
          topic, explanation: document.getElementById("f-explain")?.value || "" });
        const c = r2.challenge || {};
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
