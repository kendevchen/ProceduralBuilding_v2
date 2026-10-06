# 房間規劃器改版前備份

日期：2026-10-07。

- 檔案：`room-planning-v1-f0ec2b2.tar.gz`
- 基準：`f0ec2b2aae6e592133ef81fa986f25be2351ac66`（`feature/room-editor`）
- 用途：下一個模型實作大型建築配置之前，保存原本的房間規劃器及整合程式。GUI 已開放 20×20／20 上層，但規劃核心尚未依大型建築改版。
- 規劃文件：[大型建築空間配置調整與模型交接計畫](../Guide/大型建築空間配置調整與模型交接計畫.md)。

## 內容

包含基準版本的 `src/`、`scripts/`、`blender/kit_dims.json`、`package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`CLAUDE.md`、`STATE.md`、`INTERIOR_SPEC.md`。

不包含模型／貼圖、Blender 產生器全套、node_modules、Git 歷史及未提交的工作區變更。因此這是程式碼比較快照，不是獨立可執行的部署包。完整基線以 Git commit 為準。

壓縮檔內每個檔案已逐一與 `git show f0ec2b2:<path>` 比較，內容一致。

SHA-256：

```text
0c8bb9b7fddfac3d8ce004ef620ab897c1ba4d0960db681512eea864de80a23e
```

## 檢視與安全解壓

在專案根目錄執行：

```sh
tar -tzf backups/room-planning-v1-f0ec2b2.tar.gz
backup_review_dir=$(mktemp -d /tmp/room-planning-v1.XXXXXX)
tar -xzf backups/room-planning-v1-f0ec2b2.tar.gz -C "$backup_review_dir"
```

請解壓到新目錄比較，不要直接覆蓋目前工作區。僅需查看原規劃器時可用：

```sh
git show f0ec2b2:src/plan.ts
git diff f0ec2b2 -- src/plan.ts src/roomEdits.ts src/params.ts src/rng.ts
```

備份中的說明文件是基準版本原文；下一階段以外部交接計畫及使用者最新指示為準，不因舊文件連結而讀取不存在的 archive。
