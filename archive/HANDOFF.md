# 交接文件：多邊形街道與建築整合

> 寫於 2026-10-01，給接手開發的模型（AI agent）。
> 接下來的工作分兩步：
> 1. **街道模組**：多邊形路網，路口節點可以在水平面上自由拖動；街廓和地塊跟著變成多邊形。
> 2. **整合**：先用白色幾何量體確認每棟建築的牆面數與角度，再套上本專案的程序化建築外觀。
>
> 這份文件說明本專案的現況、必須遵守的規則、兩個模組之間的接口，以及多邊形街道的建議做法。細節以 [blender/KIT_SPEC.md](../blender/KIT_SPEC.md)（規格與決策紀錄）和 [CLAUDE.md](../CLAUDE.md) 為準。

---

## 1. 現況

本專案用 Blender Python 自製歐式（奧斯曼式巴黎）建築零件庫，在 three.js 網頁上依規則程序化生成建築。KIT_SPEC.md 的六個階段已全部完成，部署在 https://kendevchen.github.io/ProceduralBuilding_v2/ 。

| 已完成 | 內容 |
|---|---|
| 零件庫 | 85 個零件（`public/assets/kit.glb`），全部由 `blender/kitlib/` 程序化產生 |
| 材質 | 7 組自製無縫貼圖、石材分縫、鋅板立縫、鐵花欄杆、AO |
| 建築規則 | 獨棟／街角／連棟、直角或斜切轉角、樓高遞減、奧斯曼裝飾層級、陽台、百葉、老虎窗、煙囪、店面、盲牆 |
| 室內 | 自建 16 間房間圖集、窗後室內、窗簾、開窗、日夜燈光 |

**還沒有的**：街道、城市、多棟建築、任意角度的平面。

---

## 2. 必須遵守的規則

1. **素材全部自製。** 不用 Kenney、Poly Haven、Sketchfab 等下載素材，也不沿用參考站 FrenchBuilding.blend 的幾何與貼圖（可以參考拆件方式和搭配規則）。街道的路面、人行道、街道家具也一樣要自己做。
2. **先讀 v1 再移植，不要重寫。** v1 在 `../ProceduralBuilding_v1`。它的道路系統 `road-system/` 已經做好路網、路緣、標線、地塊、量體，設計紀錄在 `road-system/PLAN.md`。v1 功能地圖見 CLAUDE.md。
3. **尺寸常數只寫在 `blender/kit_dims.json`。** Python 和 TypeScript 都讀這個檔，不要在程式裡另外寫死 3.0、4.4 這類數字。
4. **不要手改 `.blend`。** 零件由腳本產生，要改就改 `blender/kitlib/` 再跑 `npm run kit`。
5. **推送到 main 會自動部署到 GitHub Pages。** commit 和 push 前先問使用者。
6. **文件用繁體中文**，和現有的 KIT_SPEC.md、README 一致。

### 指令

```bash
npm run dev     # http://localhost:5176/
npm run build   # 型別檢查 + 打包
npm run kit     # Blender：建模 → 預覽圖 → 匯出 kit.glb（Blender 5.1，路徑見 CLAUDE.md）
npm run tex     # Blender：烘焙材質貼圖與鐵花圖樣
npm run rooms   # Blender：室內圖集（約 1 分鐘）
npm run ao      # Blender：AO 烘焙（約 10 分鐘，要先 npm run kit）
```

開發模式下 `window.__app` 提供 `camera`、`controls`、`params`、`rebuild()`、`env`、`scene`，方便用瀏覽器自動化截圖驗證。

---

## 3. 程式架構

```
src/
  main.ts        場景、GUI、rebuild()：產生 → 實例化 → 加上屋頂、盲牆、室內
  params.ts      BuildingParams（所有建築參數與預設值）
  generator.ts   generateBuilding(params, kit) → Building（排列規則的核心）
  kit.ts         Kit：載入 kit.glb；buildGroup(placements) → InstancedMesh 群組
  materials.ts   依 Blender 材質名稱重建材質（三平面投影、分縫、立縫、室內、玻璃）
  roof.ts        insetEdges / roofShape / roofCap（屋頂平台）/ partyWalls（盲牆與防火山牆）
  interiors.ts   buildInteriors(rooms) → 房間盒與窗簾
  gallery.ts     零件總覽
  rng.ts         rand(...keys)：無狀態雜湊亂數
  environment.ts、moods.ts、sky.ts、postfx.ts   燈光氛圍與後製（沿用 v1）
blender/
  kit_dims.json  尺寸常數（共用）
  kitlib/        geom（剖面擠出、斜接）、parts（剖面、窗、欄杆）、modules、ornaments
  build_kit.py、export_kit.py、bake.py、rooms.py、bake_ao.py、preview_kit.py
```

