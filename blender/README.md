# blender/ — 歐式零件產線

- `export_kit.py`：沿用 v1 的匯出腳本，把指定集合的每個子物件匯出成 `COL[集合][索引]` 節點，產生 `kit.glb` 與 `kit_manifest.json`。
  新 kit 的集合與物件名稱寫在腳本開頭的 `COLLECTIONS` / `OBJECTS` 清單，建立零件後需要改成歐式的清單。
- 待建立：`KIT_SPEC.md`（零件規格）、`build_kit.py`（建模）、`bake.py`（材質烘焙）。

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background european_kit.blend \
  --python export_kit.py -- ../public/assets/kit.glb ../public/assets/kit_manifest.json
```
