# 运维与财务巡检指南

AcctHub 内置只读 SQL 账本巡检脚本、D1 备份校验脚本与紧急止损开关，帮助维护者在生产环境下零侵入定位对账偏差、滞留履约与投递故障。

---

## 1. 一键账本一致性与状态巡检（`operational-check.mjs`）

`scripts/operational-check.mjs` 通过单条只读 `SELECT` 在同一数据库快照内汇总全库异常（不读取明文卡密、隐私邮箱或内部错误正文，仅统计分类通道与计数）：

| 检查项                 | 含义说明                                                                                         |
| :--------------------- | :----------------------------------------------------------------------------------------------- |
| `wallet_drift`         | `users.balance` / `promo_balance` 与对应流水汇总存在净差额（按分对比，即便正负互抵也会逐户报警） |
| `duplicate_event`      | 同业务引用发生重复记账、重复返佣或同交易号重复付款/重复退款                                      |
| `refund_overdue`       | 处于处理中/待查询状态的退款单超过阈值仍未终态（默认阈值 60 分钟）                                |
| `order_undelivered`    | 已付款或待上游履约订单超过阈值仍未交付（默认阈值 15 分钟）                                       |
| `delivery_mail_failed` | 发卡或补发相关邮件投递处于失败或长期重试异常状态                                                 |

### 执行方式

```bash
# 对本地 D1 持久化目录巡检
node scripts/operational-check.mjs --local

# 对只读导出 SQLite 快照文件巡检（推荐大促后安全离线核对）
node scripts/operational-check.mjs --snapshot ./backups/prod-snapshot.sqlite

# 对远端 staging / production D1 巡检（需提前登录 wrangler）
node scripts/operational-check.mjs --remote --env production

# 自定义超时告警阈值（单位：分钟）
node scripts/operational-check.mjs --remote --env production --refund-minutes 30 --delivery-minutes 10
```

**返回码**：

- `0`：`status: "passed"`，所有指标正常且零漂移；
- `1`：`status: "blocked"`，输出脱敏 `findings` 列表，需介入排查处理；
- `2`：参数错误、D1 查询异常或结构不完整。

---

## 2. D1 数据备份导出与回滚核验

### 定期导出 D1 快照

```bash
pnpm exec wrangler d1 export accthub-db-prod --remote --output ./backups/prod-$(date +%Y%m%d).sql
```

### 回滚一致性校验（`operational-rollback.mjs`）

在执行停机切换或灾难还原后，可使用 `scripts/operational-rollback.mjs` 对切换前与回滚后分别导出的数据库文件做二进制 SHA-256 严格一致比对：

```bash
node scripts/operational-rollback.mjs ./backups/before-change.sqlite ./backups/after-rollback.sqlite
```

输出为 `{ "status": "unchanged" }` 且退出码 `0` 时，表示数据字节级完全一致。

---

## 3. 紧急止损与运维后台处理路径

当遇到上游大面积故障、恶意盗刷攻击或支付渠道异常时，管理员可通过管理后台「安全风控」或对应接口立即止损：

1. **暂停自动发卡（`hold_delivery`）**：用户仍可下单支付，但系统暂停自动出卡与向上游采购，全部进入待审核队列（同时触发 3 封紧急邮件告警至管理员）。
2. **紧急维护闭店（`maintenance`）**：全站停止新建订单，保护库存与资金账本现场。
3. **单渠道/单货源熔断**：在后台「支付设置」或「上游货源」中直接停用故障通道，无需重启或重新部署 Worker。
4. **出站邮件队列积压排查**：如发现 `delivery_mail_failed`，可在后台「邮件通知」检查服务商 API Key 状态，并直接点击单封测试发信验证连通性；待 Cron 周期自动重放投递。

---

## 4. 线上构建健康巡检

每次部署完成后建议例行运行一次轻量线上探测，确保静态页面、接口健康状态及生产沙盒路由屏蔽均正常：

```bash
node scripts/release-health.mjs --env production --url https://your-domain.example.com
```
