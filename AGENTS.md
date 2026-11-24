# AcctHub 项目协作与工程约束指南

本文件为所有开发者与 AI 编码代理提供项目全栈约定与红线总览。更多细则详见 `.agents/rules/` 与 [docs/architecture.md](./docs/architecture.md)。

## 核心技术栈

- **前端**：React 19 + Vite 6 + Tailwind CSS v4 + TanStack Query v5 + React Router v7
- **后端**：Cloudflare Workers + Hono 4 + Drizzle ORM + Zod 4
- **数据库**：Cloudflare D1（SQLite）
- **工具链**：TypeScript 5.8 + Biome 2.6 + Vitest 5 + Playwright（Node `24.19.0` / pnpm `10.34.9`）

## 目录职责与分层边界

```text
shared/                  # 唯一契约真相源（constants / contracts / domain）
  ├── constants/         # 全局枚举、限额与 5 语种错误码字典
  ├── contracts/         # 前后端共用的 Zod Schema 与 DTO 类型
  └── domain/            # 金额精度、质保期、价格与多语种纯函数
worker/                  # Cloudflare Workers 后端
  ├── db/schema/         # Drizzle ORM 唯一建表模型
  ├── db/seeds/          # 仅限本地 development + SANDBOX_MODE=true 的演示种子
  ├── domains/<domain>/  # *.repo.ts / *.service.ts / *.routes.ts 三层分离
  ├── infra/             # 加解密、日志、邮件投递队列、安全头、Cloudflare SaaS
  └── middleware/        # 租户解析、鉴权、全局多语种错误处理、CORS 与限流
src/                     # React 前端
  ├── api/               # 按领域拆分的薄 API 请求封装
  ├── queries/           # TanStack Query v5 queries / mutations / queryKeys
  ├── features/<domain>/ # 功能容器组件、子组件与局部 Hook
  ├── i18n/namespaces/   # 按业务域拆分的 5 语种懒加载语言包
  └── components/ui/     # 通用基础 UI 原语
migrations/              # 官方 D1 SQL 迁移脚本与 SHA-256 清单（manifest.json）
```

## 不可妥协的工程红线

以下约束由 `pnpm run arch:check` 自动强制验证，违反任何一条都会阻断检查：

1. **零裸 SQL**：严禁在源码中新增 `DB.prepare(`，数据读写必须 100% 使用 Drizzle ORM，SQLite DDL 必须通过 `migrations/` 管理，禁止运行时建表或改表。
2. **高内聚与合理模块粒度**：以单一职责和高内聚为优先原则，避免为追求小文件而机械过度拆分；当单文件超过 600 行时，`arch-guard` 会发出软提醒以辅助评估拆分代价与收益，不做机械硬拦截。
3. **后端路由纯洁性**：`worker/domains/<domain>/*.routes.ts` 仅负责参数校验与鉴权，严禁直接导入数据库客户端或写入业务逻辑。
4. **前端通信约束**：`src/features/` 下严禁直接调用 `fetch()`，必须走 `src/api/` 与 `src/queries/`。
5. **共享层纯洁性**：`shared/` 禁止导入 `react` 或 `hono` 等运行时依赖。
6. **5 语种对称与零硬编码中文**：`src/`（除 `src/i18n/` 与测试）不得出现硬编码 UI 中文字符；每个国际化目录的 `zh-CN`、`zh-TW`、`en`、`ja`、`ko` 键集合必须完全对称。
7. **类型严谨**：禁用 `any`、`@ts-ignore`；严禁使用 `biome check --write --unsafe` 与 `npx tsx`。
8. **简体中文规范**：代码注释、项目文档与 Git 提交信息均严格使用简体中文。

## 常用验证命令

```bash
pnpm run check                                   # Biome + TypeScript + 架构守卫 + Vitest + 构建
pnpm exec vitest run --config vitest.d1.config.ts # 基于真实 SQLite/D1 迁移文件运行后端集成测试
pnpm run test:e2e                                # Playwright 端到端回归测试
pnpm run deploy:preflight -- --env production --dry-run # 生产配置与迁移一致性预检
```
