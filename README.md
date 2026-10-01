# ProceduralBuilding_v2

歐式風格的程序化建築：用 Blender Python 製作零件庫，在 Three.js 中依規則組合生成。

- 線上預覽：https://kendevchen.github.io/ProceduralBuilding_v2/
- 前一版（港式大樓與道路城市系統）：[ProceduralBuilding_v1](https://github.com/kendevchen/ProceduralBuilding_v1)

## 開發

```bash
npm install
npm run dev     # http://localhost:5176/
npm run build
```

## 目前進度

- [x] 檢視頁：燈光氛圍、天空、後製與效能設定（沿用 v1）
- [x] 歐式零件規格（[`blender/KIT_SPEC.md`](blender/KIT_SPEC.md)）
- [x] 階段 A 骨架：Python 零件產線（17 個零件）、匯出、網頁排列（獨棟、樓高遞減）、屋頂平台
- [x] 階段 B 材質：自製無縫貼圖、石材分縫、鋅板立縫、鐵花圖樣、每棟配色、零件總覽
- [x] 階段 C 立面細節：窗套、窗楣山花、托架、百葉、窗間壁裝飾、大門變化、裝飾層級規則
- [x] 階段 D 屋頂：多種老虎窗、屋脊花飾與尖頂飾、煙囪
- [x] 階段 E 平面與街面：斜切轉角、街角與連棟、盲牆與防火山牆、店面與遮雨棚、內院立面
- [x] 階段 F 室內與烘焙：自建房間圖集、窗後室內、窗簾、透明玻璃、日夜燈光、AO

零件改了之後重建 kit：`npm run kit`（之後可再 `npm run ao` 重烘 AO）；貼圖：`npm run tex`；室內圖集：`npm run rooms`（都需要 Blender 5.1+，見 [`blender/README.md`](blender/README.md)）。
