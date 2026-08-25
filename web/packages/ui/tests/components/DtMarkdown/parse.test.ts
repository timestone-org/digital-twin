/**
 * @fileoverview markdown 解析。
 *
 * **守的是「界面上看着像随手写的」这一类**：正文里天天有列表、表格、代码块，
 * 解不出来就整段以纯文本铺出来。另守一条安全线——产出是结构不是 HTML 字符串，
 * 且链接的协议白名单放行。
 */
import { describe, expect, it } from 'vitest'

import {
  parseMarkdown,
  type MdBlock,
} from '../../../src/components/DtMarkdown/blocks'
import {
  parseInline,
  type MdSpan,
} from '../../../src/components/DtMarkdown/inline'

function kinds(blocks: readonly MdBlock[]): string[] {
  return blocks.map((one) => one.kind)
}

/** 把片段摊平成纯文字，用来断言「解错了没丢字」。 */
function flatten(spans: readonly MdSpan[]): string {
  return spans
    .map((span) =>
      span.kind === 'text' || span.kind === 'code'
        ? span.text
        : flatten(span.spans),
    )
    .join('')
}

describe('块', () => {
  it('标题、段落、列表、代码块各归各', () => {
    const blocks = parseMarkdown(
      [
        '## 做法',
        '先查点位。',
        '',
        '- 第一步',
        '- 第二步',
        '',
        '```json',
        '{}',
        '```',
      ].join('\n'),
    )

    expect(kinds(blocks)).toEqual(['heading', 'paragraph', 'list', 'code'])
  })

  it('段落里的换行留着', () => {
    const [block] = parseMarkdown('第一行\n第二行')

    // 吃掉的话，模型分行写的「第一步…第二步…」会挤成一整坨
    expect(block?.kind).toBe('paragraph')
    expect(block?.kind === 'paragraph' && flatten(block.spans)).toBe(
      '第一行\n第二行',
    )
  })

  it('没闭合的代码围栏照样成块', () => {
    const blocks = parseMarkdown('```json\n{"a":')

    // 流式逐字出字时它一直是没闭合的——按纯文本处理会让整段 JSON 先刷出来、
    // 收尾时再整体跳成代码块
    expect(kinds(blocks)).toEqual(['code'])
  })

  it('有序列表记住起始序号', () => {
    const [block] = parseMarkdown('3. 丙\n4. 丁')

    expect(block?.kind === 'list' && block.ordered).toBe(true)
    expect(block?.kind === 'list' && block.start).toBe(3)
  })

  it('列表项里还能有块', () => {
    const [block] = parseMarkdown('- 第一步\n  - 更细的一步')
    const first = block?.kind === 'list' ? block.items[0] : []

    expect(kinds(first ?? [])).toEqual(['paragraph', 'list'])
  })

  it('项之间隔一个空行仍是同一个列表', () => {
    const blocks = parseMarkdown('- 甲\n\n- 乙')

    // 分成两个列表的话，中间会多出一截外边距，看着像断了
    expect(kinds(blocks)).toEqual(['list'])
    expect(blocks[0]?.kind === 'list' && blocks[0].items).toHaveLength(2)
  })

  it('表格解出表头与数据行', () => {
    const [block] = parseMarkdown(
      '| 槽位 | 点位 |\n| --- | --- |\n| 温度 | K1_TT |',
    )

    expect(block?.kind).toBe('table')
    expect(block?.kind === 'table' && block.head).toHaveLength(2)
    expect(block?.kind === 'table' && block.rows).toHaveLength(1)
  })

  it('分隔线不会被当成没有序号的列表', () => {
    expect(kinds(parseMarkdown('---'))).toEqual(['rule'])
  })
})

describe('行内', () => {
  it('粗体、行内代码、链接各归各', () => {
    const spans = parseInline('**要紧**：写 `items` 见 [文档](https://a.b)')

    expect(spans.map((one) => one.kind)).toEqual([
      'strong',
      'text',
      'code',
      'text',
      'link',
    ])
  })

  it('反引号里的星号是字面量', () => {
    const spans = parseInline('`**不是粗体**`')

    // 代码排在匹配器第一位就是为了这条
    expect(spans).toEqual([{ kind: 'code', text: '**不是粗体**' }])
  })

  it('两个星号赢过一个', () => {
    const [span] = parseInline('**粗**')

    expect(span?.kind).toBe('strong')
  })

  it('协议不在白名单里的链接降级成纯文字', () => {
    const spans = parseInline('[点我](javascript:alert(1))')

    // 它看起来与普通链接一模一样，而点下去会执行
    expect(spans.every((one) => one.kind === 'text')).toBe(true)
  })

  it('尖括号原样留在文字里，不当标记', () => {
    const spans = parseInline('<script>alert(1)</script>')

    // 产出是结构、由模板渲染成文本节点，所以这里不需要转义，只需要别丢字
    expect(flatten(spans)).toBe('<script>alert(1)</script>')
  })
})
