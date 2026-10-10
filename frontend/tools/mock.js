/* dev mock：?mock=1 或 localStorage.dawn.mock=1 時攔截 api()
 * 回傳符合契約形狀的假資料，僅開發用，production 自動排除。
 * 後端冷啟動/掛掉時前端仍可開發。
 */
const MOCK = new URLSearchParams(location.search).has("mock")
  || localStorage.getItem("dawn.mock") === "1";

const fixtures = {
  "GET /auth/me": () => ({ id: "dev-user", name: "開發者", level: 1 }),
  "GET /game/state": () => ({ stardust: 1240, weapons: [] }),
  "GET /learn/badges": () => [],
  "GET /learn/mastery": () => ({}),
  "GET /world/market": () => [],
  "GET /tags": () => [],
  "GET /contents": () => [],
};

export function isMock() { return MOCK; }

/* 包一層：如果是 mock 模式，直接回 fixture 不打網路 */
export async function maybeMock(method, path) {
  if (!MOCK) return undefined;
  const key = `${method} ${path.split("?")[0]}`;
  const fn = fixtures[key];
  if (fn) {
    console.info(`[mock] ${key}`);
    await new Promise(r => setTimeout(r, 300)); // 模擬延遲
    return fn();
  }
  console.warn(`[mock] 無 fixture: ${key}，回傳 null`);
  return null;
}
