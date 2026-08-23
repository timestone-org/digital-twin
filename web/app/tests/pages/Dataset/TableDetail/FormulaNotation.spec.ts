/**
 * @fileoverview 记号树渲染器的契约：后端产得出的每一种节点都画得出来，且
 * **认不出的节点一律降级成 `?`，绝不抛错**。
 *
 * ⚠ 白屏是这一条守的东西：一个不认识的 `t`、或者一个少了子字段的节点，
 * 递归下去撞上 `undefined.t` 就会把整个列表单弹窗一起打黑，而那正是占位分支
 * 要避免的症状（docs/DATASET_DESIGN.md §5.9、§7.13）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'

import FormulaNotation from '@/pages/Dataset/TableDetail/components/FormulaNotation.vue'

enableAutoUnmount(afterEach)

function render(node: unknown): string {
  return mount(FormulaNotation, { props: { node } }).text()
}

const COL = { t: 'col', name: '进水量', unit: 'm³', key: 'inflow' }

describe('后端产得出的每一种节点', () => {
  it('列引用显示列名，写法与单位收进悬停', () => {
    const wrapper = mount(FormulaNotation, { props: { node: COL } })
    expect(wrapper.text()).toBe('进水量')
    expect(wrapper.get('.nt-col').attributes('title')).toBe('{inflow}（m³）')
  })

  it('跨表引用画成「表名·列名」，让人一眼看出不是本表的数', () => {
    const wrapper = mount(FormulaNotation, {
      props: {
        node: {
          t: 'ext',
          table: '产量台账',
          table_code: 'output',
          name: '产量',
          unit: null,
          key: 'qty',
        },
      },
    })
    expect(wrapper.text()).toBe('产量台账·产量')
    expect(wrapper.get('.nt-ext').attributes('title')).toBe('{output.qty}')
  })

  it.each([
    [{ t: 'num', v: '3600' }, '3600'],
    [{ t: 'text', v: '空', raw: null }, '「空」'],
    [{ t: 'paren', x: { t: 'num', v: '1' } }, '(1)'],
    [{ t: 'frac', num: { t: 'num', v: '1' }, den: { t: 'num', v: '2' } }, '12'],
    [
      { t: 'bin', op: '×', l: { t: 'num', v: '2' }, r: { t: 'num', v: '3' } },
      '2×3',
    ],
    [{ t: 'cmp', op: '≥', l: COL, r: { t: 'num', v: '0' } }, '进水量≥0'],
    [{ t: 'neg', x: { t: 'num', v: '1' } }, '−1'],
    [{ t: 'not', x: { t: 'num', v: '1' } }, '非1'],
    [{ t: 'pow', base: { t: 'num', v: '2' }, exp: { t: 'num', v: '3' } }, '23'],
    [{ t: 'sqrt', x: { t: 'num', v: '9' } }, '√9'],
    [{ t: 'prev', x: COL, n: 1 }, '上一条的进水量'],
    [{ t: 'prev', x: COL, n: 3 }, '上第 3 条的进水量'],
    [
      { t: 'agg', sym: 'Σ', label: '近 3 个月', func: 'SUM_OVER', x: COL },
      'Σ近 3 个月(进水量)',
    ],
  ])('画得出 %o', (node, text) => {
    expect(render(node).replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
  })

  it('逻辑节点在每一项之间插一个「且 / 或」', () => {
    const text = render({
      t: 'logic',
      op: '且',
      args: [
        { t: 'num', v: '1' },
        { t: 'num', v: '2' },
        { t: 'num', v: '3' },
      ],
    })
    expect(text.replace(/\s+/g, '')).toBe('1且2且3')
  })

  it('函数画成 名字(参数, 参数)', () => {
    const text = render({
      t: 'fn',
      name: 'ROUND',
      label: '四舍五入',
      args: [COL, { t: 'num', v: '2' }],
    })
    expect(text.replace(/\s+/g, '')).toBe('ROUND(进水量,2)')
  })

  it('分段摊成大括号，每一档一行，末行是「否则」', () => {
    const text = render({
      t: 'cases',
      arms: [
        {
          t: 'arm',
          cond: { t: 'cmp', op: '>', l: COL, r: { t: 'num', v: '0' } },
          then: { t: 'num', v: '1' },
        },
      ],
      else: { t: 'num', v: '0' },
    }).replace(/\s+/g, '')
    expect(text).toContain('1若进水量>0')
    expect(text).toContain('0否则')
  })
})

describe('降级', () => {
  it.each([
    ['未来才有的新记号', { t: 'matrix', rows: [] }],
    ['少了子字段的分式', { t: 'frac', num: { t: 'num', v: '1' } }],
    ['子节点是个裸数字', { t: 'paren', x: 7 }],
    ['args 不是数组', { t: 'fn', name: 'ABS', args: 'oops' }],
    ['整棵树是 null', null],
    ['整棵树是字符串', '看不懂'],
    ['没有 t', { name: 'ABS' }],
  ])('%s 画成占位而不是抛错', (_name, node) => {
    expect(() => render(node)).not.toThrow()
    expect(render(node)).toContain('?')
  })

  it('⚠ 深到 200 层也只是画出来，不许把栈打穿', () => {
    let node: unknown = { t: 'num', v: '1' }
    for (let at = 0; at < 200; at += 1) node = { t: 'paren', x: node }
    expect(() => render(node)).not.toThrow()
  })
})
