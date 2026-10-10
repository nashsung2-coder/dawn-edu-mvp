/* 曙光教育 3.0 — SWR 快取層
 * 四態：fresh / stale（先渲染舊資料+背景更新）/ revalidating-error / no-cache
 * 「顯示舊資料+更新中」是誠實的；全頁 error 是趕客。
 */

import { RESOURCE_TTL, LS_PREFIX } from "./config.js";

const mem = new Map(); // {key: {v, data, ts}}

function lsKey(key) { return `${LS_PREFIX}swr:${key}`; }

function ttlFor(key) {
  for (const [prefix, ttl] of Object.entries(RESOURCE_TTL)) {
    if (prefix !== "default" && key.startsWith(prefix)) return ttl;
  }
  return RESOURCE_TTL.default;
}

function readLS(key) {
  try {
    const raw = localStorage.getItem(lsKey(key));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeLS(key, entry) {
  try {
    localStorage.setItem(lsKey(key), JSON.stringify(entry));
  } catch {
    // 配額爆了：丟最舊的 SWR 條目（auth/outbox 永不丟）
    evictOldest();
    try { localStorage.setItem(lsKey(key), JSON.stringify(entry)); } catch { /* 放棄 */ }
  }
}

function evictOldest() {
  let oldest = null, oldestTs = Infinity;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(`${LS_PREFIX}swr:`)) continue;
    try {
      const e = JSON.parse(localStorage.getItem(k));
      if (e.ts < oldestTs) { oldestTs = e.ts; oldest = k; }
    } catch { /* skip */ }
  }
  if (oldest) localStorage.removeItem(oldest);
}

export function get(key) {
  if (mem.has(key)) return mem.get(key);
  const e = readLS(key);
  if (e) mem.set(key, e);
  return e || null;
}

export function set(key, data) {
  const entry = { v: 1, data, ts: Date.now() };
  mem.set(key, entry);
  writeLS(key, entry);
}

/* 回傳 {state, data}，state ∈ fresh|stale|missing */
export function peek(key) {
  const e = get(key);
  if (!e) return { state: "missing", data: null };
  const age = Date.now() - e.ts;
  return age <= ttlFor(key)
    ? { state: "fresh", data: e.data }
    : { state: "stale", data: e.data };
}

export function invalidate(keys) {
  for (const key of keys) {
    mem.delete(key);
    try { localStorage.removeItem(lsKey(key)); } catch { /* ignore */ }
  }
}

/* 依 INVALIDATION_MAP：寫入路徑 → 失效哪些快取鍵前綴 */
export function invalidateForPath(path, map) {
  const hit = [];
  for (const [pattern, keys] of Object.entries(map)) {
    const re = new RegExp("^" + pattern.replace(/:[^/]+/g, "[^/]+") + "$");
    if (re.test(path)) hit.push(...keys);
  }
  if (hit.length) invalidate(hit);
  return hit;
}
