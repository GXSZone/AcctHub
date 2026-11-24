<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="./docs/assets/logo-light.svg" />
    <img src="./docs/assets/logo-light.svg" alt="AcctHub Logo" width="88" height="88" />
  </picture>
  <h1>AcctHub</h1>
  <p>运行在 <strong>Cloudflare Workers + D1</strong> 边缘计算栈上的全栈多级代理自动发卡与数字商品交易系统，覆盖零成本边缘部署、白牌分站分发、多渠道支付聚合、上游货源对接与金融级资金账本对账。</p>
  <br />
  <img src="./docs/assets/hero-banner.png" alt="AcctHub 全栈与全场景全景横幅" width="100%" />
</div>

> [!WARNING]
> **初版开发阶段声明（不建议用于生产环境）**
> 本项目目前仍处于**早期初版开发阶段**，部分边界场景与交互流程仍在持续迭代修复中，尚存在已知及潜在 Bug，**现阶段不建议直接用于正式生产环境或承载真实资金交易**。推荐用于技术研究、Cloudflare 边缘全栈架构学习及本地沙盒演示体验。

---

## 核心特性概览

- **边缘原生全栈架构**：前端采用 React 19 + Vite 6 + TanStack Query v5，后端基于 Hono 4 + Drizzle ORM + Zod 4 部署于 Cloudflare Workers 与 D1。
- **多形态自动发卡引擎**：支持卡密库存、选号下单、限时秒杀、隐藏口令、组合套餐、拼团合租、阶梯批发价、游客/会员分层定价与私有自营商品。
- **多级白牌分站体系**：支持最多 3 级代理架构、独立自定义域名（Cloudflare for SaaS）、分站自有收款直收通道隔离与 B2B Open API。
- **多元支付与多上游容灾**：内置易支付、支付宝当面付（RSA2）、Stripe、USDT（TRC20 / ERC20 / BEP20）与余额支付，支持多货源主备切换与独立回调验签。
- **安全与资金一致性防线**：采用 CAS 原子扣库/扣款防超卖、AES-256-GCM 凭证落库加密与密钥轮换、5 维风控熔断、管理员 TOTP 2FA、7 重财务账本守恒巡检。
- **全站 5 语种与多币种**：按业务域懒加载 `zh-CN` / `zh-TW` / `en` / `ja` / `ko`，支持多币种实时展示换算与人工审核/自动同步工作流。

---

## 全场景界面预览（Visual Showcase）

> 以下全部截图均直接采集自项目内置的本地沙盒全功能闭环环境。

### 1. C 端商城、多语言暗夜主题与智能辅助

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-storefront.png" alt="主站商城首页（暖调列表视图）" /><br />
      <sub><strong>主站暖调列表视图</strong> · 分栏目录、标签筛选与多币种联动</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-storefront-dark.png" alt="暗夜模式英文杂志卡片视图" /><br />
      <sub><strong>深炭黑暗夜模式 + 英文语言 + 杂志网格卡片</strong></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-concierge-search.png" alt="自然语言智能意图选品" /><br />
      <sub><strong>自然语言智能选品（Concierge）</strong> · 语义推荐匹配席位</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-2fa-tool.png" alt="纯浏览器端离线 2FA 验证工具" /><br />
      <sub><strong>纯本地离线 2FA 动态口令工具</strong> · 实时解析 6 位码与二维码</sub>
    </td>
  </tr>
</table>

### 2. 高转化营销引擎与多形态交付

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-product-detail.png" alt="前台自选靓号与会员专享价" /><br />
      <sub><strong>前台预选靓号 + 游客/会员分层定价</strong> · CAS 条件锁防撞单</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-product-groupbuy.png" alt="2 人拼团合租自动发车" /><br />
      <sub><strong>拼团合租（Group Buy）</strong> · 一键开团参团，满员并发发卡</sub>
    </td>
  </tr>
</table>

### 3. 多级白牌分站与 B2B Open API

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-agent-store.png" alt="独立白牌分站前台（星尘 AI 研选社）" /><br />
      <sub><strong>千店千面白牌分站前台</strong> · 独立品牌名称、主题与加价策略</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-agent-portal.png" alt="分站工作台总览与收益提现" /><br />
      <sub><strong>分站运营工作台</strong> · 实时分账收益、3 级下级网与一键晋级</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-agent-pricing.png" alt="分站选品、独立改文案与批量加价" /><br />
      <sub><strong>分站多 SKU 定价中心</strong> · 拿货底价保护与尾数取整批量生效</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-agent-api.png" alt="B2B 批采密钥与兼容发卡接口" /><br />
      <sub><strong>B2B 开放接口与密钥管理</strong> · 轮换密钥、IP 白名单与实时试跑</sub>
    </td>
  </tr>
