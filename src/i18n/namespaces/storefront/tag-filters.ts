/**
 * 前台目录快捷标签筛选与标签语义色调辅助函数（避免业务组件内硬编码中文字符串）
 */

export const CATALOG_TAG_FILTERS = [
  { value: '', key: 'tagAll' },
  { value: '自动发货', key: 'tagAutoDelivery' },
  { value: '官方充值', key: 'tagOfficialTopup' },
  { value: '成品账号', key: 'tagReadyAccount' },
  { value: '质保全程', key: 'tagFullWarranty' },
  { value: '独立席位', key: 'tagPrivateSeat' },
  { value: 'API中转', key: 'tagApiRelay' },
] as const;

export function classifyProductTagTone(tag: string): 'accent' | 'success' | 'neutral' {
  if (tag.includes('自动') || tag.includes('API') || tag.includes('4K')) {
    return 'success';
  }
  if (tag.includes('推荐') || tag.includes('低风控') || tag.includes('热')) {
    return 'accent';
  }
  return 'neutral';
}