**一棟建築的資料流：**

```
BuildingParams
  → generateBuilding()  → Building { placements, footprint, edgeKinds, rooms, wallTop, roofBase, … }
  → kit.buildGroup(placements)                     零件（InstancedMesh，同一零件不論幾棟都只有一次繪製）
  + roofCap(footprint, edgeKinds, roofBase)        屋頂平台
  + partyWalls(footprint, edgeKinds, roofBase)     盲牆與防火山牆
  + buildInteriors(rooms)                          房間盒與窗簾
```

`Placement = { key, matrix, style }`：key 是零件名稱（例如 `COL[S_bay][1]`，用 `kit.key("S_bay", "window")` 取得），matrix 在 Blender 座標，style 是每棟的配色。

---

## 4. 座標與單位（整合時最容易出錯的地方）

- **單位是公尺。** v1 的港式大樓用 1 單位 = 3 m，所以 v1 的道路系統整合時縮放了 1/3。**v2 不需要縮放**，道路和建築都是公尺。
- **建築在 Blender Z-up 座標裡產生。** 網頁端把 `root` 群組繞 X 軸轉 −90° 變成 three 的 Y-up。換算方式：

  ```
  Blender (x, y, z)  →  three (x, z, −y)
  three (X, Y, Z)    →  Blender (X, −Z, Y)
  ```

- **v1 道路系統在 three 的俯視平面 (x, z) 計算。** 從 (x, z) 換到 Blender (x, y = −z) 是一次鏡射，**多邊形的繞行方向會反轉**。建築系統要求平面多邊形在 Blender xy 中逆時針（有號面積 > 0），建築內側在每條邊的左手邊。換算後一律用有號面積檢查，必要時把頂點順序反轉：

  ```ts
  const toBlender = (poly: [number, number][]) => {
    const p = poly.map(([x, z]) => [x, -z] as [number, number]);
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
      a += x0 * y1 - x1 * y0;
    }
    return a > 0 ? p : p.reverse();
  };
  ```

- **立面局部座標**（零件與排列規則都用這個）：原點在邊的起點，+x 沿著邊，外牆面在 y = 0，**外側是 −y**，往建築內是 +y，z 是高度。逆時針多邊形的每條邊，右手邊就是外側，剛好吻合。
- **地面高度**：建築的 z = 0 是一樓地板。整合時要放在人行道頂面上（v1 路緣高 0.15 m），也就是把建築群組往上移到人行道高度。

---

## 5. 建築系統目前的能力與限制

| 項目 | 目前 | 多邊形街道需要 |
|---|---|---|
| 平面形狀 | 矩形，四角可斜切 45°（`cornerStyle: "panCoupe"`） | 任意凸多邊形 |
| 轉角角度 | 90°（直角柱），或斜切後的兩個 135° | 任意角度 |
| 立面長度 | 3 m 開間的整數倍，加上轉角或端柱 | 任意長度 |
| 邊的種類 | street／court／party，由三種建築類型（`type`）決定 | 由地塊逐邊標記 |
| 屋頂平台、盲牆 | `roof.ts` 已支援**任意凸多邊形**與逐邊種類 | 可直接沿用 |
| 室內 | 房間盒在立面兩端會依距離收斜，不會穿插 | 可沿用；非 90° 轉角附近要再驗證 |

**已經能直接沿用的部分**：`insetEdges()`（逐邊內縮）、`roofShape()`、`roofCap()`、`partyWalls()`、全部立面規則（每個開間的窗、陽台、裝飾都只看局部座標）、`kit.buildGroup()`。

---

## 6. 兩個模組之間的接口

街道模組的產出，就是建築模組的輸入。建議以**地塊（Lot）**為單位交接：

```ts
/** 街道模組輸出（單位：公尺，Blender xy，逆時針，見第 4 節） */
interface Lot {
  id: string;
  /** 建築外牆線（已扣除人行道），凸多邊形，逆時針 */
  polygon: [number, number][];
  /** 每條邊的種類：edges[i] 對應 polygon[i] → polygon[i + 1] */
  edges: { kind: "street" | "court" | "party"; street?: string }[];
  /** 建築底部高度（人行道頂面），公尺 */
  base: number;
  /** 這塊地的建築參數（樓層、種子、配色……），沒給的用預設值 */
  params?: Partial<BuildingParams>;
}
```

