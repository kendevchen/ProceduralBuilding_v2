# 新對話的第一句話（複製貼上）

**原則**：先讀 `STATE.md`，一次一件事，指定要讀的檔案。開新對話比在舊對話繼續便宜很多。

## 1. 開發新功能
```
先讀 STATE.md。任務：〔一句話，例如：在臥室加一張雙人床〕。
只讀：〔例如 src/furniture.ts 與 INTERIOR_SPEC.md 的 6.8〕，不要掃整個專案。
先列出你的做法與限制給我確認，建議用哪個 model 與 effort，我同意再動工。
完成後跑 tsc 與 build，commit，但先不要推送。
```

## 2. 修一個問題
```
先讀 STATE.md。問題：〔現象；附一張標了位置的截圖〕。
只看：〔相關檔案〕。先說你認為的原因，再修。
修完只截一張確認，commit，不要推送。
```

## 3. 給其他 AI
```
你負責〔任務〕。先讀 STATE.md，只讀它指定的檔案與章節。
只改：〔檔案〕。尺寸只改 blender/kit_dims.json。
跑 tsc、build、planCheckAll，全過才算完成。不要 commit，不要推送；
列出改了哪些檔案、哪裡不確定。
```

## 4. 做新專案（用模型包）
```
我要用附上的零件庫（model/、scripts/、docs/）做〔新專案〕。
先讀 README.md 與 docs/modeling-method.md。授權是 CC0。
先回答：怎麼用、哪些要重做、哪些會連動，等我確認再開始。
```
