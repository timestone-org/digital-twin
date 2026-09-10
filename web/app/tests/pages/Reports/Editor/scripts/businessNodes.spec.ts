/** @fileoverview 业务节点独立配置、键盘入口和序列化保留。 */
import { Editor, Node } from '@tiptap/core'
import { expect, it } from 'vitest'
import { documentFrom } from '@/pages/Reports/scripts/reportDocument'
import { businessExtensions } from '@/pages/Reports/Editor/scripts/businessNodes'

it('同名数值只修改点击的实例，只读时不能编辑', () => {
  const host = document.createElement('div')
  const editor = new Editor({
    element: host,
    extensions: [
      Node.create({ name: 'doc', topNode: true, content: 'paragraph+' }),
      Node.create({
        name: 'paragraph',
        content: 'inline*',
        group: 'block',
        renderHTML: () => ['p', 0],
      }),
      Node.create({ name: 'text', group: 'inline' }),
      ...businessExtensions,
    ],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'metricRef', attrs: { expr: '{温度}', unit: '℃' } },
            { type: 'metricRef', attrs: { expr: '{温度}', unit: '℃' } },
          ],
        },
      ],
    },
  })
  try {
    let received: unknown
    host.addEventListener('report-node-edit', (event) => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as {
        node: { attrs: Record<string, unknown> }
        apply: (attrs: Record<string, unknown>) => boolean
      }
      received = detail.node
      expect(detail.apply({ ...detail.node.attrs, precision: 4 })).toBe(true)
    })
    host
      .querySelectorAll('.report-data-node')[1]
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    expect(received).toMatchObject({
      type: 'metricRef',
      attrs: { expr: '{温度}' },
    })
    const paragraph = documentFrom(editor.getJSON()).content?.[0]
    expect(
      paragraph?.content?.map((node) => node.attrs?.['precision']),
    ).toEqual([2, 4])
    expect(editor.getHTML()).toContain('data-report-unit')
    editor.setEditable(false)
    received = undefined
    host
      .querySelector('.report-data-node')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(received).toBeUndefined()
  } finally {
    editor.destroy()
  }
})