邊的種類怎麼標：
- **street**：面向道路的邊，也就是街廓外輪廓上的邊。
- **party**：和相鄰地塊共用的邊，畫成盲牆。
- **court**：面向街廓內部空地（內院）的邊。如果地塊切到底、沒有內院，就是 party。

地塊必須符合的條件（不符合就在量體階段標紅）：

| 條件 | 原因 |
|---|---|
| 凸多邊形 | `insetEdges()` 和屋頂平台只支援凸多邊形；凹的地塊先切成凸的 |
| 內角在 60°–175° 之間 | 太尖的角放不下轉角零件；接近 180° 的頂點應該合併成一條邊 |
| street 邊長 ≥ 5 m | 至少要放得下兩端轉角（各 1 m）加一個開間（3 m） |
| 至少一條 street 邊 | 正面和大門要放在 street 邊上 |

---

## 7. 多邊形街道的建議做法

**沿用 v1 道路系統的核心，換一個產生器。** v1 從一開始就為任意角度設計（PLAN.md 第 1 節），所以不需要重寫：

1. **移植**：把 `../ProceduralBuilding_v1/road-system/src/core/`（`math2d`、`graph`、`derive`、`modules`、`city`）和 `render/` 移到本專案，例如放在 `src/road/`。保留「核心是純計算、渲染分開」的結構，入口仍是 `buildCity()`。
2. **新的產生器 `layout/editable.ts`**：取代棋盤產生器。資料是使用者可以編輯的節點與邊（`RoadNode`、`RoadEdge`），面追蹤（`graph.ts` 的 half-edge）自動找出街廓。這就是 v1 PLAN.md 第 6 階段規劃的工作。
3. **節點拖動**：在 three 場景用射線和地面（y = 0 的平面）求交，拖動節點的 (x, z)。拖動中只重算路網與量體；**放開滑鼠才重建完整建築**，因為整城的細節建築重建太慢，不適合每一幀都做。
4. **街廓 → 地塊**：
   - v1 的切分方法是雙線性四邊形參數化（PLAN.md 第 6 節「地塊切分」），只適用凸四邊形。
   - 多邊形街廓建議改成：沿每條 street 邊往內做一條帶狀區域（進深約 12–15 m），再用垂直於街道的切線切成一塊塊地塊。
   - 街廓轉角那一塊會有兩條 street 邊，正好對應建築的「街角」類型。
   - 街廓中央剩下的空地就是內院，地塊面向它的邊標成 court。
   - 非凸街廓先用 Clipper 之類的方法切成凸塊；v1 PLAN.md 第 6 階段也提到這點。
5. **人行道與建築的界線**：街廓外輪廓往內偏移「路緣 + 人行道寬」，就是建築外牆線。地塊多邊形用這條線，不要用路緣線。

**v1 程式碼要注意的地方**：
- v1 的 `Vec2` 和面方向都是在 three 的 (x, z) 平面定義的，交給建築系統前要換算（第 4 節）。
- v1 的主建築地塊（hero lot）只是為單棟港式大樓設計的。多邊形城市裡每塊地都會蓋建築，主建築地塊的概念可以拿掉。

---

## 8. 白色量體階段（先確認牆面數與角度）

這個階段的目的，是在套用細節之前，確認每塊地的幾何都放得下本專案的建築規則。

- **量體形狀**：地塊多邊形往上擠出到牆頂，上面再加一個內縮 1 m、高 3 m 的斜面，代表孟莎屋頂。這樣量體和最後的建築外形一致。
- **高度要和建築規則一致**，不要自己估。用 `upperRows(params)`（generator.ts）算出每層樓的高度：
  - 牆頂 = 4.4 + 各樓層高度總和
  - 簷口頂 = 牆頂 + 0.6
  - 平頂高度用 `roofShape(polygon, kinds, roofBase).z2`
- **檢查並顯示**（建議做成除錯疊圖，或在 GUI 列出）：
  - 每條邊的長度、種類、可以放幾個 3 m 開間
  - 每個頂點的內角
  - 不符合第 6 節條件的地塊或邊，用紅色標出
- **盲牆**：相鄰地塊樓層不同時，高出的那段盲牆會露出來，這是正確的巴黎街景。

