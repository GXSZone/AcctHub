/**
 * 演示环境默认代理等级与示例分站下级等级数据
 */

export const DEMO_MAIN_AGENT_TIERS = [
  {
    code: 'bronze',
    name: 'V1 启航代理',
    levelRank: 1,
    minRecharge: 100,
    discountRate: 0.9,
    commissionRate: 0,
    subOverrideRate: 0,
    maxSubAgents: 3,
    badgeColor: '#9A6E4B',
    perks: [
      '全站商品享 9 折拿货价（代理升级费 ¥100 开通，不可消费不可退）',
      '一键开通独立品牌白标分站，对外卖价完全自主定义（差价全额归己）',
      '赠送专属 B2B 批采 API Key，支持无限级发展下级代理',
    ],
  },
  {
    code: 'silver',
    name: 'V2 进阶代理',
    levelRank: 2,
    minRecharge: 500,
    discountRate: 0.84,
    commissionRate: 0,
    subOverrideRate: 0,
    maxSubAgents: 15,
    badgeColor: '#4C6B78',
    perks: [
      '全站商品享 8.4 折拿货价（累计代理升级费 ¥500，支持补差升级）',
      '分站逐品自主定价不受平台干涉，卖价与拿货底价差额 100% 归己',
      '带低等级下级代理自动赚取跨级拿货折扣极差（如带 V1 赚 6% 差价）',
    ],
  },
  {
    code: 'gold',
    name: 'V3 旗舰分销',
    levelRank: 3,
    minRecharge: 2000,
    discountRate: 0.78,
    commissionRate: 0,
    subOverrideRate: 0,
    maxSubAgents: 50,
    badgeColor: '#C5842A',
    perks: [
      '全站商品享 7.8 折深度代理价（累计代理升级费 ¥2000，支持补差升级）',
      '带 V1/V2 下级代理自动结算 6%–12% 跨级折扣极差收益',
      '支持绑定自定义独立域名（Cloudflare for SaaS）与 API 批量拉货',
    ],
  },
  {
    code: 'partner',
    name: 'V4 战略合伙人',
    levelRank: 4,
    minRecharge: 5000,
    discountRate: 0.72,
    commissionRate: 0,
    subOverrideRate: 0,
    maxSubAgents: 999,
    badgeColor: '#D97757',
    perks: [
      '全站底价 7.2 折核心渠道价（累计代理升级费 ¥5000，支持补差升级）',
      '最高跨级折扣极差优势（带下级 V1 最高享 18% 差价空间）',
      '不限下级代理名额 · 专属大额企业代充直通通道',
    ],
  },
] as const;

export const DEMO_STUDIO_SUB_TIERS = [
  {
    code: 'partner_std',
    name: '标准合作分站',
    levelRank: 1,
    minRecharge: 168,
    discountRate: 0.92,
    maxSubAgents: 50,
    badgeColor: '#9A6E4B',
    perks: [
      '享 9.2 折专属供货拿货价，独立白标分站自由定价',
      '支持独立上架选品、改写商品图文与绑定独立域名',
      '赠送 B2B 批采 API Key，可继续招募自己的下级分站',
    ],
  },
  {
    code: 'partner_pro',
    name: '核心旗舰伙伴',
    levelRank: 2,
    minRecharge: 399,
    discountRate: 0.88,
    maxSubAgents: 200,
    badgeColor: '#D97757',
    perks: [
      '享 8.8 折深度核心拿货价，更高毛利空间',
      '独立品牌、专属客服与独立域名完全白标运营',
      '向下发展分站实时分账入钱包，随时申请提现',
    ],
  },
] as const;
