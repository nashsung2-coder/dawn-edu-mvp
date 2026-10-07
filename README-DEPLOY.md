# 部署教學 — 路線 A：Cloudflare Pages（前端）＋ Render（後端）＋ Neon（資料庫）

> 目標：把曙光教育智能系統 MVP 放到免費平台上，用手機瀏覽器也能打開。
> 全程免費、免綁信用卡。程式碼已就緒（本 repo），剩下的是三個帳號＋填幾個設定。

## 前置：需要申請的帳號

| 平台 | 用途 | 費用 |
|---|---|---|
| [Neon](https://neon.com) | Postgres 資料庫（免費永久） | $0，免信用卡，可用 GitHub 登入 |
| [Render](https://render.com) | 跑 FastAPI 後端 | $0，免信用卡，可用 GitHub 登入 |
| [Cloudflare](https://cloudflare.com) | 託管前端靜態頁 | $0，免信用卡 |

GitHub 帳號你已經有了（repo `dawn-edu-mvp` 是公開的，Render 免費版要求公開 repo）。

---

## 六步部署

### 第 1 步：Neon 建資料庫，拿連線字串

1. 登入 Neon → New Project，名稱隨意（如 `dawn-edu`），Region 選離台灣近的（Singapore）。
2. 建好後進 Dashboard → Connection Details，複製連線字串，長得像：
   `postgresql://user:xxxx@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/dawndb?sslmode=require`
3. ⚠️ 選 **pooled**（帶 `-pooler`）的連線字串：Render 是長駐服務，用 pooled 可避免連線數被吃光。
   若之後遇到 prepared statement 相關錯誤，再換成 direct（不帶 `-pooler`）重試。
4. 先收好，下一步會用。

### 第 2 步：Render 用 Blueprint 建後端服務

1. 登入 Render → New → **Blueprint** → 選擇 `dawn-edu-mvp` repo。
2. Render 會讀取本 repo 根目錄的 `render.yaml`，自動建立名為 `dawn-edu-mvp` 的 Web Service。
3. 在 Service 的 **Environment** 頁填兩個變數：
   - `DATABASE_URL`＝ 第 1 步的 Neon 連線字串
   - `FRONTEND_URL`＝ 之後 Cloudflare Pages 的網址（第 4 步回來補也行；沒填時本機 `localhost` 照樣能連）
4. 按 Deploy。第一次 build 約 2–5 分鐘。

### 第 3 步：跑種子資料

後端啟動時會自動建表；若資料庫是空的也會自動種入 30 筆內容（`lifespan` 會檢查）。
想手動重跑（先清後種）：

```bash
# 在本機，裝好 requirements 後：
DATABASE_URL="postgresql://..." python seed.py
```

### 第 4 步：Cloudflare Pages 部署前端

1. 登入 Cloudflare → Workers & Pages → Create → Pages → Connect to Git。
2. 選 `dawn-edu-mvp` repo，設定：
   - **Build command**：留空（純靜態，不用 build）
   - **Build output directory**：`frontend`
3. Deploy。完成後你會得到 `https://dawn-edu-mvp.pages.dev` 這類網址。

### 第 5 步：把前後端接起來

1. 打開 `frontend/config.js`，把 Render 後端的公開網址填進去：
   ```js
   window.DAWN_API_BASE = "https://dawn-edu-mvp.onrender.com"; // 換成你的 Render 網址，結尾不加斜線
   ```
2. commit＋push，Cloudflare Pages 會自動重新部署（約 1 分鐘）。
3. 回到 Render，把 `FRONTEND_URL` 設成 Pages 網址（逗號可分隔多個），後端會自動重啟。

### 第 6 步：驗收

- 開 Pages 網址 → 探究頁選幾個標籤搜尋，卡片下方應出現「資料來源：後端 API 🌐」。
- 開 `https://你的render網址/docs` → 有 Swagger 文件，能直接試 API。
- 島嶼頁目前是前端本機狀態（還沒接後端帳號系統），屬於 MVP 已知範圍。

---

## 易翻車點 ⚠️

1. **CORS**：瀏覽器擋跨域時，前端 console 會出現 CORS 錯誤。解法：確認 Render 的 `FRONTEND_URL` 填的是 Pages 的**完整網址**（含 `https://`），且沒有打錯字。
2. **Render 冷啟動**：免費版閒置 15 分鐘會休眠，第一次開啟要等約 1 分鐘喚醒。展示前先開一次 `/docs` 把它暖起來。
3. **DATABASE_URL 要用 pooled**：見第 1 步。Neon 免費版連線數有限，pooled 最保險。
4. **SQLite 別再用了**：免費平台的檔案系統重啟會清空，SQLite 資料會不見——這就是為什麼改用 Neon。`data/dawn.db` 只留本機開發用，不要上傳（已在 `.gitignore`）。
5. **Neon 休眠**：免費 Neon 閒置會 scale-to-zero，第一次查詢慢 1–3 秒，屬正常。

## 本機開發（改完程式想先測）

```bash
cd backend
./venv/bin/python seed.py                 # SQLite 模式種資料
./venv/bin/uvicorn app.main:app --reload  # http://localhost:8000
cd ../frontend && python3 -m http.server  # 另開終端，http://localhost:8000 會撞埠，換 8321
```

想測 Postgres 模式：`DATABASE_URL="postgresql://..." ./venv/bin/python seed.py` 再跑 pytest（測試固定走 SQLite，不受影響）。