</table>

### 4. 全功能商品编辑器与多上游容灾

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-admin-editor.png" alt="全功能商品滑出式编辑器（防亏毛利校验）" /><br />
      <sub><strong>全功能滑出式编辑器</strong> · 多规格/营销/AI 优化与防亏毛利底线保护</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-admin-editor-preview.png" alt="主站前台整页实时预览模式" /><br />
      <sub><strong>主站整页实时预览</strong> · 所见即所得，草稿态直接映射前台细节</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="./docs/assets/shot-admin-upstream.png" alt="多上游货源聚合与主备容灾配置" width="76%" /><br />
      <sub><strong>多上游货源与主备 Failover 容灾</strong> · AES-256 密钥加密、余额预警与多源 SKU 路由</sub>
    </td>
  </tr>
</table>

### 5. 运营总控、安全风控与 7 重财务守恒

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-admin-overview.png" alt="总控运营概览与紧急止损开关" /><br />
      <sub><strong>运营总控 KPI 与紧急止损</strong> · 一键暂停发卡 / 紧急闭店与待办追踪</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-admin-finance.png" alt="全站 7 项财务账本守恒巡检" /><br />
      <sub><strong>7 重财务账本一致性巡检</strong> · GMV/成本/分润/负债实时核对零漂移</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-admin-agents.png" alt="多级代理拓扑管理与权限覆写" /><br />
      <sub><strong>3 级代理拓扑治理</strong> · 独立域名绑定、允许自有收款与私有商品控制</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/assets/shot-admin-settings.png" alt="站点配置、支付插件、Webhook 与安全风控" /><br />
      <sub><strong>全站配置与纵深防线</strong> · 支付插件、出站 Webhook、风控熔断与管理员 2FA</sub>
    </td>
  </tr>
</table>

---

## 文档导航

关于产品功能详情、系统架构、接口契约、上线部署与日常运维，请查阅 [`docs/`](./docs/) 中的专题文档：

| 文档                                       | 内容说明                                                                         |
| :----------------------------------------- | :------------------------------------------------------------------------------- |
| [功能全景介绍](./docs/features.md)         | 前台商城、营销玩法、多级代理分站、支付聚合金流、上游对接、风控与运营后台功能详解 |
| [架构与工程规范](./docs/architecture.md)   | 全栈分层架构、共享契约、`arch-guard` 自动化守卫红线与国际化约定                  |
| [部署与配置指南](./docs/deployment.md)     | Cloudflare D1 创建、Secrets 密钥管理、冷启动向导、密钥轮换与域名接入             |
| [接口参考手册](./docs/api-reference.md)    | 代理 B2B Open API、前台目录、下单恢复、会员中心与管理后台核心端点说明            |
| [运维与财务巡检指南](./docs/operations.md) | 账本一致性对账脚本（`operational-check`）、灾难回滚与日常维护建议                |
| [安全策略](./SECURITY.md)                  | 漏洞上报流程、生产安全基线与密钥保护准则                                         |
| [贡献指南](./CONTRIBUTING.md)              | 本地开发流、提交前门禁、分支规范与代码审查要求                                   |

---

## 快速体验（本地沙盒）

系统在本地开发模式下默认启用安全隔离的沙盒环境，冷启动时自动填充演示商品、多级代理拓扑与模拟测试数据（仅在本地 `development` + `SANDBOX_MODE=true` 生效，生产环境零执行）。

### 环境前置要求

- **Node.js**：`24.19.0`（见 `package.json` `engines` 字段）
- **pnpm**：`10.34.9`

### 启动步骤

```bash
# 1. 安装锁定依赖
pnpm install --frozen-lockfile

# 2. 初始化本地 D1 数据库结构
pnpm run db:migrate:local

# 3. 启动本地前后端联合开发服务器（默认 http://localhost:5173）
pnpm run dev
```

本地沙盒演示账户（仅开发环境自动初始化）：

- **主站管理员**：`admin@accthub.dev` / `admin123456`（访问 `/admin`；或使用安装口令 `accthub-admin`）
- **认证代理店主**：`demo@accthub.dev` / `demo123456`（访问 `/agent` 或通过 `studio.localhost:5173` 体验多级分站）

---

## 质量门禁命令

```bash
pnpm run check          # 串联执行 Biome Lint、TypeScript 检查、架构守卫、Vitest 测试与生产构建
pnpm run test:e2e       # 运行 Playwright 全链路端到端测试
pnpm run install:verify # 在独立隔离临时目录验证干净冻结安装与类型检查
```

---

## 开源协议

本项目基于 [Apache License 2.0](./LICENSE) 开源。
