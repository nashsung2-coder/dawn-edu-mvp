/* 首頁：純入口。冷啟動探測 + 問候。不做 overlay，不攔截點擊。 */
import { probeHealth } from "../core/api.js";
import { announce } from "../core/a11y.js";

/* 冷啟動：背景探測，醒了才顯示內容，避免全站 error */
(async () => {
  const ok = await probeHealth();
  if (!ok) {
    announce("伺服器喚醒中，請稍候");
    // 每 5 秒重試，直到醒來
    const timer = setInterval(async () => {
      if (await probeHealth()) {
        clearInterval(timer);
        announce("伺服器已喚醒");
        location.reload();
      }
    }, 5000);
  }
})();
