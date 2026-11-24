# 架构与工程规范

AcctHub 采用面向边缘运行时优化的全栈分层架构：**React 19 + Vite 6 + TanStack Query v5 + Hono 4 + Drizzle ORM + Zod 4 + Cloudflare Workers / D1**。

---

## 1. 全栈分层模型

仓库按照“契约共享 + 后端垂直域三层分离 + 前端功能切片”划分：

| 层级             | 目录                                                       | 职责与核心约束                                                                                                                                               |
| :--------------- | :--------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共享真相源       | `shared/constants/`、`shared/contracts/`、`shared/domain/` | 唯一请求/响应 Zod Schema、DTO 类型、错误码（5 语种）与无副作用领域纯函数（金额精度、质保期、价格与语言回退）。**严禁导入 React 或 Hono 运行时依赖**。        |
| 后端数据库建模   | `worker/db/schema/`、`migrations/`                         | Drizzle ORM 表结构定义与官方 SQLite 迁移文件，受 `migrations/manifest.json` SHA-256 校验保护。禁止在业务请求中动态执行 `CREATE/ALTER TABLE`。                |
| 后端基础设施     | `worker/infra/`、`worker/middleware/`                      | 加解密原语、脱敏日志、HTTP 安全头、Turnstile 验证、CORS、限流、Outbox 队列、租户解析与统一多语种错误处理中间件。                                             |
| 后端业务域       | `worker/domains/<domain>/`                                 | 按领域拆分 `*.repo.ts`（纯 Drizzle ORM）、`*.service.ts`（状态机/事务/原子防双花编排）、`*.routes.ts`（极薄 Hono HTTP 接入）。**路由层严禁直接操作数据库**。 |
| 沙盒演示数据     | `worker/db/seeds/`                                         | 仅在 `APP_ENV=development` 且 `SANDBOX_MODE=true` 生效，生产与预发环境零执行。                                                                               |
| 前端接口与状态   | `src/api/`、`src/queries/`                                 | 按业务域拆分的 HTTP 客户端与 TanStack Query v5 `useQuery` / `useMutation` 及失效键管理，严格复用 `@shared/*` 类型。                                          |
| 前端功能界面     | `src/features/`、`src/components/`、`src/pages/`           | 容器与展示组件，禁止直接在 `src/features/` 发起裸 `fetch()` 调用；富文本统一经 `DOMPurify` 清洗。                                                            |
| 按域懒加载国际化 | `src/i18n/locales/`、`src/i18n/namespaces/`                | 全站支持 5 语种按需加载，由静态守卫脚本校验词条键集合 100% 对称。                                                                                            |

---

## 2. 自动化架构守卫（`arch-guard`）

每次执行 `pnpm run arch:check`（以及 `pnpm run check`），`scripts/arch-guard.mjs` 会扫描 `shared/`、`src/` 与 `worker/` 下的全部源码：

1. **模块粒度软评估（不阻断）**：当单文件超过 `600` 行时输出软提醒，由开发者结合内聚性与职责边界权衡是否需要拆分，避免机械碎片化拆分。
2. **零裸 SQL 红线**：全仓禁止出现 `DB.prepare(`，数据读写 100% 使用 Drizzle ORM。
3. **后端路由分层校验**：`worker/domains/<domain>/*.routes.ts` 禁止导入数据库连接或历史遗留模块。
4. **前端通信分层校验**：`src/features/` 禁止直接调用 `fetch()`，必须走 `src/api/` 与 `src/queries/`。
5. **共享层纯净度校验**：`shared/` 禁止导入 `react` 或 `hono`。
6. **5 语种键对称检查**：`src/i18n/locales/` 及 `src/i18n/namespaces/*/` 中的 `zh-CN.ts`、`zh-TW.ts`、`en.ts`、`ja.ts`、`ko.ts` 必须具有完全一致的词条键列表。
7. **前端零硬编码 UI 中文**：除 `src/i18n/` 与测试代码外，`src/` 下的代码正文严禁出现未收口中文字符串。

---

## 3. 数据库迁移与 Schema 治理

- 所有建表与索引修改须同步体现在 `worker/db/schema/` 与 `migrations/*.sql`，并通过 `scripts/migration-manifest.mjs` 与 `scripts/baseline-schema.mjs` 验证结构一致性；
- 本地测试环境通过 `vitest.d1.config.ts` 与 `node:sqlite` 直接回放 `migrations/` 权威建表文件，确保测试与线上 D1 DDL 100% 等价；
- 远端预发与生产执行 `node scripts/migrate-db.mjs --remote --env <staging|production>` 前会自动比对线上表结构，检测到 Schema 漂移时立即拒绝危险迁移。

---

## 4. 资金并发与密码学原语设计

- **CAS 条件并发控制**：订单扣库（`status = 'available'`）、钱包扣减（`balance >= ?`）、优惠券核销与支付状态流转（`status = 'pending' -> 'paid'`）全部采用条件 `UPDATE` + 受影响行数校验（`changes > 0`）。
- **凭证与卡密加密存储**：
  - 使用 `DATA_ENCRYPTION_KEYS`（支持多版本 JSON KeyRing `{"active":"v1","keys":{"v1":"..."}}`）基于 AES-256-GCM 对支付密钥、上游秘钥、邮件秘钥与卡密内容进行加密；
  - 使用 `DATA_FINGERPRINT_KEY` 生成独立盲索引，用于代理 API Key 或防重复录入校验；
  - 所有对外响应体、审计日志与错误堆栈均实施脱敏，绝不回吐解密明文或商户私钥。
- **金额运算精度**：金额统一使用 `shared/domain/money.ts` 中的精确舍入辅助函数，现金保留 2 位小数，USDT 唯一尾数保留 4 位小数。

---

## 5. 5 语种国际化约定

- 支持语种枚举定义于 `shared/constants/enums.ts`：`zh-CN`、`zh-TW`、`en`、`ja`、`ko`；
- 数据库运营字段（商品名称、副标题、Markdown 说明、分类、公告等）通过 `translations_json` 配合 `shared/domain/i18n.ts` 的 `resolveLocalizedField` 实现 `目标语种 → en → zh-CN` 三级回退；
- 后端接口错误信息通过 `shared/constants/error-codes.ts` 绑定多语种映射，根据请求 `X-Lang` 或 `Accept-Language` 自动本地化输出。
