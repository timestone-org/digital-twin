/** @fileoverview 报告模板助手只改草稿，并复用真实校验、试算入口。 */
import { describe, expect, it, vi } from 'vitest'
import type {
  AssistantToolCall,
  ReportBody,
  ReportDocument,
  ReportPreview,
  ReportSchemas,
} from '@dt/contracts'

import {
  createReportSurface,
  REPORT_TOOLS,
} from '@/pages/Reports/Editor/scripts/aiSurface'

interface Harness {
  surface: ReturnType<typeof createReportSurface>
  draft: () => ReportBody
  inserted: ReportDocument[]
  validate: ReturnType<typeof vi.fn>
  preview: ReturnType<typeof vi.fn>
  shown: ReportPreview[]
}

const previewResult: ReportPreview = {
  is_valid: true,
  metrics: [],
  nodes: {},
  period: '2026-08',
  timezone: 'Asia/Shanghai',
  warnings: [],
}

function tool(
  name: string,
  arguments_: Record<string, unknown> = {},
): AssistantToolCall {
  return { call_id: `call-${name}`, name, arguments: arguments_ }
}

function harness(canEdit = true): Harness {
  let draft: ReportBody = {
    name: '能源月报',
    granularity: 'month',
    metrics: [],
    page_json: { orientation: 'portrait' },
    doc_json: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          content: [{ type: 'text', text: '运行摘要' }],
        },
      ],
    },
  }
  const inserted: ReportDocument[] = []
  const validation: ReportSchemas['ValidationOut'] = {
    is_valid: true,
    issues: [],
  }
  const validate = vi.fn().mockResolvedValue(validation)
  const preview = vi.fn().mockResolvedValue(previewResult)
  const shown: ReportPreview[] = []
  const surface = createReportSurface({
    templateId: () => 'report-1',
    draft: () => draft,
    setDraft: (value) => {
      draft = value
    },
    canEdit: () => canEdit,
    insert: (node) => inserted.push(node),
    validate,
    preview,
    showPreview: (value) => shown.push(value),
  })
  return { surface, draft: () => draft, inserted, validate, preview, shown }
}

