# 接口参考手册

AcctHub 提供面向**代理 B2B 批采开放接口**、**商城前台**、**零售订单与收银台**、**会员/代理中心**以及**运营总控后台**的标准化 REST API。所有入参均经过 Zod 严格校验，响应头与多语种错误信息遵循请求头 `X-Lang`（`zh-CN` / `zh-TW` / `en` / `ja` / `ko`）。

---

## 1. 通用约定

- **基础前缀**：`/api/*`
- **认证方式**：
  - 会员与代理控制台会话：`Authorization: Bearer <jwt_token>`
  - 代理 B2B 开放接口：`Authorization: Bearer <ah_agent_key>`
  - 游客收银台凭据：`X-Intent-Token: <view_token>`
- **幂等键**：支持在请求体传递 `idempotency_key` 或通过 `Idempotency-Key` 请求头传递（建议不超过 64 字符）。

---

## 2. 代理 B2B 开放接口（`/api/v1/reseller/*`）

适用于分销合作伙伴或下游自动发卡系统接入主站库存与货源。兼容主流第三方发卡接口路径位于 `/api/v1/reseller/compat/*`。

### 2.1 查询代理档案与账户余额

- **端点**：`GET /api/v1/reseller/me`
- **鉴权**：`Authorization: Bearer <ah_agent_key>`

```json
{
  "agent_slug": "studio",
  "brand_name": "星尘数字优选",
  "balance": 358.8,
  "commission_rate": 15,
  "total_commission": 642.08
}
```

### 2.2 拉取实时价目表与可用库存

- **端点**：`GET /api/v1/reseller/products`
- **鉴权**：`Authorization: Bearer <ah_agent_key>`
- **说明**：实时汇总本地卡密余量、合租席位及已启用真实上游货源（受代理结算价与上游余额约束），返回代理折后拿货价 `wholesale_price` 与零售指导价 `retail_price`。

### 2.3 B2B 批采下单与异步追踪

- **端点**：`POST /api/v1/reseller/order`
- **鉴权**：`Authorization: Bearer <ah_agent_key>`

| 字段              | 类型     | 必填 | 说明                                     |
| :---------------- | :------- | :--- | :--------------------------------------- |
| `product_id`      | `number` | 是   | 商品 ID                                  |
| `spec_id`         | `string` | 否   | 规格 ID，缺省取首规格                    |
| `quantity`        | `number` | 否   | 采购数量（`1–20`，默认 `1`）             |
| `customer_ref`    | `string` | 否   | 下游关联订单号或邮箱，写入对账流水       |
| `idempotency_key` | `string` | 建议 | 同一笔采购重放时保持同一键值，防重复扣款 |

**响应状态说明**：

- `status: "delivered"`：已实时完成履约，`cards` 数组返回明文凭证；
- `status: "upstream_pending"`：已向真实上游提交采购并扣款成功，待上游异步回调或轮询发货（此时 `cards` 为 `[]`）；
- `status: "processing"`：并发防重抢占中，`total_deducted` 为 `null`，使用原单号或 `idempotency_key` 调用 `GET /api/v1/reseller/order?order_no=...` 或 `?idempotency_key=...` 轮询结果即可。

---

## 3. 前台目录、多租户与智能选品（`/api/storefront/*`）

### 3.1 站点启动配置与分类树

- **端点**：`GET /api/storefront/bootstrap`
- **可选参数**：`tenant`（代理 Slug，亦可直接通过分站独立域名 `Host` 自动识别）
- **返回核心字段**：
  - `tenant`：当前站点租户上下文（是否分站、品牌名称、主题设置、加价策略）；
  - `settings`：站点运营配置及参考币种汇率（`fx_rates`）；
  - `groups`：侧边栏分组与二级分类（含实时在售商品数）；
  - `announcements`：有效公告（置顶优先）；
  - `payment_methods`：当前站点可用支付通道（分站私有商品仅下发该分站已启用的自有收款通道）。

### 3.2 商品列表与检索

- **端点**：`GET /api/storefront/products`
- **查询参数**：
  - `category`：`featured`（默认）| `all` | 指定分类 `slug`
  - `q`：多语种标题、副标题、标签或 Slug 检索
  - `tag`：精确标签筛选

### 3.3 商品详情与可选卡密标签

- **详情端点**：`GET /api/storefront/products/:idOrSlug`（支持传入隐藏口令 `password` 参数解锁口令商品；返回按规格拆分的 `spec_stock`）
- **选号列表**：`GET /api/storefront/products/:idOrSlug/selectable-cards?spec_id=...`（开启前台自选时返回待售卡密公开标签与选号加价，绝不包含卡密内容）

### 3.4 自然语言智能选品

- **端点**：`POST /api/storefront/concierge/match`
- **请求体**：`{ "prompt": "需要写代码用编程会员，顺便看 4K 流媒体" }`
- **返回**：`{ "prompt", "reasoning", "items": Product[] }`

### 3.5 帮助中心

- **端点**：`GET /api/storefront/help`
- **返回**：`{ "articles": HelpArticle[] }`

---

## 4. 零售订单、收银台与查单（`/api/orders/*` & `/api/payments/*`）

### 4.1 创建订单与断网恢复

- **创建订单**：`POST /api/orders`

