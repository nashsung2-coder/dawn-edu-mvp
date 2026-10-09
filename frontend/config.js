/* ============================================================
 * 曙光教育智能系統 MVP · 部署設定
 *
 * 把 Render 後端的公開網址填進來，探究頁的搜尋就會優先打後端 API，
 * 失敗（或留空）時自動 fallback 用內嵌的 data.js 資料。
 *
 * 例如：
 *   window.DAWN_API_BASE = "https://dawn-edu-mvp.onrender.com";
 *
 * 注意：結尾不要加斜線。部署教學見 README-DEPLOY.md。
 * ============================================================ */
window.DAWN_API_BASE = "https://dawn-edu-mvp.onrender.com";
