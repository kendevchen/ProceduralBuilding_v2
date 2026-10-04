# 版本與分支

| 分支 | 用途 |
| --- | --- |
| `interior-floors` | 保留原有室內版本。 |
| `interior-floors_codex` | Codex 接手後的版本：臥室家具、依面積切換牆面，以及不同開間配置的家具擺放修正（程式版本 `cdb1a4a`）。 |
| `feature/room-editor` | 從 `interior-floors_codex` 建立：房型切換、雙房間合併、牆體保護、復原／重做與編輯重套。 |

建立日期：2026-10-04。房間編輯功能已實作，實際 GUI 與手機手勢待驗收。

## 線上預覽

- `main`：https://kendevchen.github.io/ProceduralBuilding_v2/
- `interior-floors`：https://kendevchen.github.io/ProceduralBuilding_v2/dev/
- `feature/room-editor`：https://kendevchen.github.io/ProceduralBuilding_v2/room-editor/

`feature/room-editor` 的部署流程會同時重建以上三個版本。其他分支的部署流程尚未同步這項設定；由它們觸發部署時，可能移除 `/room-editor/` 預覽，再推送房間編輯分支即可重新部署。
