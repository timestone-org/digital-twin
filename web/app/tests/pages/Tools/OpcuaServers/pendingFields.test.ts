/**
 * @fileoverview 「待重启生效」字段的文案。
 * ⚠ 认不出的字段名必须原样显示——吞掉一个就等于告诉用户改动已经全部生效。
 */
import { describe, expect, it } from 'vitest'

import {
  pendingFieldLabel,
  pendingFieldLabels,
  pendingSummary,
} from '@/pages/Tools/OpcuaServers/pendingFields'

describe('字段文案', () => {
  it('认识的字段翻成中文', () => {
    expect(pendingFieldLabel('security_policies')).toBe('安全策略')
    expect(pendingFieldLabel('namespace_uri')).toBe('命名空间 URI')
  })

  it('⚠ 认不出的字段原样给回去，绝不丢掉', () => {
    expect(pendingFieldLabel('some_new_field')).toBe('some_new_field')
  })

  it('一串字段逐个翻译，个数不变', () => {
    const labels = pendingFieldLabels(['port', 'unknown_one', 'data_type'])
    expect(labels).toHaveLength(3)
    expect(labels).toEqual(['端口', 'unknown_one', '数据类型'])
  })

  it('汇总句把字段连起来并点明要重启', () => {
    const text = pendingSummary(['port', 'security_policies'])
    expect(text).toContain('端口')
    expect(text).toContain('安全策略')
    expect(text).toContain('重启')
  })

  it('没有待生效字段时给空串——调用方据此不显示提示', () => {
    expect(pendingSummary([])).toBe('')
  })
})
