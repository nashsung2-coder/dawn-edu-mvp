/* 曙光教育 3.0 — 無障礙 helper
 * focus 管理 / aria-live 播報 / 減少動態偏好
 */

/* 跨頁導覽後：把 focus 移到 main 的 h1（螢幕閱讀器才知道換頁了） */
export function focusMain() {
  const h1 = document.querySelector("main h1");
  if (h1) {
    h1.setAttribute("tabindex", "-1");
    h1.focus({ preventScroll: true });
  }
}

/* 單例 aria-live 播報器（錯誤訊息、toast 都走這裡） */
let liveEl = null;
export function announce(msg, priority = "polite") {
  if (!liveEl) {
    liveEl = document.createElement("div");
    liveEl.setAttribute("aria-live", priority);
    liveEl.setAttribute("role", "status");
    liveEl.style.cssText =
      "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);";
    document.body.appendChild(liveEl);
  }
  liveEl.textContent = "";
  requestAnimationFrame(() => { liveEl.textContent = msg; });
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* 對話框 focus trap（簡版） */
export function trapFocus(container) {
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  function onKey(e) {
    if (e.key !== "Tab") return;
    const items = [...container.querySelectorAll(sel)].filter(el => !el.disabled);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
  container.addEventListener("keydown", onKey);
  return () => container.removeEventListener("keydown", onKey);
}

/* 輕提示 toast（共用） */
export function toast(msg) {
  let root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    root.setAttribute("aria-live", "polite");
    root.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center";
    document.body.appendChild(root);
  }
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  el.style.cssText = "background:#333;color:#fff;padding:10px 18px;border-radius:999px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.25);animation:toastIn .25s ease";
  root.appendChild(el);
  announce(msg);
  setTimeout(() => el.remove(), 3200);
}
