# STATE：專案現況（新對話先讀這份，其他按需要讀）

更新：2026-10-03。分支 `interior-floors`（預覽 `/dev/`）；正式站 `main` 是 `v2.0-exterior`，還沒有室內功能。標籤 `v2.1-interior` 標記這份現況。

## 1. 已完成

| 範圍 | 內容 |
|---|---|
| 外牆（階段 A–F） | 93 個零件、材質、立面細節、屋頂、斜切轉角、街角與連棟、店面、AO |
| 室內 I1–I4 | 平面配置、剖開（水平／縱剖、反向）、圓角環繞樓梯、宴會廳（兩種立面） |
| 室內呈現 | 寫實材質／圖解／白模；房間名稱標籤 |
| 家具 | 宴會廳（桌椅、地毯）、書房（書櫃、書桌、椅子、書、會發光的檯燈） |
| 介面 | 「顯示內部」按鈕（不開面板）、「剖切」面板、點窗戶個別設定（含老虎窗） |
| 外觀 | 外牆材質切換（奧斯曼／巴黎淺色石灰岩）、人行道與路樹、大玻璃老虎窗 |

預設：一樓用途「混合」；每層臨街的左邊轉角是書房（房間 6 間以上、非頂樓）；閣樓最左邊也是書房，用大玻璃落地老虎窗；一樓左轉角窗的窗簾「拉開、程度 1」。

## 2. 還沒做、已知問題

- **I5**：平面資料匯出（JSON）、家具規範。其他房間（臥室、客廳、餐廳、廚房…）還沒有家具。
- **暫緩**：剖面「展開」（左右兩塊往兩側拉開）。
- 閣樓書房的門受斜頂影響偏矮；3F 與 5F 不放書房（規則）；大玻璃老虎窗的露台沒做。
- 手機寬度沒有重新測；10×8 的大建築重建約 94 ms，接近 100 ms 預算。
- `main` 還沒有合併 `interior-floors`。

## 3. 規矩

- 做完一件事就 commit；**推送要等使用者說**（使用者說「commit」就是推送到 `interior-floors`）。推送到 `main` 會部署正式站，一定先問。
- 不 commit `.claude/settings.json`。
- 尺寸只改 `blender/kit_dims.json`；零件全由 `blender/kitlib/` 產生，不手改 `.blend`。
- 素材全部自製，不用下載模型；使用者給的參考圖只取比例與款式。
- 文件用繁體中文。新階段開始前先建議 model 與 effort，等使用者切換再動工。
- 不要關使用者的 5176 開發伺服器；測試用 5177（背景執行要加長 timeout）。
- 驗證：`npx tsc --noEmit -p .`、`npm run build`；改平面規則後在開發模式跑 `window.__app.planCheckAll([1,2,3],["auto"])`（`"two"`、`"one"` 各跑一次），要全過。**少截圖**，只截必要的角度。
- `archive/` 與功能無關，**不要讀**，除非被指定。

## 4. 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器（5176） |
| `npm run build` | 建置 |
| `npm run kit` | 重建零件、匯出 `public/assets/kit.glb` 與 manifest |
| `npm run tex` | 烘焙貼圖 |
| `npm run ao` | 烘焙 AO（約 10 分鐘；改了零件形狀就要） |
| `npm run rooms` | 室內圖集（窗後的假房間） |

## 5. 任務該讀哪裡（不要整份讀規格）

| 任務 | 讀的規格章節 | 讀的程式 |
|---|---|---|
| 加／改家具 | INTERIOR_SPEC 6.8 | `src/furniture.ts`、`src/lampLights.ts` |
| 房間的地板與牆面 | INTERIOR_SPEC 6.7 | `src/finishes.ts` |
| 房間種類、門、樓梯間大小（平面規則） | INTERIOR_SPEC 5 | `src/plan.ts` |
| 樓梯 | INTERIOR_SPEC 7 | `src/stairs.ts`、`plan.ts` 的 `layoutStair` |
| 剖切、工具列、顯示內部 | INTERIOR_SPEC 2 | `src/cutaway.ts`、`src/toolbar.ts`、`src/main.ts`（`applyCut`） |
| 室內牆、閣樓、外牆內面 | INTERIOR_SPEC 6.1–6.5 | `src/rooms3d.ts` |
| 窗後的假房間、窗簾 | INTERIOR_SPEC 8.3 | `src/interiors.ts` |
| 點窗戶個別設定 | KIT_SPEC 8.6.1 | `src/windowEditor.ts`、`src/generator.ts` |
| 外牆新零件（Blender） | KIT_SPEC 4、5 | `blender/kitlib/modules.py`、`blender/kit_dims.json` |
| 老虎窗、屋頂 | KIT_SPEC 4.4、8.6.3 | `blender/kitlib/modules.py` |
| 外牆材質、顏色 | KIT_SPEC 8.6.2 | `src/materials.ts` |
| 排列規則（立面） | KIT_SPEC 8 | `src/generator.ts` |
| 人行道、路樹 | — | `src/streetlife.ts`、`kit_dims.json` 的 `street` |

章節用標題搜尋（例如 `grep -n "^### 6.8" INTERIOR_SPEC.md`），只讀那一節。

## 6. 任務怎麼切

- **一次一件事**，並指定要讀哪些檔案，不要讓 AI 自己掃整個專案。
- 好的任務：「只讀 `src/furniture.ts` 和 INTERIOR_SPEC 6.8，在臥室加一張雙人床。」
- 不好的任務：「把室內做得更完整。」
- 改外牆零件會連動五個地方：零件、manifest 的開口輪廓、網頁的平面與室內、AO、文件。先列出來再做。

## 7. 交接給其他 AI

先給這份 `STATE.md`，再給任務相關的規格章節（第 5 節的表）。交接用的 prompt：

```
你負責〔任務〕。先讀 STATE.md，只讀它指定的檔案與章節，不要掃整個專案。
- 只改你負責的檔案：〔列出〕。尺寸只改 blender/kit_dims.json。
- 做完請跑：〔tsc、build、planCheckAll〕，全過才算完成。
- 不要 commit，不要推送；列出你改了哪些檔案、哪裡不確定。
```
