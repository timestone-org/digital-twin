/**
 * @fileoverview 把后端回的 `pending_fields` 翻成人话。
 *
 * ⚠ 认不出的字段名**原样显示，不许丢**：吞掉一个就等于告诉用户「全都生效了」，
 * 而实际上位机读到的还是旧值——这正是「改动看起来成功了却没生效」那类
 * 最难排查的故障。后端加字段时这里没跟上，最坏也只是显示得不好看。
 */

const LABELS: Record<string, string> = {
  endpoint_path: '端点路径',
  namespace_uri: '命名空间 URI',
  security_policies: '安全策略',
  is_anonymous_allowed: '匿名访问',
  port: '端口',
  browse_name: 'BrowseName',
  data_type: '数据类型',
  access_level: '访问级别',
  initial_value: '初值',
  description: '描述',
}

/** 单个字段名的展示文案；认不出就原样给回去。 */
export function pendingFieldLabel(field: string): string {
  return LABELS[field] ?? field
}

/** 一串字段名的展示文案。 */
export function pendingFieldLabels(fields: readonly string[]): string[] {
  return fields.map(pendingFieldLabel)
}

/**
 * 「待重启才生效」的整句话。
 * @param fields 后端回的字段名数组
 */
export function pendingSummary(fields: readonly string[]): string {
  if (fields.length === 0) return ''
  return `${pendingFieldLabels(fields).join('、')} 已保存，重启实例后生效`
}
