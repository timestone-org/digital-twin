/** @fileoverview 真实 Umo 的 Word 排版字段、HTML 往返与用户缩进命令。 */
import { Editor } from '@tiptap/core'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import type { ReportDocument } from '@dt/contracts'
import { documentFrom } from '@/pages/Reports/scripts/reportDocument'

const styled: ReportDocument = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: {
        textAlign: 'right',
        lineHeight: '20pt',
        margin: { top: 8, bottom: 4 },
        leftIndentPt: 12,
        rightIndentPt: 6,
        firstLineIndentPt: 21,
      },
      content: [
        {
          type: 'text',
          text: '排版段落',
          marks: [
            {
              type: 'textStyle',
              attrs: { fontFamily: '宋体', fontSize: '14pt', color: '#123456' },
            },
          ],
        },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: {
                colspan: 2,
                rowspan: 1,
                colwidth: [120, 180],
                align: 'cm',
                background: '#ddeeff',
              },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '合并单元格' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
beforeEach(() => {
  if (!document.doctype)
    document.insertBefore(
      document.implementation.createDocumentType('html', '', ''),
      document.documentElement,
    )
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const append = document.head.appendChild.bind(document.head)
  vi.spyOn(document.head, 'appendChild').mockImplementation(
    <TNode extends Node>(node: TNode): TNode => {
      if (
        node instanceof HTMLScriptElement ||
        node instanceof HTMLLinkElement
      ) {
        queueMicrotask(() => node.dispatchEvent(new Event('load')))
        return node
      }
      return append(node)
    },
  )
})
afterEach(async () => {
  document.body.replaceChildren()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  vi.restoreAllMocks()
})
function editorOf(wrapper: VueWrapper, component: Component): Editor {
  const payload: unknown = wrapper
    .findComponent(component)
    .emitted('created')?.[0]?.[0]
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('editor' in payload) ||
    !(payload.editor instanceof Editor)
  )
    throw new Error('真实 Umo 编辑器未就绪')
  return payload.editor
}
async function mountEditor() {
  const ReportEditor = (
    await import('@/pages/Reports/Editor/components/ReportEditor.vue')
  ).default
  const { UmoEditor } = await import('@umoteam/editor')
  const wrapper = mount(ReportEditor, {
    attachTo: document.body,
    props: { modelValue: styled },
  })
  await vi.waitFor(() =>
    expect(wrapper.findComponent(UmoEditor).emitted('created')).toBeTruthy(),
  )
  return { wrapper, editor: editorOf(wrapper, UmoEditor) }
}
function paragraphOf(editor: Editor): ReportDocument | undefined {
  return documentFrom(editor.getJSON()).content?.find(
    (node) => node.type === 'paragraph',
  )
}
it('字体段落和合并表格在真实 Umo JSON与HTML往返后保留', async () => {
  const { wrapper, editor } = await mountEditor()
  try {
    expect(paragraphOf(editor)?.attrs).toMatchObject({
      leftIndentPt: 12,
      rightIndentPt: 6,
      firstLineIndentPt: 21,
    })
    const html = editor.getHTML()
    expect(html).toContain('data-report-left-indent-pt="12"')
    editor.commands.setContent(html)
    await flushPromises()
    const paragraph = paragraphOf(editor)
    expect(paragraph?.attrs).toMatchObject({
      textAlign: 'right',
      lineHeight: '20pt',
      margin: { top: '8', bottom: '4' },
      leftIndentPt: 12,
      rightIndentPt: 6,
      firstLineIndentPt: 21,
    })
    expect(paragraph?.content?.[0]?.marks).toContainEqual(
      expect.objectContaining({
        type: 'textStyle',
        attrs: expect.objectContaining({
          fontFamily: '宋体',
          fontSize: '14pt',
          color: '#123456',
        }),
      }),
    )
    expectMergedTable(editor)
    expect(JSON.stringify(wrapper.emitted('update:modelValue'))).toContain(
      'firstLineIndentPt',
    )
  } finally {
    wrapper.unmount()
    await flushPromises()
  }
})
function expectMergedTable(editor: Editor): void {
  const table = documentFrom(editor.getJSON()).content?.find(
    (node) => node.type === 'table',
  )
  expect(table?.content?.[0]?.content?.[0]?.attrs).toMatchObject({
    colspan: 2,
    rowspan: 1,
    colwidth: [120, 180],
    align: 'cm',
    background: '#ddeeff',
  })
}
it('用户用原生缩进命令时清理导入的精确首行值', async () => {
  const { wrapper, editor } = await mountEditor()
  try {
    editor.commands.setTextSelection(2)
    const command: unknown = Reflect.get(editor.commands, 'setIndent')
    if (!isCommand(command)) throw new Error('原生缩进命令不可用')
    command()
    expect(paragraphOf(editor)?.attrs?.['firstLineIndentPt']).toBeNull()
    expect(paragraphOf(editor)?.attrs?.['indent']).toBe(11.5)
  } finally {
    wrapper.unmount()
    await flushPromises()
  }
})
function isCommand(value: unknown): value is () => boolean {
  return typeof value === 'function'
}

it('精确首行经HTML回填后减少缩进不会发生取整漂移', async () => {
  const { wrapper, editor } = await mountEditor()
  try {
    editor.commands.setContent(editor.getHTML())
    editor.commands.setTextSelection(2)
    const command: unknown = Reflect.get(editor.commands, 'setOutdent')
    if (!isCommand(command)) throw new Error('原生减少缩进命令不可用')
    command()
    expect(paragraphOf(editor)?.attrs).toMatchObject({
      firstLineIndentPt: null,
      indent: 9.5,
      indentUnit: 'pt',
    })
  } finally {
    wrapper.unmount()
    await flushPromises()
  }
})

it('CSS单位和负悬挂值经回填保留，普通编辑不会清掉精确缩进', async () => {
  const { wrapper, editor } = await mountEditor()
  try {
    editor.commands.setContent(
      '<p style="margin-left:24px;margin-right:1cm;text-indent:-12pt">悬挂段落</p>',
    )
    const first = paragraphOf(editor)
    expect(first?.attrs).toMatchObject({
      leftIndentPt: 18,
      firstLineIndentPt: -12,
    })
    expect(first?.attrs?.['rightIndentPt']).toBeCloseTo(28.3464567)
    editor.commands.setContent(editor.getHTML())
    editor.commands.setTextSelection(2)
    editor.commands.insertContent('新增')
    expect(paragraphOf(editor)?.attrs).toMatchObject({
      leftIndentPt: 18,
      firstLineIndentPt: -12,
    })
  } finally {
    wrapper.unmount()
    await flushPromises()
  }
})