describe('报告模板 AI 工作面', () => {
  it('快照提供指标、页面设置和有界正文提纲', () => {
    const got = harness().surface.snapshot()
    expect(got['template_id']).toBe('report-1')
    expect(got['document']).toEqual({
      items: [
        { path: '', type: 'doc', text: '运行摘要' },
        { path: '0', type: 'heading', text: '运行摘要' },
      ],
      is_truncated: false,
    })
    expect(REPORT_TOOLS).toContain('report.preview_draft')
  })

  it('正文提纲限制条数并只保留报告节点的紧凑属性', () => {
    const got = harness()
    const children: ReportDocument[] = Array.from(
      { length: 121 },
      (_, index) => ({
        type: 'dsChart',
        attrs: {
          title: `图表${index}`,
          limit: 100,
          keys: Array.from({ length: 12 }, (__, keyIndex) => `k${keyIndex}`),
          ignored: '不应进入提示词',
        },
      }),
    )
    got.draft().doc_json = { type: 'doc', content: children }
    const document = got.surface.snapshot()['document']
    expect(document).toEqual(expect.objectContaining({ is_truncated: true }))
    expect(JSON.stringify(document)).not.toContain('不应进入提示词')
    expect(JSON.stringify(document)).not.toContain('k11')
  })

  it('局部修改模板信息并按名称增改指标', async () => {
    const got = harness()
    await got.surface.run(
      tool('report.set_template', {
        name: '综合能源月报',
        description: '管理层摘要',
        granularity: 'month',
      }),
    )
    await got.surface.run(
      tool('report.upsert_metric', {
        name: '本期用电',
        mode: 'window_agg',
        table: 'energy_monthly',
        key: 'electricity',
        agg: 'sum',
        unit: 'kWh',
      }),
    )
    await got.surface.run(
      tool('report.upsert_metric', {
        name: '本期用电',
        mode: 'latest',
        table: 'energy_monthly',
        key: 'electricity',
      }),
    )
    expect(got.draft().name).toBe('综合能源月报')
    expect(got.draft().metrics).toEqual([
      {
        name: '本期用电',
        mode: 'latest',
        offset: 0,
        anchor: 'period',
        table: 'energy_monthly',
        key: 'electricity',
      },
    ])
  })

  it('拒绝缺少真实来源或表达式的指标', async () => {
    const got = harness()
    await expect(
      got.surface.run(
        tool('report.upsert_metric', { name: '增长率', mode: 'expr' }),
      ),
    ).rejects.toThrow('expr')
    await expect(
      got.surface.run(
        tool('report.upsert_metric', {
          name: '本期用电',
          mode: 'window_agg',
          table: 'energy_monthly',
          key: 'electricity',
        }),
      ),
    ).rejects.toThrow('agg')
  })

  it('支持全部指标枚举，并拒绝无效档位与窗口', async () => {
    const got = harness()
    for (const agg of [
      'avg',
      'min',
      'max',
      'last',
      'first',
      'sum',
      'count',
      'delta',
    ]) {
      await got.surface.run(
        tool('report.upsert_metric', {
          name: `指标-${agg}`,
          mode: 'window_agg',
          table: 'energy',
          key: 'value',
          agg,
          anchor: 'latest',
        }),
      )
    }
    await got.surface.run(
      tool('report.upsert_metric', {
        name: '桶值',
        mode: 'at_bucket',
        table: 'energy',
        key: 'value',
        window: '1d',
      }),
    )
    await got.surface.run(
      tool('report.upsert_metric', {
        name: '表达式',
        mode: 'expr',
        expr: '{指标-sum} / 2',
      }),
    )
    await expect(
      got.surface.run(
        tool('report.upsert_metric', {
          name: '坏模式',
          mode: 'unknown',
        }),
      ),
    ).rejects.toThrow('mode')
    await expect(
      got.surface.run(
        tool('report.upsert_metric', {
          name: '坏聚合',
          mode: 'latest',
          table: 'energy',
          key: 'value',
          agg: 'median',
        }),
      ),
    ).rejects.toThrow('agg')
    await expect(
      got.surface.run(
        tool('report.upsert_metric', {
          name: '缺窗口',
          mode: 'at_bucket',
          table: 'energy',
          key: 'value',
        }),
      ),
    ).rejects.toThrow('window')
  })

  it('在当前光标插入普通正文和结构化数据节点', async () => {
    const got = harness()
    await got.surface.run(
      tool('report.insert_content', {
        kind: 'heading',
        text: '能耗分析',
        level: 2,
      }),
    )
    await got.surface.run(
      tool('report.insert_content', {
        kind: 'metric_ref',
        expression: '{本期用电}',
        precision: 1,
      }),
    )
    await got.surface.run(
      tool('report.insert_content', {
        kind: 'bar_chart',
        title: '逐月用电',
        table: 'energy_monthly',
        key: 'electricity',
        series_name: '用电量',
      }),
    )
    await got.surface.run(
      tool('report.insert_content', {
        kind: 'data_table',
        title: '明细',
        table: 'energy_monthly',
        key: 'electricity',
        limit: 50,
      }),
    )
    expect(got.inserted.map((node) => node.type)).toEqual([
      'heading',
      'metricRef',
      'dsChart',
      'dsTable',
    ])
    expect(got.inserted[2]?.attrs).toEqual(
      expect.objectContaining({ kind: 'bar', keys: ['electricity'] }),
    )
  })

  it('插入段落、条件文本与折线图，并拒绝未知内容类型', async () => {
    const got = harness()
    await got.surface.run(
      tool('report.insert_content', { kind: 'paragraph', text: '结论' }),
    )
    await got.surface.run(
      tool('report.insert_content', {
        kind: 'conditional_text',
        expression: "IF({达标}, '正常', '异常')",
      }),
    )
    await got.surface.run(
      tool('report.insert_content', {
        kind: 'line_chart',
        table: 'energy',
        key: 'value',
      }),
    )
    expect(got.inserted.map((node) => node.type)).toEqual([
      'paragraph',
      'condText',
      'dsChart',
    ])
    await expect(
      got.surface.run(tool('report.insert_content', { kind: 'video' })),
    ).rejects.toThrow('不认识')
  })

  it('页面设置只覆盖给出的字段', async () => {
    const got = harness()
    await got.surface.run(
      tool('report.set_page', {
        orientation: 'landscape',
        font_size_pt: 12,
        is_toc_enabled: true,
        watermark_text: '内部',
        margin_left_cm: 2.5,
      }),
    )
    expect(got.draft().page_json).toEqual({
      orientation: 'landscape',
      font_size_pt: 12,
      is_toc_enabled: true,
      watermark: { text: '内部' },
      margins_cm: { left: 2.5 },
    })
  })

  it('页面工具覆盖全部设置并能清除水印', async () => {
    const got = harness()
    for (const size of ['A4', 'A3', 'Letter', 'Legal']) {
      await got.surface.run(tool('report.set_page', { size }))
    }
    await got.surface.run(
      tool('report.set_page', {
        orientation: 'portrait',
        font_family: 'SimSun',
        header: '月度运行报告',
        footer: '第 {PAGE} 页',
        margin_top_cm: 2,
        margin_bottom_cm: 2,
        margin_right_cm: 2.5,
        watermark_text: '',
      }),
    )
    expect(got.draft().page_json).toEqual(
      expect.objectContaining({
        size: 'Legal',
        orientation: 'portrait',
        font_family: 'SimSun',
        watermark: null,
        margins_cm: { top: 2, bottom: 2, right: 2.5 },
      }),
    )
  })

  it('拒绝空模板名、错误类型、越界数字和未知工具', async () => {
    const got = harness()
    for (const call of [
      tool('report.set_template', { name: ' ' }),
      tool('report.set_template', { granularity: 'week' }),
      tool('report.set_template', { is_enabled: 'yes' }),
      tool('report.set_page', { size: 'B5' }),
      tool('report.set_page', { orientation: 'diagonal' }),
      tool('report.set_page', { font_size_pt: '12' }),
      tool('report.set_page', { font_size_pt: Number.POSITIVE_INFINITY }),
      tool('report.set_page', { font_size_pt: 0 }),
      tool('report.insert_content', {
        kind: 'heading',
        text: '标题',
        level: 2.5,
      }),
      tool('report.unknown'),
    ]) {
      await expect(got.surface.run(call)).rejects.toThrow()
    }
  })

  it('校验和试算读取当前草稿并把试算结果显示在页面', async () => {
    const got = harness()
    await got.surface.run(tool('report.validate_draft'))
    await got.surface.run(tool('report.preview_draft', { period: '2026-08' }))
    expect(got.validate).toHaveBeenCalledWith(got.draft())
    expect(got.preview).toHaveBeenCalledWith('2026-08', got.draft())
    expect(got.shown).toEqual([previewResult])
  })

  it('只读账号能读取草稿但不能修改', async () => {
    const got = harness(false)
    await expect(got.surface.run(tool('report.read_draft'))).resolves.toEqual(
      expect.objectContaining({ template_id: 'report-1' }),
    )
    await expect(
      got.surface.run(tool('report.set_template', { name: '不该改' })),
    ).rejects.toThrow('不能修改')
  })
})
