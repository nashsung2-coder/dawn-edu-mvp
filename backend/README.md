# 曙光教育智能系統 MVP — 後端

「在慢荒宇宙中，每一座島嶼都是你知識的領土。」

FastAPI + SQLite 實作的 MVP 後端，涵蓋企畫書 v3.0 的核心系統：
交集資料庫（多維標籤搜尋）、曙光知識湖（30 筆手動標記內容）、RAG 簡易檢索、
島嶼領土、三維雷達、知識對決、心流細土。

## 啟動方式

```bash
cd backend
./venv/bin/python seed.py          # 建立資料庫＋種子資料（可重複執行，先清後種）
./venv/bin/uvicorn app.main:app --reload --port 8000
```

啟動後自動檢查：若資料庫是空的，會自動執行種子（10 維度、61 標籤、30 筆內容）。
瀏覽器開 http://localhost:8000/docs 看互動式 API 文件。

## API 一覽（皆為 JSON，前綴 /api/v1）

| 方法 | 端點 | 說明 |
|---|---|---|
| GET | `/tags` | 依維度分組的標籤樹（含別名） |
| GET | `/contents` | 內容列表（`?limit=&offset=`） |
| GET | `/contents/{id}` | 內容詳情（含標籤） |
| GET | `/search/intersection?tags=SUBJ:物理,CONC:蒸發&mode=weighted&exclude=DIFF:L4` | 交集搜尋 |
| POST | `/learning-events` | 寫入學習事件 |
| POST | `/flow-deposits` | 寫入心流細土 |
| GET | `/islands/{user_id}` | 島嶼狀態（不存在自動建立初始島嶼） |
| POST | `/islands/{user_id}/expand` | 開疆拓土（每日上限 5 單位） |
| POST | `/islands/{user_id}/occupy` | 佔領標籤 |
| GET | `/radar/{user_id}` | 三維雷達座標 `{x,y,z}`＋公式 |
| GET | `/radar/compare?me=&other=` | 雷達距離＋關係判讀 |
| POST | `/duels` | 發起知識對決（5 回合） |
| POST | `/duels/{id}/answers` | 對決作答（即時回饋＋結算） |
| GET | `/rag/query?q=` | RAG 關鍵字檢索（top3＋引用） |

### 交集搜尋 mode

- `strict`：必須命中全部標籤
- `weighted`：命中越多排序越前（預設）
- `fuzzy`：部分符合，顯示匹配度
- 標籤可用別名（如 `SUBJ:地科` 會擴展為地球科學；`INTER:動手做` 會擴展為實驗）
- 每筆結果含 `matched_tags`、`match_score`、`reason` 可解釋文案

### 開疆拓土 action

`complete_topic`(+1) / `fix_myth`(+1) / `ask_question`(+0.5) /
`complete_quest`(+2) / `co_study`(+1.5)，每日上限 5 單位。
每次擴張附贈一種資源（§10.4 六種：好奇種子、觀察之眼、變因齒輪、
心流之泉、連結之網、陰影之鑰）。

### 三維雷達公式

- X（知識廣度）= min(100, 跨學科 SUBJ 標籤數 × 25)
- Y（認知深度）= min(100, 完成的高難度 L3/L4 內容數 × 10)
- Z（社會連結）= min(100, 共修次數 × 20)
- 距離 = √((ΔX)²+(ΔY)²+(ΔZ)²) / √3 × 100%，Δ 為 0–1 歸一差
- <20% 合作夥伴／20–60% 互補／>60% 探索未知

### 知識對決規則（§12.3 / §12.4）

- 雙方領土差距 ≤50%、必須是共同標籤、同一對手每日一次
- 5 回合選擇題，每題即時回饋觀念誤區文案
- 結算：勝利者得對方 10% 資源、領土 +1、雙方各得徽章
  （「對決勝利」／「觀念修正」），失敗者另獲弱點推薦內容

## 測試

```bash
./venv/bin/python -m pytest tests/ -v
```

覆蓋：交集三種 mode、別名擴展、排除搜尋、每日擴張上限、
對決領土差距拒絕、對決完整流程與結算、雷達距離公式與關係判讀、
RAG 有結果／無結果文案（「目前知識湖沒有足夠內容，要不要換個標籤？」）。

## 專案結構

```
backend/
├── app/
│   ├── main.py        # FastAPI 路由
│   ├── db.py          # SQLite 連線＋Schema
│   ├── seed_data.py   # 標籤維度、標籤、30 筆內容
│   ├── search.py      # 交集搜尋引擎
│   ├── rag.py         # 簡易關鍵字檢索
│   └── game.py        # 島嶼、雷達、對決
├── seed.py            # 種子腳本（先清後種）
├── tests/test_api.py  # pytest 測試
├── data/dawn.db       # SQLite 資料庫（自動產生）
├── requirements.txt
└── venv/              # Python 虛擬環境
```
