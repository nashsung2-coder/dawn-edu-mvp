/* 曙光教育 3.0 — 唯一網路出口
 * 分層 timeout / 指數退避重試 / 九類錯誤分類 / 冪等寫入
 * 規則：pages/* 禁止直接 fetch，只能調這裡。
 */

import { API_BASE, API_PREFIX, TIMEOUTS, RETRY, INVALIDATION_MAP, LS_PREFIX } from "./config.js";
import { peek, set as cacheSet, invalidateForPath } from "./cache.js";
import { getToken, clearAuth, authHeaders } from "./auth.js";
import { broadcast } from "./sync.js";

class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;       // NETWORK|TIMEOUT|HTTP_400|HTTP_401|...|HTTP_5xx
    this.status = status;
  }
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

async function rawFetch(method, path, { body, timeout, idempotencyKey } = {}) {
  const { signal, done } = withTimeout(timeout);
  try {
    const headers = { "Content-Type": "application/json", ...authHeaders() };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await fetch(API_BASE + API_PREFIX + path, {
      method, signal, headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    done();
    if (res.status === 401) {
      clearAuth();
      broadcast({ type: "auth:logout" });
      location.href = "/pages/settings.html?reason=login";
      throw new ApiError("HTTP_401", "登入已過期，請重新登入", 401);
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      const code = res.status >= 500 ? "HTTP_5xx"
        : res.status === 429 ? "HTTP_429"
        : `HTTP_${res.status}`;
      throw new ApiError(code, msg.slice(0, 200) || `請求失敗 (${res.status})`, res.status);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (e) {
    done();
    if (e instanceof ApiError) throw e;
    if (e.name === "AbortError") throw new ApiError("TIMEOUT", "請求逾時", 0);
    throw new ApiError("NETWORK", "網路連線失敗", 0);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* GET 專用：指數退避重試（network/5xx/429） */
async function getWithRetry(path, opts) {
  let last;
  for (let i = 0; i < RETRY.maxAttempts; i++) {
    try {
      return await rawFetch("GET", path, { timeout: opts.timeout });
    } catch (e) {
      last = e;
      const retryable = e.code === "NETWORK" || e.code === "TIMEOUT"
        || e.code === "HTTP_5xx" || e.code === "HTTP_429";
      if (!retryable || i === RETRY.maxAttempts - 1) throw e;
      await sleep(RETRY.backoff[i] || 1500);
    }
  }
  throw last;
}

/* ---- 對外 API ---- */

/* SWR 讀取：回傳 {data, state, stale}，state ∈ fresh|stale|revalidating-error|no-cache */
export async function swr(cacheKey, path, { timeout = TIMEOUTS.interactive } = {}) {
  const { state, data } = peek(cacheKey);
  if (state === "fresh") return { data, state: "fresh", stale: false };

  // 背景 revalidate（stale 或 missing 都走這裡；missing 時呼叫方顯示骨架屏）
  try {
    const fresh = await getWithRetry(path, { timeout });
    cacheSet(cacheKey, fresh);
    return { data: fresh, state: "fresh", stale: false };
  } catch (e) {
    if (state === "stale") {
      return { data, state: "revalidating-error", stale: true, error: e };
    }
    throw e; // no-cache 且失敗 → 呼叫方顯示錯誤頁
  }
}

/* 直接 GET（不走快取，少用） */
export function get(path, opts) {
  return getWithRetry(path, { timeout: opts?.timeout || TIMEOUTS.interactive });
}

/* 寫入：不自動重試；冪等寫入帶 Idempotency-Key；成功後失效快取+廣播 */
export async function post(path, body, { idempotent = false } = {}) {
  const key = idempotent
    ? (crypto.randomUUID?.() || String(Date.now()) + Math.random())
    : undefined;
  const data = await rawFetch("POST", path, {
    body, timeout: TIMEOUTS.write, idempotencyKey: key,
  });
  const invalidated = invalidateForPath(path, INVALIDATION_MAP);
  if (invalidated.length) broadcast({ type: "cache:invalidate", keys: invalidated });
  return data;
}

export async function patch(path, body) {
  const data = await rawFetch("PATCH", path, { body, timeout: TIMEOUTS.write });
  const invalidated = invalidateForPath(path, INVALIDATION_MAP);
  if (invalidated.length) broadcast({ type: "cache:invalidate", keys: invalidated });
  return data;
}

export async function del(path) {
  const data = await rawFetch("DELETE", path, { timeout: TIMEOUTS.write });
  const invalidated = invalidateForPath(path, INVALIDATION_MAP);
  if (invalidated.length) broadcast({ type: "cache:invalidate", keys: invalidated });
  return data;
}

/* 冷啟動探測：打根路徑（注意：健康檢查是 GET /，不是 /api/v1/health） */
export async function probeHealth() {
  const { signal, done } = withTimeout(TIMEOUTS.health);
  try {
    const res = await fetch(API_BASE + "/", { signal });
    done();
    return res.ok;
  } catch { done(); return false; }
}

export { ApiError };
