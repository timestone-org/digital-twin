/** @fileoverview 正文内的试算结果：路径与后端同口径、改过的节点不显示旧值、按 Word 版式渲染。 */
import { Editor, Node } from '@tiptap/core'
import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReportDocument } from '@dt/contracts'
import { createBusinessExtensions } from '@/pages/Reports/Editor/scripts/businessNodes'
import {
  createPreviewStore,
  nodeSignature,
  previewSignatures,
  previewValue,
} from '@/pages/Reports/Editor/scripts/documentPreview'
import { documentFrom } from '@/pages/Reports/scripts/reportDocument'

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock('echarts', () => ({ init: vi.fn(() => chart) }))

const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  vi.clearAllMocks()
})

const DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '本期能耗：' },
        { type: 'metricRef', attrs: { expr: '{能耗}', unit: 'kWh' } },
      ],
    },
    { type: 'dsTable', attrs: { title: '明细', table: 'energy', keys: ['e'] } },
    { type: 'dsChart', attrs: { title: '趋势', series: [] } },
  ],
}

function mountEditor(store = createPreviewStore()) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const editor = new Editor({
    element: host,
    extensions: [
      Node.create({ name: 'doc', topNode: true, content: 'block+' }),
      Node.create({
        name: 'paragraph',
        content: 'inline*',
        group: 'block',
        renderHTML: () => ['p', 0],
      }),
      Node.create({ name: 'text', group: 'inline' }),
      ...createBusinessExtensions(store),
    ],
    content: DOC,
  })
  editors.push(editor)
  return { host, editor, store }
}

function current(editor: Editor): ReportDocument {
  return documentFrom(editor.getJSON())
}

it('路径与后端 walk_nodes 同口径，只收业务节点', () => {
  const { editor } = mountEditor()
  expect(Object.keys(previewSignatures(current(editor)))).toEqual([
    'content.0.content.1',
    'content.1',
    'content.2',
  ])
})

it('指纹不受属性书写顺序影响，属性一改就取不到旧值', () => {
  const preview = {
    period: '2026-09',
    nodes: { 'content.1': { kind: 'dsTable' } },
    signatures: { 'content.1': nodeSignature('dsTable', { a: 1, b: 2 }) },
  }
  expect(
    previewValue(
      preview,
      'content.1',
      nodeSignature('dsTable', { b: 2, a: 1 }),
    ),
  ).toEqual({ kind: 'dsTable' })
  expect(
    previewValue(preview, 'content.1', nodeSignature('dsTable', { a: 9 })),
  ).toBeNull()
  expect(previewValue(null, 'content.1', '')).toBeNull()
})

function expectWordLayout(host: HTMLElement): void {
  const value = host.querySelector('[data-report-node="metricRef"]')
  expect(value?.textContent).toBe('123.45 kWh')
  expect(value?.classList.contains('report-data-node--value')).toBe(true)
  const table = host.querySelector('[data-report-node="dsTable"]')
  expect(table?.querySelector('.report-node-caption')?.textContent).toBe('明细')
  expect(
    [...(table?.querySelectorAll('th') ?? [])].map((th) => th.textContent),
  ).toEqual(['时间', '电量'])
  expect(table?.querySelector('td.is-number')?.textContent).toBe('12.5')
  expect(chart.setOption).toHaveBeenCalledWith(
    expect.objectContaining({ color: expect.arrayContaining(['#35618D']) }),
  )
}

it('试算后正文按 Word 版式显示数值、表格和图表，改配置后回到占位', async () => {
  const { host, editor, store } = mountEditor()
  expect(host.textContent).toContain('数值 · {能耗}')
  expect(host.textContent).toContain('试算后在此显示')
  store.set({
    period: '2026-09',
    signatures: previewSignatures(current(editor)),
    nodes: {
      'content.0.content.1': { kind: 'metricRef', text: '123.45 kWh' },
      'content.1': {
        kind: 'dsTable',
        title: '明细',
        columns: ['时间', '电量'],
        rows: [
          ['09-01', '12.5'],
          ['09-02', '13.0'],
        ],
      },
      'content.2': {
        kind: 'line',
        title: '趋势',
        categories: ['09-01'],
        series: [{ name: '电量', points: [], values: ['1'] }],
      },
    },
  })
  await flushPromises()
  expectWordLayout(host)
  const position = editor.state.doc.child(0).nodeSize
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(position, undefined, {
      ...editor.state.doc.child(1).attrs,
      keys: ['e', 'w'],
    }),
  )
  const table = host.querySelector('[data-report-node="dsTable"]')
  expect(table?.querySelector('table')).toBeNull()
  expect(table?.textContent).toContain('试算后在此显示')
})

it('前面插入段落后路径变化，节点不会错拿别处的值', async () => {
  const { host, editor, store } = mountEditor()
  store.set({
    period: '2026-09',
    signatures: previewSignatures(current(editor)),
    nodes: {
      'content.0.content.1': { kind: 'metricRef', text: '123.45 kWh' },
    },
  })
  await flushPromises()
  editor.commands.insertContentAt(0, {
    type: 'paragraph',
    content: [{ type: 'metricRef', attrs: { expr: '{能耗}', unit: 'kWh' } }],
  })
  store.refresh()
  const values = [...host.querySelectorAll('[data-report-node="metricRef"]')]
  expect(values.map((item) => item.textContent)).toEqual([
    '数值 · {能耗}',
    '数值 · {能耗}',
  ])
})
