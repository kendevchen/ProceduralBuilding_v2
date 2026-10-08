# 功能與建模索引：ProceduralBuilding_v2_Codex

更新：2026-10-07。用途：讓新專案 `ProceduralBuilding_v3_Bunker` 按需查找、理解及移植 v2 功能，不複製整個專案。

本索引查核基線：`1b9909c5f84f922db6d65ba937d93e5270258c5b`，分支 `feature/room-editor`。下列路徑皆相對於 v2 根目錄。來源提交記錄實際程式版本；本索引本身在後續文件提交新增。未追蹤文件及使用者尚未提交的變更不屬於此基線。

## 1. 使用方式與移植邊界

1. 只讀本索引中所需功能的入口與相關規格章節，不掃全部歷史文件。
2. 用 `git show <來源提交>:<檔案路徑>` 查看固定版本，先追該功能的 imports、參數與呼叫端，再決定最小移植集合。
3. v3 複製必要程式或改寫介面，不直接 import v2 相鄰目錄，也不整包搬 `src/main.ts`、GUI、全部資產或歷史交接文件。
4. v3 留一份簡短來源紀錄：功能、v2 提交、來源檔案、搬入檔案、改動與驗證結果。未來需要共享套件時另行規劃；本次沒有抽取或重構。
5. Bunker 的用途、外觀與空間規則由 v3 決定；不要把巴黎住宅房型、孟莎屋頂、咖啡店、固定展示相機當成必要依賴。

上述固定查核基線的 GUI 為 10／8／6。現行工作分支已實作 P0–P8 的大型配置與 GUI，P8 新介面瀏覽器視覺驗收待完成：三上限為 20，自動／中庭／採光井、旋轉多核心、深平面與跨翼模板、尺寸版本、家具／標籤共用均已接入。新增入口為 `buildingTopology.ts`、`buildingPipeline.ts`、`planning/*`、`cameraFrame.ts`、`limitChecks.ts`；不要將下表固定來源提交當作這些新功能版本。現行規則與效能／驗收限制見 [20上限平面配置規則](Guide/room-planning_v2/20上限平面配置規則.md) 與 [P8 執行紀錄](Guide/room-planning_v2/P8執行紀錄.md)。

## 2. 功能查找表

