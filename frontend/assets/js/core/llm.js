/* 曙光教育 3.0 — LLM 直連模組
 * 經 Cloudflare Worker 代理呼叫 NVIDIA NIM（OpenAI 相容格式）
 * 取代後端轉發，減少 Render 冷啟動延遲
 * Worker: https://dawn-llm-proxy.nashsung2.workers.dev
 */

const WORKER_URL = "https://dawn-llm-proxy.nashsung2.workers.dev";
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const TIMEOUT_MS = 60000;

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

/**
 * 呼叫 LLM（非串流，一次回傳完整內容）
 * @param {Array<{role:string,content:string}>} messages - 對話訊息
 * @param {object} opts - { model, temperature, maxTokens, timeout }
 * @returns {Promise<string>} - AI 回覆的文字內容
 */
export async function chat(messages, opts = {}) {
  const { signal, done } = withTimeout(opts.timeout || TIMEOUT_MS);
  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2000,
      }),
    });
    done();
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM 請求失敗 (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM 回傳格式異常");
    return content;
  } catch (err) {
    done();
    if (err.name === "AbortError") throw new Error("AI 回應超時，請再試一次");
    throw err;
  }
}

/**
 * 簡單問答（單輪）
 * @param {string} systemPrompt - 系統提示詞
 * @param {string} userPrompt - 使用者提問
 * @param {object} opts - 同 chat 的 opts
 * @returns {Promise<string>}
 */
export async function ask(systemPrompt, userPrompt, opts = {}) {
  return chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    opts
  );
}
