# ProceduralBuilding_v2 — 歐式建築 kit

用 Blender Python 做歐式建築零件庫（`kit.glb`），加排列規則，在網頁上程序化生成，並能剖開看室內。

**先讀 [STATE.md](STATE.md)**（現況、規矩、任務該讀哪裡）。規格只讀相關章節，不整份讀：外牆零件 [blender/KIT_SPEC.md](blender/KIT_SPEC.md)，室內 [INTERIOR_SPEC.md](INTERIOR_SPEC.md)。`archive/` 與功能無關，不要讀，除非被指定。**如果文件裡有指向 `archive/` 的連結，而 `archive/` 不存在，不要去別的地方找，也不要猜內容；直接回覆「找不到 archive/」，等使用者放回來。**

## 規矩（精簡）
- 尺寸只改 `blender/kit_dims.json`；零件由 `blender/kitlib/` 產生，不手改 `.blend`。
- 素材全部自製，不用 Kenney 或下載模型；FrenchBuilding.blend 只參考拆件方式與搭配規則。
- 不 commit `.claude/settings.json`；推送要等使用者說，推送到 `main` 要先問。
- 文件繁體中文；新階段前先建議 model 與 effort。

## 開發
- `npm run dev` → http://localhost:5176/（不要關使用者的；測試用 5177）
- `npm run build`；推送到 `main` 由 GitHub Actions 部署正式站，推送到 `interior-floors` 部署 `/dev/` 預覽。
- Blender 5.1.1：`/Applications/Blender.app/Contents/MacOS/Blender`
- `npm run kit` / `tex` / `rooms` / `ao`：見 STATE.md 第 4 節。

## 與 v1 的關係
- v1 在 `../ProceduralBuilding_v1`（標籤 `v1-hongkong` 是線上港式版），本專案可直接讀取（見 `.claude/settings.json`）。需要下表的功能時，**先去 v1 讀對應檔案再移植，不要重寫**。
- 與 v1 相同的檔案：`src/environment.ts`、`src/moods.ts`、`src/sky.ts`、`src/postfx.ts`；移植後改過：`src/kit.ts`、`blender/export_kit.py`、`.github/workflows/deploy.yml`。

| v1 功能（v2 尚未帶入） | v1 位置 |
|---|---|
| 道路與城市街廓系統（路網、路緣、標線、街道家具）；之後做「向量錨點編輯道路」 | `road-system/`、`road-system/PLAN.md` |
| 道路整合進建築頁 | `src/city.ts` |
| 頂樓霓虹招牌、水塔 | `src/streetlife.ts` |
| 滑鼠檢查模式、除錯材質、電影運鏡、景深 | `src/main.ts`（inspect、cinematic 段落） |
| 外部參考素材（不在 repo 內） | `../ProceduralBuilding_v1/Shared_Assets_Library/`（授權見該資料夾 README） |
