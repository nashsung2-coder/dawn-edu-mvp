/* 曙光教育 3.0 — 跨頁同步
 * BroadcastChannel（同瀏覽器即時）+ storage 事件（跨 tab 備援）
 * 訊息：{type:'cache:invalidate', keys} / {type:'auth:logout'}
 */

import { LS_PREFIX } from "./config.js";
import { invalidate } from "./cache.js";

const BC_NAME = "dawn-sync";
let bc = null;
try { bc = new BroadcastChannel(BC_NAME); } catch { /* 不支援就只用 storage */ }

const handlers = new Set();

function handle(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "cache:invalidate" && Array.isArray(msg.keys)) {
    invalidate(msg.keys);
  }
  for (const h of handlers) {
    try { h(msg); } catch { /* ignore */ }
  }
}

if (bc) bc.onmessage = (e) => handle(e.data);

window.addEventListener("storage", (e) => {
  if (!e.key || !e.key.startsWith(`${LS_PREFIX}sync:`)) return;
  try { handle(JSON.parse(e.newValue)); } catch { /* ignore */ }
});

export function broadcast(msg) {
  if (bc) { try { bc.postMessage(msg); } catch { /* ignore */ } }
  // storage 備援（同 tab 不會觸發自己，靠 BC）
  try {
    localStorage.setItem(`${LS_PREFIX}sync:${Date.now()}`, JSON.stringify(msg));
  } catch { /* ignore */ }
}

export function onSync(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}
