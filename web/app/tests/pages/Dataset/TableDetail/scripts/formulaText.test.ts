/**
 * @fileoverview 公式编辑器纯规则层的契约：插入落点与光标、片段写法取自目录而
 * 不是写死、以及分段「拆开再拼回」必须逐字还原一条没动过的公式。
 *
 * ⚠ 最后那一条是本文件的重点：拼回的写法与档数规则错一点，用户只是切了一下
 * 编辑面，落库的公式就被悄悄改写了，而界面上什么都不会说。
 */
import { describe, expect, it } from 'vitest'

import {
  columnRef,
  composeBranches,
  externalRef,
  functionSnippet,
  librarySnippet,
  operatorSnippet,
  operatorTokens,
  referencedKeys,
  spliceText,
  splitBranches,
  windowHint,
  windowSnippet,
} from '@/pages/Dataset/TableDetail/scripts/formulaText'

describe('插入落点', () => {
  it('把选区那一段换掉，光标落在片段内的指定偏移', () => {
    const result = spliceText('abcdef', 2, 4, 'XY', 1)
    expect(result.text).toBe('abXYef')
    expect(result).toMatchObject({ start: 3, end: 3 })
  })

  it('起止相同即纯插入', () => {
    expect(spliceText('ab', 1, 1, 'Z').text).toBe('aZb')
  })

  it('缺省光标落在片段末尾', () => {
    const result = spliceText('', 0, 0, '{进水量}')
    expect(result.start).toBe('{进水量}'.length)
  })
})

describe('引用写法', () => {
  it('本表列写 {列key}', () => {
    expect(columnRef('进水量')).toBe('{进水量}')
  })

  it('跨表列写 {表code.列key}', () => {
    expect(externalRef('water', 'inflow')).toBe('{water.inflow}')
  })
})

describe('函数片段', () => {
  it('零参函数必须带括号，光标停在整段之后', () => {
    // ⚠ 裸 `PI` 会被解析器当成未知标识符
    const payload = functionSnippet({
      name: 'PI',
      min_args: 0,
      signature: 'PI()',
    })
    expect(payload).toEqual({ snippet: 'PI()', caret: 4 })
  })

  it('没选中内容时光标送进括号', () => {
    const payload = functionSnippet({
      name: 'ABS',
      min_args: 1,
      signature: 'ABS(x)',
    })
    expect(payload).toEqual({ snippet: 'ABS()', caret: 4 })
  })

  it('有选中内容就套住它', () => {
    const payload = functionSnippet(
      { name: 'ABS', min_args: 1, signature: 'ABS(x)' },
      '{a} - {b}',
    )
    expect(payload.snippet).toBe('ABS({a} - {b})')
  })

  it('⚠ 时间窗那一档的窗口取自目录签名，不是前端写死的默认值', () => {
    const payload = functionSnippet({
      name: 'ALL_ZERO_OVER',
      min_args: 2,
      signature: "ALL_ZERO_OVER({列}, '12mo')",
    })
    expect(payload.snippet).toBe("ALL_ZERO_OVER(, '12mo')")
  })

  it('签名里没有窗口就不补第二个参数', () => {
    expect(windowHint('ABS(x)')).toBeNull()
    expect(windowHint("SUM_OVER({列}, '1h')")).toBe('1h')
  })
})

describe('库公式与运算符片段', () => {
  it('库公式零参也带括号，光标进括号', () => {
    expect(librarySnippet('tce')).toEqual({ snippet: '@tce()', caret: 5 })
  })

  it('⚠ 目录把同一类的几个运算符写在一格里，要拆开才能逐个插', () => {
    expect(operatorTokens('>  >=  <  <=')).toEqual(['>', '>=', '<', '<='])
    expect(operatorTokens('( )')).toEqual(['(', ')'])
    expect(operatorTokens('and  or')).toEqual(['and', 'or'])
    expect(operatorTokens('   ')).toEqual([])
  })

  it('括号贴着写，其余两侧补空格', () => {
    expect(operatorSnippet('(').snippet).toBe('(')
    expect(operatorSnippet('+').snippet).toBe(' + ')
  })

  it('时间窗字面量带引号：不带引号解析不过', () => {
    expect(windowSnippet('3mo').snippet).toBe("'3mo'")
  })
})

describe('分段拆开与拼回', () => {
  it('IF 拆成一档加兜底', () => {
    const draft = splitBranches('IF({a} > 0, 1, 0)')
    expect(draft).toEqual({
      arms: [{ cond: '{a} > 0', value: '1' }],
      otherwise: '0',
      form: 'IF',
    })
  })

  it('IFS 拆成多档', () => {
    const draft = splitBranches('IFS({a} > 8, 2, {a} > 6, 1, 0)')
    expect(draft?.arms).toHaveLength(2)
    expect(draft?.otherwise).toBe('0')
  })

  it('括号与引号里的逗号不是分隔符', () => {
    const draft = splitBranches("IF(ALL_ZERO_OVER({产量}, '12mo'), 0, 1)")
    expect(draft?.arms[0]?.cond).toBe("ALL_ZERO_OVER({产量}, '12mo')")
    expect(draft?.otherwise).toBe('1')
  })

  it.each([
    ['{a} + {b}', '不是分支公式'],
    ['IF({a}, 1)', '参数个数不对'],
    ['IFS({a}, 1, {b}, 2)', 'IFS 的参数个数必须是奇数'],
    ['IF({a} > 0, 1, 0) + 3', '整条不是一个 IF 调用'],
    ['IF({a} > 0, 1, 0', '括号没配对'],
    ["IF({a} == 'x, 1, 0)", '引号没闭合'],
  ])('拆不开就退回 null：%s（%s）', (formula) => {
    expect(splitBranches(formula)).toBeNull()
  })

  it('多档一律拼成 IFS', () => {
    const text = composeBranches({
      arms: [
        { cond: '{a} > 8', value: '2' },
        { cond: '{a} > 6', value: '1' },
      ],
      otherwise: '0',
      form: 'IF',
    })
    expect(text).toBe('IFS({a} > 8, 2, {a} > 6, 1, 0)')
  })

  it.each([
    'IF({a} > 0, 1, 0)',
    'IFS({a} > 8, 2, {a} > 6, 1, 0)',
    "IF(ALL_ZERO_OVER({产量}, '12mo'), 0, {能耗} / {产量})",
  ])('⚠ 拆开再拼回逐字还原：%s', (formula) => {
    const draft = splitBranches(formula)
    expect(draft).not.toBeNull()
    expect(draft === null ? '' : composeBranches(draft)).toBe(formula)
  })

  it('⚠ 只有一档的 IFS 拼回时仍写 IFS，不许换成 IF', () => {
    const formula = 'IFS({a} > 0, 1, 0)'
    const draft = splitBranches(formula)
    expect(draft?.form).toBe('IFS')
    expect(draft === null ? '' : composeBranches(draft)).toBe(formula)
  })
})

describe('已引用的 key', () => {
  it('抓 {...}，跨表引用取整段', () => {
    expect([...referencedKeys('{a} + {water.b} * 2')]).toEqual(['a', 'water.b'])
  })

  it('空引用不算', () => {
    expect(referencedKeys('{  } + 1').size).toBe(0)
  })
})