| 字段                        | 类型                     | 必填           | 说明                                                           |
| :-------------------------- | :----------------------- | :------------- | :------------------------------------------------------------- |
| `product_id`                | `number`                 | 是             | 商品 ID                                                        |
| `spec_id`                   | `string`                 | 否             | 规格 ID                                                        |
| `quantity`                  | `number`                 | 否             | 购买数量（`1–20`，默认 `1`）                                   |
| `contact_email`             | `string`                 | 是             | 接收订单号、交付结果与完整卡密凭证的邮箱                       |
| `payment_method`            | `string`                 | 否             | `balance`（需登录）或当前站点已启用的第三方收单通道            |
| `query_password`            | `string`                 | 否             | 网页查单访问密码（不影响原始邮箱发信）                         |
| `selected_card_ids`         | `number[]`               | 否             | 开启自选选号时指定的卡密 ID 集合                               |
| `group_buy_id`              | `number` / `action`      | 否             | 拼团开团或参团参数                                             |
| `coupon_code` / `use_promo` | `string` / `boolean`     | 否             | 优惠券码或推广消费金抵扣选项                                   |
| `custom_inputs`             | `Record<string, string>` | 否             | 买家提交的自定义交付表单字段                                   |
| `idempotency_key`           | `string`                 | 建议           | 客户端生成并持久化用于断网重传恢复                             |
| `checkout_secret`           | `string`                 | 游客恢复时必填 | 64 位十六进制随机串，仅当前收银台会话内保存用于 `recover` 恢复 |

- **恢复丢失的收银台会话**：`POST /api/orders/recover`（提交同一 `idempotency_key` 与 `checkout_secret` 重新找回对应订单及支付链接；相同幂等键若与原购买意图不一致返回 `409`）。

### 4.2 订单查询与收银台状态轮询

- **订单查询**：`POST /api/orders/lookup`
  - 游客传入邮件里的 `AHQ-` 编号（`q`）、可选 `password` 与 `turnstile_token`；密码试错超限返回锁定摘要；
  - 会员携 JWT 提交 `{}`（支持 `cursor` 游标分页，每次最多 50 笔）。
- **收银台轮询与即刻核单**：
  - `GET /api/payments/intents/:intentNo`（游客需在 Header 附带 `X-Intent-Token`，交付后可读取完整发卡凭证）
  - `POST /api/payments/intents/:intentNo/check`（主动查单，受独立路由限流与 USDT 链上 15 秒防抖控制）
- **支付回调**：`POST / GET /api/payments/webhook/:provider`（由易支付 / 支付宝 / Stripe 等官方回调触发严格验签与幂等履约）。

---

## 5. 会员中心与分站工作台（`/api/auth/*`, `/api/account/*`, `/api/agent/*`）

| 方法                        | 路径                                                          | 鉴权        | 说明                                                              |
| :-------------------------- | :------------------------------------------------------------ | :---------- | :---------------------------------------------------------------- |
| `POST`                      | `/api/auth/register` / `/api/auth/login` / `/api/auth/logout` | 公开 / 会话 | 邮箱注册登录与会话撤销                                            |
| `GET`                       | `/api/auth/me`                                                | JWT         | 当前用户、钱包现金余额、推广消费金余额与代理身份                  |
| `GET / POST`                | `/api/oauth/:provider/...`                                    | 公开 / JWT  | QQ / 微信 / Google / GitHub 社交登录接入                          |
| `POST`                      | `/api/account/recharge/intent`                                | JWT         | 发起在线充值支付意图；另有 CDK 兑换接口 `/api/account/cdk/redeem` |
| `GET`                       | `/api/agent/tiers`                                            | 公开        | 代理等级体系与折扣/返佣阶梯                                       |
| `POST`                      | `/api/agent/recharge`                                         | JWT         | 支付代理开通或升级补差费                                          |
| `GET`                       | `/api/agent/me`                                               | JWT         | 获取代理等级、下级团队、分佣流水、域名绑定与自营商品概览          |
| `PUT`                       | `/api/agent/brand`                                            | 有效代理    | 更新分站 Slug、品牌名称、主题色、加价率与自定义域名               |
| `POST`                      | `/api/agent/rotate-key`                                       | 有效代理    | 重置 B2B 批采密钥（立即失效旧密钥）                               |
| `GET / POST / PUT / DELETE` | `/api/agent/private-products*`                                | 有效代理    | 管理分站自营私有商品、规格与私有卡密库                            |
| `GET / PUT`                 | `/api/agent/payments*`                                        | 有效代理    | 管理已授权代理的自有直收支付网关                                  |

---

## 6. 运营总控后台接口（`/api/admin/*`）

所有 `/api/admin/*` 接口均强制校验主站管理员 JWT，并且高危写入动作均自动记录审计日志（`/api/admin/audit-logs`）。主要涵盖：

- **概览与站点配置**：`/api/admin/overview`、`/api/admin/settings`
- **目录与库存**：`/api/admin/groups`、`/api/admin/categories`、`/api/admin/products`、`/api/admin/products/:id/cards`
- **订单、退款与工单**：`/api/admin/orders*`、`/api/admin/refunds*`、`/api/admin/tickets*`
- **支付插件**：`/api/admin/payment-plugins/:id`（配置密钥后即时保存脱敏回显，不回吐明文私钥）
- **上游货源与履约**：`/api/admin/upstreams*`（配置协议模板、商品绑定、手工补发与故障切换；POST 下单模板支持 `{{custom_inputs.字段名}}` 与 `not_accepted_path`/`not_accepted_values` 显式未受理判定）
- **风控、2FA 与出站 Webhook**：`/api/admin/risk/*`、`/api/admin/2fa/*`、`/api/admin/webhooks*`
- **财务对账巡检**：`/api/admin/finance/reconciliation`（包含 7 项账本一致性核对指标及明细 CSV 导出）