| 功能 | 優先入口／關鍵符號 | 相關依賴與規格 | v3 取用方式 |
|---|---|---|---|
| 外牆零件建模 | `blender/kitlib/modules.py`：`catalog()`、各零件函式 | `geom.py`、`parts.py`、`ornaments.py`、`kit_dims.json`；KIT_SPEC §4–5 | 重用建模方法，另建 Bunker 零件目錄 |
| 外牆排列／轉角／門窗 | `src/generator.ts`：`generateBuilding()`、`windowKey()` | `params.ts`、`rng.ts`、`roof.ts`、Kit；KIT_SPEC §8 | 保留參數化排列與標籤概念，換掉歐式規則 |
| 模型載入與實例化 | `src/kit.ts`：`Kit.load()`、`Placement` | GLB、manifest、`materials.ts`；KIT_SPEC §9 | 可參考通用載入／鏡像／分桶方法 |
| 屋頂與輪廓幾何 | `src/roof.ts`：`insetEdges()`、`roofShape()`、`roofCap()`、`partyWalls()` | footprint、邊界種類、尺寸 | 可取多邊形工具；屋頂形制另設計 |
| 房型與門窗／樓梯平面 | `src/plan.ts`：`BuildingPlan`、`planBuilding()`、`checkPlan()` | generator、params、rng、roof；INTERIOR_SPEC §5 | 重用資料結構思路，不套住宅分戶規則 |
| 真實室內牆／樓板／門框 | `src/rooms3d.ts`：`Tris`、`buildRooms3d()`、`atticCeiling()` | plan、Building、Kit 洞口資料、InteriorMaterials；INTERIOR_SPEC §6.1–6.6 | 幾何與平面分離；移植須對齊洞口及座標 |
| 家具程序化建模與配置 | `src/furniture.ts`：`Part`、`buildFurniture()` | rooms3d、roomGeometry、finishes、dims；INTERIOR_SPEC §6.8 | 詳見第 4 節，造型與擺放分別評估 |
| 家具總覽／面數檢查 | `src/furniture.ts`：`buildFurnitureItems()`；`src/furnitureGallery.ts` | 共用家具造型及材質；INTERIOR_SPEC §6.9 | 可作 v3 的單件驗收工具，不必搬原 GUI |
| 凹多邊形房間與家具定位 | `src/roomGeometry.ts`：`inRoom()`、`roomContains()`、`roomAnchor()` | Three.js ShapeUtils、roof 的 V2 | 優先於複製完整家具配置器 |
| 改房型／合併／復原 | `src/roomEdits.ts`、`src/roomEditor.ts` | roomGeometry、plan、roomLabels、main rebuild；INTERIOR_SPEC §5.9 | 核心編輯與 UI 分開搬；注意通行性問題 |
| 地板／牆面／家具花紋 | `src/finishes.ts`：`stampOf()`、`stampAttributes()`、`finishMaterial()` | stamp 頂點屬性、shaderVariant；INTERIOR_SPEC §6.7 | 保留 stamping 機制，換材質與房型映射 |
| 普通水平／縱向剖切 | `src/cutaway.ts`：`Cutaway`；`src/main.ts`：`applyCut()` | shaderVariant、材質分類、renderer clipping；INTERIOR_SPEC §2、§6.6 | 詳見第 5 節，不只是複製裁切平面 |
| 外牆透明度 | `src/facadeTransparency.ts`：`FacadeTransparency` | rooms3d 的外牆內襯分批、facadeShell 標籤、shaderVariant、toolbar；INTERIOR_SPEC §2.1 | 外殼與隔間須分開；變體不修改共享材質，展開保留標籤；`npm run check:facade` 驗證 |
| 左中右三段展開 | `src/unfold.ts`：`UnfoldView`、`unfoldCuts()` | sectionGeometry、cutaway、plan、labels、燈光；INTERIOR_SPEC §2.4 | 依 Bunker 形狀重訂切線，保留幾何／展示分離 |
| 分段索引與 shader 座標 | `src/sectionGeometry.ts`：`sectionGeometry()`；`src/shaderVariant.ts` | 原 geometry 所有權、SOURCE_FRAME_GLSL、材質 clone | 展開效能與花紋穩定的必要搭配 |
| 樓梯與紅毯／欄杆 | `src/stairs.ts`：`buildStairs()`；plan 的 `layoutStair` | InteriorMaterials、Tris、dims；INTERIOR_SPEC §7 | 方法可取，樓梯形式與尺寸依 v3 決定 |
| 多棟與四向新增／間距 | `src/buildingScene.ts`：`BuildingScene`、`AddDirection` | main 的 BuildingRuntime、addBuilding、selectBuilding；INTERIOR_SPEC §2.5 | 布局器與獨立狀態分開搬 |
| 鏡頭與 target 動畫 | `src/main.ts`：`selectBuilding()`、`frameHome()`、`cameraMotion`、更新迴圈 | bounds、OrbitControls、取消動畫與重新框景 | 抽出行為，不帶 v2 固定視角 |
| 窗戶個別編輯 | `src/windowEditor.ts`、generator 的 WindowSlot | Kit 實例 tags、windowKey、重建流程；KIT_SPEC §8.6.1 | Bunker 有可編輯門窗時才取用 |
| 窗後假室內／窗簾 | `src/interiors.ts`：`buildInteriors()`；`blender/rooms.py` | `tex/interiors.jpg` 圖集；INTERIOR_SPEC §8.3 | 外觀低成本替代，非真實家具或可剖切室內 |
| 人行道／路樹／戶外家具 | `src/streetlife.ts`、`buildCafeTerrace()` | dims.street、cafes、預留座位輪廓 | Bunker 場景需要才搬，咖啡店邏輯可省略 |
| 燈光、環境與後製 | `src/lampLights.ts`、`environment.ts`、`sky.ts`、`moods.ts`、`postfx.ts` | Three.js 燈池、天空、陰影／後製參數 | 與建模分開，先建立 v3 效能預算 |

## 3. 外牆建模產線

來源 → 產物 → 使用：`kit_dims.json + kitlib/` → `build_kit.py` → `european_kit.blend` → `export_kit.py` → `public/assets/kit.glb + kit_manifest.json` → `Kit.load()` → `generateBuilding()` placements → `Kit` 實例化。

