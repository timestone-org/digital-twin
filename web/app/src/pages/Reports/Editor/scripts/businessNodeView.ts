/** @fileoverview 业务节点的可访问编辑入口，回写时核对当前实例。 */
import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core'
import { documentFrom } from '../../scripts/reportDocument'

const LABELS: Record<string, string> = {
  metricRef: '数值',
  condText: '公式',
  dsChart: '图表',
  dsTable: '表格',
}

function openNode(props: NodeViewRendererProps, dom: HTMLElement): void {
  const { editor, getPos, node } = props
  const pos = getPos()
  if (!editor.isEditable || pos === undefined) return
  editor.commands.setNodeSelection(pos)
  dom.dispatchEvent(
    new CustomEvent('report-node-edit', {
      bubbles: true,
      detail: {
        node: documentFrom(node.toJSON()),
        apply: (attrs: Record<string, unknown>) => {
          const currentPos = getPos()
          if (!editor.isEditable || currentPos === undefined) return false
          if (editor.state.doc.nodeAt(currentPos) !== node) return false
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(currentPos, undefined, attrs),
          )
          return true
        },
      },
    }),
  )
}

export const businessNodeView: NodeViewRenderer = (props) => {
  const { node } = props
  const dom = document.createElement('span')
  dom.className = 'report-data-node'
  dom.dataset['reportNode'] = node.type.name
  dom.contentEditable = 'false'
  dom.tabIndex = 0
  dom.setAttribute('role', 'button')
  const label = LABELS[node.type.name] ?? node.type.name
  const value: unknown = node.attrs['expr'] || node.attrs['title']
  dom.textContent = `${label} · ${typeof value === 'string' && value ? value : '点击配置'}`
  dom.title = `配置${label}`
  dom.setAttribute('aria-label', `配置${dom.textContent}`)
  dom.addEventListener('click', () => openNode(props, dom))
  dom.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openNode(props, dom)
  })
  return {
    dom,
    stopEvent: (event) =>
      event.type === 'click' ||
      (event instanceof KeyboardEvent &&
        (event.key === 'Enter' || event.key === ' ')),
  }
}
