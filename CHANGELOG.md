# 更新日志（Changelog）

本文档记录 AcctHub 的重要版本演进、功能里程碑与工程变更。

## [0.1.0-alpha.1] - 2026-11-24

> [!WARNING]
> 当前为早期初版开发预览版本，尚存在已知及潜在 Bug，**不建议直接用于正式生产环境或承载真实资金交易**，推荐用于架构研究与本地沙盒体验。

### 新增特性与架构交付

- **边缘原生全栈架构**：前端基于 React 19 + Vite 6 + Tailwind CSS v4 + TanStack Query v5 + React Router v7，后端基于 Cloudflare Workers + Hono 4 + Drizzle ORM + Zod 4 与 Cloudflare D1（SQLite）。
- **多形态自动发卡引擎**：支持卡密库存、选号下单、限时秒杀、隐藏口令、组合套餐、拼团合租、阶梯批发价与私有自营商品。
- **多级白牌分站体系**：支持最多 3 级代理架构、自定义域名（Cloudflare for SaaS）、分站独立收款直收隔离与 B2B Open API。
- **多元支付与多上游容灾**：内置易支付、支付宝当面付（RSA2）、Stripe、USDT（TRC20 / ERC20 / BEP20）与钱包余额支付，支持多货源主备切换、独立验签与断线续查。
- **安全防线与资金守恒**：实现原子扣库/扣款防超卖、AES-256-GCM 静态加密与密钥轮换、5 维风控熔断、管理员 TOTP 2FA 及 7 项财务对账巡检。
- **全站 5 语种与多币种**：按业务域懒加载 `zh-CN` / `zh-TW` / `en` / `ja` / `ko` 语言包，并支持多币种实时展示换算。

### 工程治理与自动化门禁

- 建立 Biome 零警告检查、TypeScript 严格类型检查、`arch-guard.mjs` 分层守卫与 `migrations/` 基线校验。
- 配套真实 `workerd` D1 事务集成测试、26 项 Playwright 端到端闭环验收以及 GitHub Actions 自动 CI 与打标打包工作流。
- 完善简体中文 Conventional Commits 提交规范校验（`.githooks/commit-msg` 与 `.gitmessage`）。
