# ProceduralBuilding_v2 — 歐式建築 kit

目標：用 Blender Python 製作歐式建築零件庫（kit.glb），加上排列規則，在網頁上程序化生成。

## 與 v1 的關係
- v1 位置：`../ProceduralBuilding_v1`（GitHub `kendevchen/ProceduralBuilding_v1`；標籤 `v1-hongkong` = 線上港式版，之後新增的文件如 `HK_MODEL_INVENTORY.md` 只在 main）。本專案可直接讀取（見 `.claude/settings.json`）。
- v2 只放用得到的東西。需要下表的功能時，**先去 v1 讀對應檔案再移植，不要重寫**。
- 從 v1 帶來、目前與 v1 相同的檔案：`src/environment.ts`、`src/moods.ts`、`src/sky.ts`、`src/postfx.ts`、`.github/workflows/deploy.yml`。
- 從 v1 移植後改過的檔案：`src/kit.ts`（只留名稱還原、鏡像、實例化）、`blender/export_kit.py`（自動找 `KIT` 底下的集合、保留 UV、manifest 記三角形數）。

## v1 功能地圖（v2 尚未帶入）
| 功能 | v1 位置 | 備註 |
|---|---|---|
| **道路與城市街廓系統**（路網、路緣、標線、量體、街道家具） | `road-system/`，設計紀錄 `road-system/PLAN.md` | 之後要加「向量錨點編輯道路」：做成新的 layout 產生器，核心沿用（PLAN.md 第 1、6 節） |
| 道路系統整合進建築頁（單位換算、清出視線） | `src/city.ts` | |
| 港式大樓：零件載入、排列演算法 | `src/kit.ts`、`src/generator.ts`、`src/params.ts`、`src/rng.ts` | kit 載入、鏡像幾何、1K/2K 貼圖切換可參考 |
| 港式零件清單與 kit 規格參考 | `HK_MODEL_INVENTORY.md`、`ProceduralBuilding_Assets_Kit/` | 命名 `COL[集合][索引]`、`OBJ[物件]` |
| 人行道、行道樹、頂樓霓虹招牌、水塔 | `src/streetlife.ts` | |
| 滑鼠檢查模式、除錯材質 | `src/main.ts`（inspect / debug 段落） | |
| 電影運鏡、景深、對焦平面 | `src/main.ts`（cinematic 段落） | |
| 雪、雨、濕潤（使用者不需要） | `src/snow.ts`、`src/rain.ts`、`src/wet.ts` | |

## 外部參考素材（不在 repo 內）
- `../ProceduralBuilding_v1/Shared_Assets_Library/`：參考站原始碼（含法式 `FrenchBuilding.blend`，MIT）、Kenney 城市套件（CC0）。授權細項見該資料夾 README。

## 開發
- `npm run dev` → http://localhost:5176/
- `npm run build`；推送到 main 會由 GitHub Actions 部署到 https://kendevchen.github.io/ProceduralBuilding_v2/
- Blender 5.1.1：`/Applications/Blender.app/Contents/MacOS/Blender`
- 零件規格與分階段計畫：`blender/KIT_SPEC.md`（含決策紀錄）。尺寸常數只改 `blender/kit_dims.json`。
- `npm run kit`：建模 → 預覽圖 `blender/kit_preview.jpg` → 匯出 `public/assets/kit.glb`。零件全部由 `blender/kitlib/` 產生，不手改 `.blend`。
- `npm run tex`：`blender/bake.py` 烘焙自製貼圖與鐵花圖樣到 `public/assets/tex/`；網頁端的材質著色器在 `src/materials.ts`。
- 素材全部自製：FrenchBuilding.blend 只參考拆件方式與搭配規則，不沿用幾何與貼圖；不用 Kenney 或下載模型。
