# 版本與分支

更新：2026-10-08。

| 分支 | 用途 |
| --- | --- |
| `main` | 正式外觀版本，尚未合併室內與房間編輯功能。 |
| `interior-floors` | 保留原有室內版本，線上預覽為 `/dev/`。 |
| `interior-floors_codex` | Codex 接手後的版本：臥室家具、依面積切換牆面，以及不同開間配置的家具擺放修正（程式版本 `cdb1a4a`）；本分支保留此版本，更新本文件不合併大型配置程式。 |
| `feature/room-editor` | 從 `interior-floors_codex` 建立：房型切換、雙房間合併、牆體保護、復原／重做與編輯重套；保留原有 `/room-editor/` 預覽。 |
| `feature/room-20x20` | 從本機房間編輯開發成果建立，包含 P0–P8：正面／側面開間及上層數上限 20、自動／中庭／採光井、多核心與樓層模板、連棟尺寸相容、快取及家具／標籤共用。P8 功能提交 `28bb9ee`，交付文件提交 `42a81b3`；新版預覽為 `/room-20x20/`。 |

## 線上預覽

- [正式站（main）](https://kendevchen.github.io/ProceduralBuilding_v2/)
- [原室內預覽（interior-floors）](https://kendevchen.github.io/ProceduralBuilding_v2/dev/)
- [房間編輯預覽（feature/room-editor）](https://kendevchen.github.io/ProceduralBuilding_v2/room-editor/)
- [20 上限預覽（feature/room-20x20）](https://kendevchen.github.io/ProceduralBuilding_v2/room-20x20/)

`interior-floors_codex` 沒有獨立的 Pages 預覽路徑。

## 部署方式與限制

推送 `feature/room-20x20` 會由該分支的 GitHub Actions 建置並發佈以上四個路徑，Pages 來源為 GitHub Actions。每個預覽以各自分支的程式建置；發佈新版不需要把大型配置推送到 `feature/room-editor` 或合併到 `main`。

其他分支的 workflow 尚未同步新版四路徑設定。由舊分支觸發 Pages 部署時，可能移除 `/room-20x20/`，甚至 `/room-editor/`；可從 `feature/room-20x20` 手動執行「Deploy to GitHub Pages」恢復四個路徑。

20 上限表示可輸入範圍，部分寬深／高度組合會因核心容量或路徑限制被拒絕並保留原模型。20 個上層另加一樓及閣樓，共 22 個實際樓層。大型同步重建約 2.6–3.6 秒（P7 桌機實測），100／300 ms 效能門檻尚未全數通過；P8 新介面瀏覽器操作／視覺驗收、GPU 首次編譯／上傳及行動裝置效能仍待完成。