- **尺寸與座標**：`blender/kit_dims.json` 是 v2 尺寸來源。零件、平面與 placements 採 Blender Z-up；`main.ts` 將建築根節點繞 X 旋轉 −π/2，轉成網頁 Y-up。v3 必須統一座標，不能重複旋轉。
- **基本形**：`kitlib/geom.py` 的 `MeshBuilder` 提供 planar（多邊形含洞）、sweep（剖面沿折線擠出與斜接）、box、prism、bar。這些方法較通用；`parts.py` 提供腰線、窗框、窗扇與欄杆等構件。
- **完整模組**：`modules.py` 組合一樓、上層、轉角、門窗、陽台及屋頂；`ornaments.py` 為歐式裝飾層。Bunker 應優先重用基本形與模組組合方式，不必保留山花、柱飾或屋頂款式。
- **輸出契約**：`catalog()` 登記零件及尺寸檢查；`blend.py` 轉物件、檢查 bounds、打包 UV1。匯出維持 Z-up，GLB 材質名稱供網頁重建材質，貼圖獨立存放。manifest 有零件分類、面數及可用的 opening／recess 資料，真實室內會依洞口銜接外牆。
- **材質產線**：`bake.py` 烘焙自製色彩／粗糙度高度與鐵花圖樣；`bake_ao.py` 產生共用 UV1 AO。`src/materials.ts` 的 `createMaterials()` 負責網頁材質，`forkKitMaterials()` 分離每棟 uniform。新零件若改造型須重新檢查 AO，不直接套舊圖集。
- **繪製策略**：`kit.ts` 按零件、材質與款式分桶，用 InstancedMesh；鏡像幾何處理、材質名稱、節點名稱與 manifest 必須成套對齊。

重建指令（會更新產物，不是唯讀檢查）：`npm run kit` 建模／預覽／匯出；`npm run tex` 貼圖；`npm run ao` AO（先建 kit）。入口為 `blender/make_kit.sh`，Blender 路徑可透過 `BLENDER` 指定。本次未執行重建。

移植驗收：零件 bounds／原點／單位、鏡像法線、窗洞前後接合、材質名稱、UV 與 AO、不同種子排列、普通及展開剖切。不要搬 `.blend1`、`__pycache__`、node_modules 或不相關預覽圖。

## 4. 家具建模與室內擺設

**真實家具不是 Blender 家具 GLB 庫**：`furniture.ts` 直接生成 Three.js 幾何，`buildFurnitureItems()` 與房間家具共用造型方法。`blender/rooms.py` 的床、桌椅等只用來算窗後假室內圖集，不是剖切中看見的真實家具來源。

建模 → 配置 → 使用：`Part + Tris + dims.interior` → 床／桌椅／櫃／燈等造型函式 → 各房型 placement 函式 → `buildFurniture(plan, building, materials, look)` → 房間場景；單件驗收走 `buildFurnitureItems(materials)`。

- **基本幾何方法**：`Part` 用局部 Matrix4 組裝 box、softBox、card、strut、旋轉剖面等，再寫入 `Tris`。實體家具保持封閉；卡片、玻璃與燈罩並非都應套實體切面規則。
- **造型與尺寸**：主要尺寸在 dims 的 `interior.*Furniture`；仍有 `furniture.ts` 內部造型常數，不能假設只複製 JSON 就足夠。桌椅、床、書櫃等方法與房型配置目前在同一檔案，移植單件要追蹤私有 helper。
- **配置方法**：`salonPlacement`、`diningPlacement`、`kitchenPlacement`、`cafePlacement` 等依實牆、門窗、房間輪廓、通道、鏡像與緊湊尺寸求位置；閣樓另檢查 `atticCeiling()`。配置失敗記錄在各類 `userData`，不應硬塞或假裝成功。
- **合併與材質**：同類材質的幾何累積／合併，並非目前全面家具 InstancedMesh。`finishes.ts` 的 stamp 頂點屬性處理木紋、布料、書本等；`ballroomArt.ts` 產生自製 Canvas 圖畫與餐牌，`cafes.ts`／`attics.ts` 決定風格。
- **照明**：發光材質與真正燈光是兩件事；`lampLights.ts` 使用固定燈池，展開需同步燈位置。只移植家具造型時可省略燈池，但須明確選擇效果。
- **減面方法**：優先降低重複花束／餐具／旋轉剖面細節，以 shader 或卡片表達書背及花紋；用總覽確認實際三角面數。合併可減少 draw calls，但不會自動減少三角面；新增大量重複家具時，v3 再評估實例化，不把尚未做的最佳化當成現成功能。

建議最小取用順序：單件造型 → 材質／花紋 → 局部座標與尺寸 → 輪廓／避門窗配置 → 燈光 → 剖切。不要為了一張床帶入完整住宅規劃器。

驗收：單件尺寸／原點、總覽面數、凹房間包含測試、避門窗與通道、窄房縮小或合理省略、剖切封閉性、材質隨位移／旋轉穩定、反覆重建不累積 GPU 資源。

