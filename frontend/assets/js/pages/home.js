/* 首頁：純入口。不做 overlay，不攔截點擊。
 * v3.1：移除 Render 後端健康檢查（已遷移到 Supabase 直連）。
 */
import { announce } from "../core/a11y.js";

/* PWA：註冊 Service Worker */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

/* 記住裝置選擇：進了哪個版本就記下來，下次直接進 */
try {
  var p = location.pathname;
  if (p.indexOf('desktop.html') !== -1) localStorage.setItem('dawn.device', 'desktop');
  else if (p.indexOf('mobile.html') !== -1) localStorage.setItem('dawn.device', 'mobile');
} catch (e) {}
