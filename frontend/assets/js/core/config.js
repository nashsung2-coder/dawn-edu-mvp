/* 曙光教育 3.0 — 全站集中配置
 * 所有魔法數字只活在這裡。調參只改這個檔案。
 */

export const API_BASE = "https://dawn-edu-mvp.onrender.com";
export const API_PREFIX = "/api/v1";
export const ASSET_VERSION = "3.0.0";

/* 分層超時（毫秒） */
export const TIMEOUTS = {
  health: 10000,        // 冷啟動探測
  interactive: 8000,    // Tier 1：有快取的互動讀取
  firstLoad: 30000,     // Tier 2：首次無快取（總預算，含重試）
  write: 15000,         // 寫入：不自動重試
};

/* 重試：僅 GET + network/5xx/429，指數退避 */
export const RETRY = {
  maxAttempts: 3,       // 1 初次 + 2 重試
  backoff: [500, 1500],
};

/* SWR 快取 TTL（毫秒） */
export const RESOURCE_TTL = {
  "auth:me": 60_000,
  "game:state": 60_000,
  "world:market": 30_000,
  "world:explore": 30_000,
  "learn:badges": 300_000,
  "learn:mastery": 300_000,
  "contents": 600_000,
  "tags": 600_000,
  "radar": 300_000,
  "default": 60_000,
};

/* 寫入 → 失效快取鍵映射 */
export const INVALIDATION_MAP = {
  "/game/shop/buy": ["game:state"],
  "/game/earn": ["game:state"],
  "/game/use": ["game:state"],
  "/favorites": ["favorites:list"],
  "/learn/sessions/:sid/finish": ["learn:badges", "learn:mastery", "game:state"],
  "/auth/persona": ["auth:me"],
  "/world/market": ["world:market"],
};

/* localStorage key 前綴（含版本） */
export const LS_PREFIX = "dawn:v1:";

/* 效能預算 */
export const PERF_BUDGET = {
  jsGzipKB: 60,
  cssGzipKB: 20,
};
