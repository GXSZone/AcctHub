---

name: architecture-and-governance
trigger: always_on
description: AcctHub 全栈架构分层、Drizzle ORM、Zod 契约、TanStack Query 与防退化红线规范。
---

# AcctHub 架构分层与代码治理规范

本项目采用 **React 19 + Vite 6 + TanStack Query 5 + Hono 4 + Drizzle ORM + Zod 4 + Cloudflare Workers/D1** 全栈架构。所有新增功能与重构代码必须严格遵守以下硬性约束：

## 1. 目录与垂直领域分层

1. **共享契约与纯领域层（`shared/`）**
   - `shared/contracts/<domain>.contract.ts`：前后端唯一的请求/响应 Zod Schema 与 TypeScript 类型真相源。禁止在前端与后端分别手写两套重复的 DTO 类型。
   - `shared/domain/`：无副作用纯函数（金额精度、质保计算、状态机、多语种回退等）。
   - `shared/constants/`：全站共享枚举、状态常量与 5 语种错误码字典。
   - 严禁在 `shared/` 中导入 DOM/React 或 Cloudflare Workers 运行时专属 API。

2. **后端三层垂直领域（`worker/`）**
   - `worker/infra/`：底层基础设施（`db.ts` Drizzle D1 客户端、加解密、日志、HTTP 响应、邮件、Cloudflare SaaS）。
   - `worker/middleware/`：横切中间件（租户解析、鉴权/RBAC、Zod 校验、5 语种错误拦截、CORS/限流）。
   - `worker/domains/<domain>/`：按垂直业务域组织，严格拆分三层：
     - `*.repo.ts`：纯 Drizzle ORM 数据访问层，封装全部表查询、写入与原子条件更新。
     - `*.service.ts`：核心业务规则、状态机校验、事务/补偿编排与领域事件。
     - `*.routes.ts`：极薄 Hono HTTP 接入层，**仅负责**鉴权、Zod 校验中间件与调用 Service 返回响应。
   - **严格禁止**：
     - 禁止在 `*.routes.ts` 中直接操作数据库或编写 SQL；
     - 禁止新建或向已废弃的 `worker/lib/` 追加任何新代码（重构期间持续将旧模块收编至 `worker/infra/` 或 `worker/domains/`）。

3. **前端垂直功能架构（`src/`）**
   - `src/api/<domain>.api.ts`：按领域拆分的薄 HTTP 客户端，直接复用 `shared/contracts/` 类型。禁止继续向历史巨石文件 `src/lib/api.ts` 追加新接口。
   - `src/queries/<domain>.queries.ts`：全站统一使用 TanStack Query v5 管理服务端状态，集中定义 `queryKeys`、`useQuery`、`useMutation` 与缓存失效策略。
   - `src/features/<domain>/`：按功能域组织容器组件、小粒度展示子组件与局部 Hook。
   - `src/components/ui/`：无业务耦合的通用基础 UI 原语。
   - **严格禁止**：禁止在组件内用 `useEffect` + `useState` 手动发 `fetch` 拉取业务接口（除极少数底层非缓存一次性事件如流式/WebSocket）。

## 2. 数据库与 Drizzle ORM 铁律

- **唯一 DDL 真相源**：所有表结构与索引统一定义在 `worker/db/schema/` 并由 `migrations/*.sql` 管理；**严禁**在运行时请求路径中执行 `CREATE TABLE`、`ALTER TABLE` 或动态 DDL 迁移。
- **零裸 SQL 红线**：所有新代码与已重构领域必须 100% 使用 Drizzle ORM（`db.select/insert/update/delete`）；严禁新增手写 `env.DB.prepare(...)`。极少数 Drizzle 无法直接表达的复杂聚合/SQLite 特性必须封装在 `*.repo.ts` 内并使用 Drizzle 类型化 `sql` 模板。
- **演示数据隔离**：演示种子数据仅放于 `worker/db/seeds/`，通过独立脚本或本地开发显式命令注入，绝不混入生产业务逻辑。

## 3. 文件规模与代码纯净度红线

- **高内聚与合理模块粒度**：以单一职责和模块高内聚为准，避免机械按固定行数过度拆散逻辑。单文件超过 600 行时 `arch-guard` 仅作软提醒以辅助评估拆分收益与维护代价，不设硬性行数拦截。
- **零类型逃逸**：严禁使用 `any`、`@ts-ignore`、`@ts-expect-error`（除非附带明确中文说明）及无根据的 `as unknown as` 强转；所有外部输入（HTTP Body/Query/Params、Webhook、JSON 字段）必须经 Zod 校验。
- **向后兼容**：重构期间保持全部既有 REST API 路径、代理 B2B Open API 协议与上游回调契约 100% 向后兼容，不得静默破坏已有契约。
- **工具禁令**：严禁执行 `biome check --write --unsafe`（防止误改 React Hook 依赖），严禁使用 `npx tsx`。