---

## 9. 套用建築外觀（之後的整合工作）

整合時要把 `generateBuilding()` 從「四個固定方向的立面」改成「多邊形的每條邊一個立面」。需要改的地方：

1. **立面座標系**：每條邊一個 frame：原點是頂點 i，旋轉角是邊方向的 `atan2(dy, dx)`。現在程式裡固定的四個 `sideFrames` 是它的特例。
2. **開間配置**：
   - 可用長度 = 邊長 − 兩端轉角佔用。
   - 開間數 n = round(可用長度 / 3)。
   - 每個開間沿 x 縮放 s = 可用長度 / (3n)，s 限制在 0.88–1.12 之間；超出範圍就增減 n。
   - 縮放直接放進實例矩陣即可，three.js 的 InstancedMesh 會依各軸縮放修正法線。窗寬會跟著變，所以縮放範圍不要再放寬。
3. **任意角度的轉角**：這是最大的工作。現有的轉角零件（直角柱、斜切外框）都是固定角度。建議做法：
   - **在網頁端產生轉角**：把 `blender/kitlib/geom.py` 的 `sweep()`（剖面沿路徑擠出，含斜接）移植到 TypeScript，大約 80 行。
   - 剖面點列（腰線、簷口、陽台底板與欄杆、勒腳、溝槽石材、陡坡斜脊捲邊）由 `build_kit.py` 匯出成 JSON，例如 `public/assets/kit_profiles.json`，兩邊共用同一份資料。
   - 這樣任何角度都完全吻合，凹角也一樣。材質沿用 kit 的同名材質；這些幾何沒有 UV1，所以用 `:noao` 材質（參考 `roofCap` 的做法）。
   - 替代方案：在 Blender 預先做好每 10° 一組的轉角零件，再把地塊角度微調到最近的一組。這樣比較簡單，但角度不精確，零件數也會多將近 100 個。
4. **屋頂**：
   - `roofCap()` 和 `partyWalls()` 已經支援多邊形，可以直接用。
   - 陡坡的斜脊（`R_mansard_corner` 是 90° 專用）要改成依角度產生：從底部轉角到內縮後頂部轉角的兩個三角形，加一條捲邊。
   - 簷口轉角同樣用上面的剖面擠出。
5. **多棟建築**：
   - 全部建築的 placements 合併成一次 `kit.buildGroup()`，每種零件只有一個 InstancedMesh。
   - 每棟的屋頂、盲牆、室內幾何合併成一個 mesh。
6. **效能**：
   - 預設參數的一棟在階段 C 實測為 54,062 個三角形、66 次繪製；之後加了屋頂裝飾、店面、室內，現在更多一些。
   - 幾十棟時要做遠景簡化（LOD）：鏡頭遠的建築只畫白色量體加簡化屋頂，近的才畫細節。
   - 陰影範圍只框住鏡頭附近（沿用 v1 的做法）。

---

## 10. 驗收清單

**街道模組**
- [ ] 節點可以在水平面上拖動，路網、路緣、標線、街廓即時更新
- [ ] 任意角度的路口幾何正確（v1 的節點擾動測試仍要通過）
- [ ] 每塊地輸出第 6 節的 `Lot`，邊的種類正確
- [ ] 換算到 Blender 座標後，多邊形是逆時針

**量體階段**
- [ ] 量體高度和 `upperRows()`、`roofShape()` 一致
- [ ] 不符合條件的地塊、邊會被標出

**整合**
- [ ] 多邊形每條 street 邊都是完整立面，轉角無縫、無穿插
- [ ] 相鄰建築之間是盲牆，高度不同時露出防火山牆
- [ ] 建築底部和人行道同高
- [ ] 拖動時流暢；放開後細節建築在可接受時間內出現

---

## 11. 已知限制與待辦（本專案）

- 鐵花欄杆的線條很細，遠看時會因為透明度門檻而消失。
- 夜晚環境光弱，轉角石上的 AO 比較明顯，看起來像一格格偏暗的方塊。
- 窗扇往外開角度大時，會穿過窗前欄杆。巴黎的落地窗幾乎都是內開，所以預設是內開。
- 開窗只做了上層的落地窗，一樓窗和老虎窗都是關著的。
- AO 圖集 `kit_ao.jpg` 有 1.2 MB，是目前最大的貼圖。
- 開間數是偶數的正面，大門放在中線左或右一格，由隨機種子決定。