## 5. 剖切、展開與效能契約

- **普通剖切**：`Cutaway` 管理 clipping plane 與裁切材質。實體材質採 DoubleSide，shader 將背面填黑；並非任意模型的精確布林切割或通用封口演算法。開放網格、透明件、特殊拓樸可能需要另做截面，不能只改顏色就認定支援。
- **材質分類**：`cutaway.ts` 的 `SOLID`／`ONE_SIDED` 依材質名稱判斷。v3 新增混凝土／鋼材等名稱時必須同步分類；`shaderVariant.ts` 的 `cloneShaderMaterial()`、program cache key 與 onBeforeCompile 不能漏搬。
- **展開資料流**：原建築幾何／平面 → `unfoldCuts()` 決定左右切線 → `UnfoldView` 管理三段變換與材質 → `sectionGeometry()` 提供索引視圖 → UI／main 更新展開程度、開口及聚焦。標籤、點選、燈光亦需套區段變換。
- **三角索引不是精確切面**：`sectionGeometry()` 保留與區段相交的三角形，共用原頂點，實際裁切仍由 shader 完成。間距滑桿以保守範圍避免拖動重建 buffers；不要改成每幀複製三份全模型。
- **資源所有權**：分段索引快取由來源 geometry 持有，來源 dispose 時一併釋放；呼叫端不能自行 dispose 共用視圖。`UnfoldView.dispose()` 釋放它擁有的材質／實例資源，不刪共用 kit 或貼圖。
- **花紋座標**：`SOURCE_FRAME_GLSL` 與 `bindBuildingOrigin()` 處理展開前局部座標／每棟原點。缺少這層會使模型移動或展開後木紋、地板等花紋滑動。
- **操作語意**：展開滑桿不控制相機且旋轉立即反映；正面開口 0 不裁掉突出立面，展開 0 只收合姿態，不移動正面切線。v3 應自行決定展示預設，不搬使用者在 v2 的相機數值。
- **非通用假設**：自動切線偏好避開樓梯／宴會廳；手動間距仍可能切樓梯。Bunker 的地下層、厚牆與不同輪廓需重新測試，現有七種歐式配置回歸不代表新形制已支援。

多棟補充：每棟參數、編輯、材質 uniform、剖切狀態獨立；Kit 幾何與貼圖共用。只有目前棟保有真實室內，未選棟釋放家具／標籤並保留外觀；這是按需重建策略，不是所有棟都同步顯示剖面。

## 6. 驗證入口、限制與其他文件

| 檢查 | 入口 | 用途／注意 |
|---|---|---|
| 編譯與建置 | `npm run build` | TypeScript 與 Vite；不取代畫面驗收 |
| 房間編輯 | `npm run check:rooms`；加 `-- --plans` | 房型、合併與平面矩陣；基線已有「reachability survives a merge」失敗，不能當新移植回歸忽略 |
| 三段展開 | `npm run check:unfold` | 七種配置、座標／裁切、燈光／標籤、資源生命週期 |
| 多棟布局 | `npm run check:buildings` | 二維間距、基地預覽、各棟配置與材質隔離 |
| 手動畫面／效能 | v3 自己的瀏覽器場景 | 檢查封口、材質、互動、三角面、draw calls、幀時間及 GPU 記憶體；不能沿用 v2 舊 FPS 作保證 |

房間編輯與棟群目前只在頁面記憶體保存，重新整理會清除；沒有完整持久化、自由擺放、建築刪除或真正共牆連棟功能。部分手機／視覺回歸尚未完成。

按需閱讀：

- [STATE.md](STATE.md)：現況與工作規則；少數舊敘述／連結可能未同步，以目前程式與本索引查核基線為準。
- [外牆規格](blender/KIT_SPEC.md)：§2 座標、§4 零件、§5 建模、§6 材質、§8 排列、§9 匯出。
- [室內規格](INTERIOR_SPEC.md)：§2 展示、§5 平面／編輯、§6 幾何／材質／家具、§7 樓梯。
- [建模產線說明](blender/README.md)：腳本與指令，只讀與所需功能相關部分。
- [大型配置交接與備份](handoff/room-planning/README.md)：歷史 `f0ec2b2` 規劃器快照及未來計畫，不代表已完成的大型配置功能。

不依賴已刪除的 Guide／archive 文件；不要為移植而重建那些歷史文件。新的功能細節優先更新對應程式／規格，再維護此索引的入口與限制，避免複製多份長篇說明。
