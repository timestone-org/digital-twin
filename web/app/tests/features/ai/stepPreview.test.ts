/**
 * @fileoverview 一步的入参与产出摊平。
 *
 * 守的是「看得见而且看得完」：截图不能混进文本产出（那是几十万字符的 base64），
 * 落库时包的那层壳要剥掉，超长的值要截断且说出来。
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_KEYS,
  inputPreview,
  isImageOutput,
  outputPreview,
  outputDisplay,
  toolOutputPreview,
  toolOutputSummary,
} from '@/features/ai/stepPreview'

describe('入参摊平', () => {
  it('没有入参给 null，不是一张空表', () => {
    expect(inputPreview(undefined)).toBeNull()
    expect(inputPreview({})).toBeNull()
    expect(inputPreview([1, 2])).toBeNull()
  })

  it('裸串不套引号', () => {
    expect(inputPreview({ node_id: 'n-1' })).toEqual({ node_id: 'n-1' })
  })

  it('嵌套的值摊成一行 JSON', () => {
    expect(inputPreview({ geometry: { x: 1 } })).toEqual({
      geometry: '{"x":1}',
    })
  })

  it('超长的值截断并说出来', () => {
    const flat = inputPreview({ text: '点'.repeat(900) })
    const value = flat?.text ?? ''
    expect(value.length).toBeLessThan(900)
    expect(value).toContain('已截断')
  })

  it('展不开的值说一句话，不让整张卡片空着', () => {
    // 客户端工具的产出是页面自己造的对象，循环引用不是不可能
    const looped: Record<string, unknown> = {}
    looped.self = looped
    const flat = inputPreview({ node: looped })
    expect(flat?.node).toContain('展不开')
  })

  it('键太多时多出来的被数出来，不是悄悄没了', () => {
    const given: Record<string, number> = {}
    for (let at = 0; at < MAX_KEYS + 3; at += 1) given[`k${at}`] = at
    const flat = inputPreview(given)
    expect(Object.keys(flat ?? {})).toHaveLength(MAX_KEYS + 1)
    expect(Object.values(flat ?? {}).join()).toContain('另有 3 项未摊开')
  })
})

describe('产出摊平', () => {
  it('落库时包的那层 body 壳被剥掉', () => {
    expect(outputPreview({ body: '命中 3 条' })).toBe('命中 3 条')
  })

  it('没包壳的产出照样画得出来', () => {
    expect(outputPreview({ count: 3 })).toBe('{"count":3}')
  })

  it('截图不当成文本产出', () => {
    // 混进去的话，展开看到的是一坨 base64 而不是一张图
    expect(outputPreview('data:image/png;base64,AAAA')).toBeNull()
  })

  it('空的产出给 null', () => {
    expect(outputPreview(undefined)).toBeNull()
    expect(outputPreview(null)).toBeNull()
    expect(outputPreview('')).toBeNull()
  })

  it('超长产出截断并说出来', () => {
    const text = outputPreview({ body: '位'.repeat(5000) }) ?? ''
    expect(text.length).toBeLessThan(5000)
    expect(text).toContain('已截断')
  })
})

describe('认图', () => {
  it('只认 data:image/ 开头的', () => {
    expect(isImageOutput('data:image/png;base64,AA')).toBe(true)
    expect(isImageOutput('data:text/plain;base64,AA')).toBe(false)
    expect(isImageOutput({ url: 'data:image/png' })).toBe(false)
  })
})

describe('工具产出展示', () => {
  it('展示载体读取完整回执，截图与空内容不生成载体', () => {
    const raw = {
      items: Array.from({ length: 20 }, (_, at) => ({
        id: `p${at}`,
        name: '温度',
      })),
      metadata: { next_page: 2 },
    }
    expect(outputDisplay(raw).displaySummary).toBe('返回 20 条结果')
    expect(outputDisplay(raw).displayOutput).toContain(
      '`metadata.next_page`: 2',
    )
    expect(outputDisplay({ body: '完成' })).toEqual({
      displayOutput: '完成',
      displaySummary: '完成',
    })
    expect(outputDisplay(undefined)).toEqual({})
    expect(outputDisplay('')).toEqual({})
    expect(outputDisplay('  \n')).toEqual({})
    expect(outputDisplay('data:image/png;base64,AA')).toEqual({})
  })

  it('正文旁的陈旧状态与分页信息保留且先于长正文，原预览仍沿用剥壳契约', () => {
    const raw = {
      body: '长正文'.repeat(1_000),
      warnings: ['陈旧'],
      is_stale: true,
      has_more: true,
      next_page: 2,
    }
    const shown = outputDisplay(raw).displayOutput ?? ''
    expect(shown).toContain('陈旧')
    expect(shown).toContain('`is_stale`: true')
    expect(shown).toContain('`has_more`: true')
    expect(shown).toContain('`next_page`: 2')
    expect(shown.indexOf('next_page')).toBeLessThan(shown.indexOf('长正文'))
    expect(shown).toContain('未展示')
    expect(outputPreview(raw)).toBe(outputPreview({ body: raw.body }))
  })
  it('旧 JSON 对象展开为键值，同时保留零值与空值', () => {
    expect(toolOutputPreview('{"count":0,"ok":false,"next_page":null}')).toBe(
      '- `next_page`: null\n- `count`: 0\n- `ok`: false',
    )
  })

  it('同形列表只展示一次字段表头', () => {
    const text = toolOutputPreview(
      '{"items":[{"id":"p1","name":"温度"},{"id":"p2","name":"压力"}]}',
    )
    expect(text).toContain('| id | name |')
    expect(text).toContain('| p1 | 温度 |')
    expect(text).toContain('| p2 | 压力 |')
    expect(text?.match(/\| id \| name \|/g)).toHaveLength(1)
    expect(text).not.toContain('"id"')
  })

  it('字段与字面值中的 Markdown 标记保留原文', () => {
    expect(
      toolOutputPreview('[{"node_key":"src:KY_DC_5","name":"**泵**"}]'),
    ).toContain('| `src:KY_DC_5` | `**泵**` |')
    expect(toolOutputPreview('{"name":"[泵](https://example.com)"}')).toBe(
      '- `name`: `[泵](https://example.com)`',
    )
  })

  it('分页与警告先于长列表展示且超长结果明确标注', () => {
    const raw = JSON.stringify({
      items: Array.from({ length: 20 }, (_, at) => ({
        id: `p${at}`,
        description: '测量值'.repeat(60),
      })),
      metadata: { page: 1, total: 100, has_more: true, next_page: 2 },
      warnings: ['只查询了第一页'],
    })
    const text = toolOutputPreview(raw) ?? ''
    expect(text).toContain('`metadata.page`: 1')
    expect(text).toContain('`metadata.next_page`: 2')
    expect(text.indexOf('metadata.next_page')).toBeLessThan(
      text.indexOf('items'),
    )
    expect(text.indexOf('只查询了第一页')).toBeLessThan(text.indexOf('items'))
    expect(text).toContain('未展示')
    expect(text.length).toBeLessThan(1_650)
  })

  it('新文本与无法解析的旧截断结果保持原样', () => {
    const text = 'has_more: true\n\n| id | name |\n| --- | --- |\n| 1 | 泵 |'
    expect(toolOutputPreview(text)).toBe(text)
    expect(toolOutputPreview('{"items":[已截断')).toBe('{"items":[已截断')
  })

  it('新紧凑 Markdown 长表按完整行截断并保留前置分页状态', () => {
    const text = [
      'has_more: true',
      'next_page: 2',
      '',
      '| id | name | description |',
      '| --- | --- | --- |',
      ...Array.from(
        { length: 20 },
        (_, at) => `| point-${at + 1} | 温度 | ${'测量值'.repeat(25)} |`,
      ),
    ].join('\n')
    expect(text.length).toBeGreaterThan(1_500)
    const shown = toolOutputPreview(text) ?? ''
    const rows = shown.split('\n').filter((line) => line.startsWith('| '))
    expect(shown).toContain('has_more: true\nnext_page: 2')
    expect(rows.length).toBeGreaterThan(2)
    expect(
      rows.every((line) => line.endsWith(' |') && line.split('|').length === 5),
    ).toBe(true)
    expect(shown).toContain('已截断')
    expect(shown.length).toBeLessThan(1_650)
  })

  it('空内容不生成产出，空容器有明确提示', () => {
    expect(toolOutputPreview(undefined)).toBeNull()
    expect(toolOutputPreview('')).toBeNull()
    expect(toolOutputPreview('{}')).toBe('返回空对象')
    expect(toolOutputPreview('[]')).toBe('返回 0 条结果')
    expect(toolOutputPreview('   \n')).toBeNull()
    expect(toolOutputPreview('data:image/png;base64,AA')).toBeNull()
  })

  it('折叠概要为列表条数，正文概要只取有界首行', () => {
    expect(toolOutputSummary('{"items":[{"id":"1"},{"id":"2"}]}')).toBe(
      '返回 2 条结果',
    )
    expect(toolOutputSummary('查询成功\n这是详情')).toBe('查询成功')
    expect(toolOutputSummary('点'.repeat(200))?.length).toBeLessThan(100)
    expect(toolOutputSummary(undefined)).toBeNull()
    expect(toolOutputSummary('')).toBeNull()
    expect(toolOutputSummary('  \n')).toBeNull()
    expect(toolOutputSummary('[]')).toBe('返回 0 条结果')
    expect(toolOutputSummary('{"count":3}')).toBe('count: 3')
  })

  it.each(['0', 'false', 'null', '"设备"'])(
    '标量 %s 不丢失、不套 JSON 外壳',
    (text) => {
      expect(toolOutputPreview(text)).toBe(text === '"设备"' ? '设备' : text)
    },
  )

  it('嵌套对象展开字段路径，混合列表按项保留完整内容', () => {
    const text =
      toolOutputPreview(
        '{"config":{"empty":{},"source":{"address":{"host":"127.0.0.1"}}},"items":[0,false,null,{"name":"中文🌡️","tags":["热水"]}]}',
      ) ?? ''
    expect(text).toContain('`config.empty`: {}')
    expect(text).toContain('`config.source.address`: {"host":"127.0.0.1"}')
    expect(text).toContain('`items[1]`: 0')
    expect(text).toContain('`items[2]`: false')
    expect(text).toContain('`items[3]`: null')
    expect(text).toContain('中文🌡️')
    expect(text).toContain('热水')
  })

  it.each([
    '[]',
    '[{}]',
    '[{"id":"1"},{"name":"泵"}]',
    '[{"name":"A|B"}]',
    '[{"name":"上行\\n下行"}]',
    '[{"config":{"enabled":true}}]',
  ])('不能安全共用表头的列表 %s 退回键值正文', (text) => {
    expect(toolOutputPreview(text)).not.toContain('| --- |')
  })

  it('列表与字段上限明确计数，纯文本仍有展示上限', () => {
    const items = Array.from({ length: MAX_KEYS + 2 }, (_, at) => at)
    expect(toolOutputPreview(JSON.stringify(items))).toContain(
      '另有 2 条未展示',
    )
    const fields = Object.fromEntries(items.map((at) => [`k${at}`, at]))
    expect(toolOutputPreview(JSON.stringify(fields))).toContain(
      '另有 2 个字段未展示',
    )
    expect(toolOutputPreview(JSON.stringify([fields]))).not.toContain('| --- |')
    const text = toolOutputPreview('点'.repeat(5_000)) ?? ''
    expect(text.length).toBeLessThan(1_650)
    expect(text).toContain('已截断')
    expect(toolOutputPreview(JSON.stringify('点'.repeat(5_000)))).toContain(
      '未展示',
    )
  })
})
