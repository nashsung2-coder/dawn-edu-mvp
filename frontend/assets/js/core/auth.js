/* 曙光教育 3.0 — 會話管理
 * Token 存記憶體 + localStorage 持久化（重新整理、開新分頁都不會掉）。
 * 分頁間用 sync 廣播「已登入」狀態，不傳 token 本體。
 */

import { API_BASE, API_PREFIX, LS_PREFIX } from "./config.js";

let memToken = null;
const LS_KEY = `${LS_PREFIX}auth-token`;

export function getToken() {
  if (memToken) return memToken;
  try { memToken = localStorage.getItem(LS_KEY); } catch { /* ignore */ }
  return memToken;
}

export function setToken(token) {
  memToken = token;
  try { localStorage.setItem(LS_KEY, token); } catch { /* ignore */ }
  // 清掉舊的 sessionStorage（遷移）
  try { sessionStorage.removeItem(`${LS_PREFIX}session-token`); } catch { /* ignore */ }
}

export function clearAuth() {
  memToken = null;
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(`${LS_PREFIX}session-token`); } catch { /* ignore */ }
  // 清掉跟使用者綁定的快取（保留匿名可用的 contents/tags）
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${LS_PREFIX}swr:`)
        && /auth:me|game:state|favorites|badges|mastery/.test(k)) {
        localStorage.removeItem(k);
      }
    }
  } catch { /* ignore */ }
}

export function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function isLoggedIn() { return !!getToken(); }

/* 靜默恢復：新分頁開啟時呼叫，確認會話有效 */
export async function restoreSession() {
  if (!getToken()) return null;
  try {
    const res = await fetch(API_BASE + API_PREFIX + "/auth/me", {
      headers: authHeaders(),
    });
    if (!res.ok) { clearAuth(); return null; }
    return await res.json();
  } catch { return null; }
}
