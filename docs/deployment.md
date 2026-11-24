# 部署与配置指南

AcctHub 原生构建于 Cloudflare Workers（计算与静态资源托管）与 Cloudflare D1（分布式 SQLite 数据库），无需独立服务器、Redis 或外部对象存储即可完成生产部署。

---

## 1. 环境规划与配置模型

`wrangler.toml` 预先划分了三套标准环境配置：

| 环境               | `APP_ENV`     | `SANDBOX_MODE`           | 用途说明                                             |
| :----------------- | :------------ | :----------------------- | :--------------------------------------------------- |
| 默认本地开发       | `development` | 由 `vite` / 本地命令控制 | 本地开发与联调，自动初始化沙盒演示数据               |
| `[env.staging]`    | `staging`     | `false`（强制）          | 上线前预发验证，完全隔离测试，禁用沙盒路径与演示登录 |
| `[env.production]` | `production`  | `false`（默认禁用）      | 正式线上生产环境，强密钥校验、高并发边缘节点运行     |

> [!IMPORTANT]
> 非 `development` / `test` 环境下（包括 `staging` 与 `production`），所有沙盒充值、模拟支付页与测试体验金路由均不会注册（返回 `404`），并且服务端会拒绝使用默认开发弱口令。

---

## 2. 创建 Cloudflare D1 数据库

以生产环境为例（预发环境将命令中的 `production` / `accthub-db-prod` 替换为 `staging` / `accthub-db-staging`）：

```bash
# 1. 登录 Cloudflare CLI
pnpm exec wrangler login

# 2. 创建生产 D1 数据库
pnpm exec wrangler d1 create accthub-db-prod
```

将终端输出的 `database_id`（UUID）回填到 `wrangler.toml` 对应的 `[[env.production.d1_databases]]` 配置段中。

---

## 3. 绑定生产加密密钥（Wrangler Secrets）

生产与预发环境**严禁在 `wrangler.toml` 中明文写入任何密钥**。以下 4 项为核心必填密钥：

| Secret 名称            | 生成建议                                                 | 用途                                         |
| :--------------------- | :------------------------------------------------------- | :------------------------------------------- |
| `JWT_SECRET`           | `openssl rand -base64 32`（≥ 24 位随机字符串）           | 用户与代理登录会话 JWT 签名                  |
| `ADMIN_SECRET`         | 高强度随机口令（禁止使用 `accthub-admin`）               | 冷启动初始化向导与紧急初始化校验             |
| `DATA_ENCRYPTION_KEYS` | 见下方 JSON 格式（包含 32 字节 Base64 AES-256-GCM 密钥） | 卡密、支付配置、上游凭证与邮箱密钥静态加密   |
| `DATA_FINGERPRINT_KEY` | `openssl rand -base64 32`                                | 代理 API Key、凭证指纹等单向盲索引 HMAC 密钥 |

一键生成 `DATA_ENCRYPTION_KEYS` 示例（Node.js）：

```bash
node -e "const c=require('crypto'); console.log(JSON.stringify({active:'k2026', keys:{k2026: c.randomBytes(32).toString('base64')}}))"
```

依次安全上传至 Cloudflare Secrets：

```bash
pnpm exec wrangler secret put JWT_SECRET --env production
pnpm exec wrangler secret put ADMIN_SECRET --env production
pnpm exec wrangler secret put DATA_ENCRYPTION_KEYS --env production
pnpm exec wrangler secret put DATA_FINGERPRINT_KEY --env production
```

### 可选环境变量（`wrangler.toml` 或 Secrets）

| 变量名                                        | 说明                                                                                                            |
| :-------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| `MAIN_HOSTNAMES`                              | 主站绑定域名列表（逗号分隔，例如 `shop.example.com,www.example.com`），用于准确区分主站与独立自定义域名代理分站 |
| `ALLOWED_ORIGINS`                             | 跨域来源白名单（逗号分隔）；未配置时仅允许同源或由路由显式放行                                                  |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile 人机验证密钥，保护下单与公开查单接口                                                       |
| `CF_SAAS_ZONE_ID` / `CF_SAAS_API_TOKEN`       | 若开启“代理绑定独立自定义域名自动触发 Cloudflare for SaaS Custom Hostname”，需绑定具备 SSL for SaaS 权限的令牌  |

---

## 4. 部署前预检、迁移与上线

项目提供标准预检脚本、一致性迁移工具与构建上线流：

```bash
# 1. 运行部署前安全与配置守卫预检（检查迁移清单、wrangler.toml 隔离及远端 Secret 是否齐备）
pnpm run deploy:preflight -- --env production

# 2. 执行远端 D1 建表与迁移（自动核验线上 Schema 漂移）
node scripts/migrate-db.mjs --remote --env production

# 3. 构建前端资产与 Worker 产物
pnpm run build

# 4. 部署到 Cloudflare Workers
pnpm exec wrangler deploy --env production

# 5. 验证上线站点健康与沙盒路由屏蔽状态
node scripts/release-health.mjs --env production --url https://your-domain.example.com
```

---

## 5. 冷启动初始化与后台启用渠道

1. 首次部署上线访问站点时，未存在主站管理员，系统将自动引导至冷启动初始化流程（`/api/setup/status` 返回 `requires_setup: true`）。
2. 提交部署时配置的 `ADMIN_SECRET` 与主站管理员邮箱/密码，完成初始化并自动登录 `/admin` 总控后台。
3. 在后台按需配置并启用支付插件（易支付 / 支付宝当面付 / Stripe / USDT）、邮箱服务（Resend / Mailgun / SendGrid / Custom Webhook）或上游货源，保存密钥后立即对前台与收银台生效。

---

## 6. 在线密钥轮换与定时任务（Cron）

- **静态密钥轮换**：向 `DATA_ENCRYPTION_KEYS` 的 `keys` 映射追加新版 32 字节密钥并把 `active` 指向新版本（保留旧 Key 用于平滑解密历史记录），如需后台定时逐步重加密存量字段，可临时将 `DATA_REKEY_ENABLED` 设为 `"true"`。
- **Worker 定时触发器**：`wrangler.toml` 已配置 `crons = ["*/5 * * * *"]`，每 5 分钟自动执行：
  - `mail_outbox` 邮件重试投递；
  - 未完成支付意图/卡密/拼团超时自动回收与退款；
  - 已配置的上游订单状态轮询与库存同步。
