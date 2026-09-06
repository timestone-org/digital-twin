/** @fileoverview 编辑器 JSON 收敛、草稿与保存版本契约。 */
import { describe, expect, it } from 'vitest'
import {
  blankReport,
  documentFrom,
  reportDraft,
  reportUpdate,
} from '@/pages/Reports/scripts/reportDocument'
import type { ReportTemplate } from '@dt/contracts'

describe('报告文档边界', () => {
  it('保留文本标记与业务节点属性', () => {
    const doc = documentFrom({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '正文', marks: [{ type: 'bold' }] },
            { type: 'metricRef', attrs: { expr: '{本期}', precision: 2 } },
          ],
        },
      ],
    })
    expect(doc.content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }])
    expect(doc.content?.[0]?.content?.[1]?.attrs?.['expr']).toBe('{本期}')
  })
  it.each([null, 1, {}, { type: 4 }])('拒绝非法根节点 %s', (value) => {
    expect(() => documentFrom(value)).toThrow('文档结构无效')
  })
  it('空模板可立即保存，更新携带版本', () => {
    const draft = blankReport('月报')
    expect(draft.doc_json?.type).toBe('doc')
    expect(reportUpdate(draft, 3).expected_version).toBe(3)
  })
  it('编辑草稿不混入资源身份与时刻', () => {
    const template: ReportTemplate = {
      id: 'r1',
      code: 'month',
      name: '月报',
      description: null,
      granularity: 'month',
      is_enabled: true,
      row_version: 1,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-01T00:00:00Z',
      doc_json: { type: 'doc' },
      metrics: [],
      page_json: {},
    }
    expect(reportDraft(template)).toEqual({
      name: '月报',
      description: null,
      granularity: 'month',
      is_enabled: true,
      doc_json: { type: 'doc' },
      metrics: [],
      page_json: {},
    })
  })
})
