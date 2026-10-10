# 发布流程（RELEASE）

> 对应 `npm run release` / `node scripts/release.js`（§7.3）。

## 1. 前置

- Node ≥ 22（见 `.nvmrc`）。
- `npm ci` 装齐依赖。
- 全量验证通过：`npm test`、`npm run lint`、`npm run typecheck`、
  `E2E_STARTUP_TIMEOUT_MS=180000 npm run e2e`。

## 2. 发布步骤

```bash
# 1) 递增版本并生成发布包（patch / minor / major 三选一）
npm run release -- patch

# 2) 人工检查产物（scripts/pack.js 的输出目录）
# 3) 打 tag 并推送（由人执行——脚本不自动 tag/push）
git tag v$(node scripts/release.js --version)
git push origin main --tags
```

## 3. 脚本做了什么 / 不做什么

- **做**：递增 `package.json` 的 `version`；调用 `scripts/pack.js` 生成发布包。
- **不做**：不 `git tag`、不 `push`、不改 CHANGELOG——这些交给人和 CI。
  原因：自动推送把"什么时候发、发到哪"的决定权从人手里拿走了，一旦误触发代价高。

## 4. 回滚

- 版本号改错：`git checkout package.json` 直接还原。
- 已发布：按部署方的回滚流程切回上一版镜像/目录；数据侧无 schema 变更（本轮存储未关系化），回滚无数据风险。
