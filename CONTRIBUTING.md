# 贡献指南

欢迎向 **AcctHub** 提交问题反馈、功能建议与 Pull Request。为保持代码质量与资金安全防线，请在参与贡献前阅读以下规范。

## 开发环境

- **Node.js**：`24.19.0`
- **pnpm**：`10.34.9`

```bash
git clone <repository-url>
cd AcctHub
pnpm install --frozen-lockfile
pnpm run db:migrate:local
pnpm run dev
```

## 分支与提交规范

- 所有文档、代码注释与提交信息均使用**简体中文**（专有技术名词、路径、标识符及 CLI 命令保留原文）。
- 仓库内置 `.githooks/`（包含 `pre-commit` 全量门禁与 `commit-msg` 提交信息校验）和 `.gitmessage` 提交模板，执行 `pnpm install` 时会自动配置钩子目录；也可手动一键启用：

```bash
git config core.hooksPath .githooks
git config commit.template .gitmessage
```

- 提交标题须遵循 `<type>(<scope>): <简体中文描述>` 格式（由 `scripts/check-commit-msg.mjs` 自动校验，首行不超过 80 字，禁止无意义占位或纯英文描述）：
  - `feat`：新功能或体验增强（例如 `feat(brand): 新增双卡叠放标志与站点图标`）
  - `fix`：缺陷修复与安全加固（例如 `fix(payment): 修复多规格切换时选号列表未重置问题`）
  - `refactor`：架构调整与代码重构（例如 `refactor(orders): 拆分订单履约校验逻辑`）
  - `docs`：文档与 README 更新（例如 `docs(readme): 补充初版开发说明与全场景预览图`）
  - `test`：补充单元、集成或 E2E 测试（例如 `test(coupon): 增加高并发优惠券核销竞态用例`）
  - `perf` / `style` / `build` / `ci` / `chore` / `revert`：性能优化、格式整理、构建、CI 或杂项调整
- **小步原子提交**：建议按独立领域或明确目标分批提交，禁止将临时测试产物、密钥文件或本地数据库状态提交进仓库。

## 代码与架构要求

修改源码需严格满足以下基线（由 `pnpm run arch:check` 自动强制校验）：

1. **前后端共享契约**：请求与响应 Schema、DTO 类型及枚举统一放在 `shared/`，禁止双端手写重复定义。
2. **垂直分层解耦**：
   - `worker/domains/<domain>/` 严格拆分为 `*.repo.ts`（纯 Drizzle ORM）、`*.service.ts`（业务逻辑与原子控制）和 `*.routes.ts`（薄 HTTP 路由）；
   - 路由层严禁直连数据库；
   - 前端 `src/features/` 严禁直接调用裸 `fetch()`，须经由 `src/api/` 与 `src/queries/`（TanStack Query v5）。
3. **零裸 SQL**：禁止使用 `DB.prepare(...)`，统一使用 Drizzle ORM。
4. **高内聚与合理粒度**：以高内聚和单一职责为准，不设机械的硬性行数拦截；单文件超过 600 行时 `arch-guard` 会给出软提示，供评估是否具备拆分收益。
5. **5 语种国际化与无硬编码中文**：`src/`（除 `src/i18n/` 与测试外）禁止直接出现硬编码中文文案；`src/i18n/namespaces/<domain>/` 内 `zh-CN`、`zh-TW`、`en`、`ja`、`ko` 的键名必须 100% 对称。
6. **禁止危险命令**：严禁运行 `biome check --write --unsafe` 或使用 `test.skip` 绕过失败测试。

详细设计约定参见 [架构与工程规范](./docs/architecture.md) 与 [AGENTS.md](./AGENTS.md)。

## 提交前验证

提交 PR 前请确保全部本地门禁通过（0 error / 0 warning）：

```bash
pnpm run check
pnpm exec vitest run --config vitest.d1.config.ts
```

涉及核心前端流程、收银台或管理后台交互变更时，请补充并运行端到端测试：

```bash
pnpm run test:e2e
```
