/**
 * @fileoverview 业务节点的正文视图：试算后按 Word 成品的版式显示真实数据，
 * 未试算或配置已改时显示可点击的占位；回写时核对当前实例。
 */
import { h, render } from 'vue'
import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core'
import type { ReportSchemas } from '@dt/contracts'
import { documentFrom } from '../../scripts/reportDocument'
import ReportChart from '../components/ReportChart.vue'
import {
  nodePath,
  nodeSignature,
  previewValue,
  type PreviewStore,
} from './documentPreview'
import { hasChartData } from './reportChartTheme'

type NodeValue = ReportSchemas['NodeValue']

const LABELS: Record<string, string> = {
  metricRef: '数值',
  condText: '公式',
  dsChart: '图表',
  dsTable: '表格',
}
const INLINE = new Set(['metricRef', 'condText'])
/** 与 table_layout.py 同一条右对齐判定。 */
const NUMBER = /^[+-]?\d+(?:\.\d+)?$/

function openNode(props: NodeViewRendererProps, dom: HTMLElement): void {
  const { editor, getPos } = props
  const pos = getPos()
  if (!editor.isEditable || pos === undefined) return
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
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

function summary(attrs: Record<string, unknown>): string {
  const value: unknown = attrs['expr'] || attrs['title']
  return typeof value === 'string' && value ? value : '点击配置'
}

function element(tag: string, className: string, text = ''): HTMLElement {
  const created = document.createElement(tag)
  created.className = className
  if (text) created.textContent = text
  return created
}

/** 纸面上的 Word 表格复刻，不是界面列表，故不走 DtTable。 */
function paperTable(value: NodeValue): HTMLElement {
  const table = document.createElement('table')
  table.className = 'report-paper-table'
  const head = table.createTHead().insertRow()
  for (const label of value.columns ?? [])
    head.appendChild(element('th', '', label))
  const body = table.createTBody()
  for (const row of value.rows ?? []) {
    const line = body.insertRow()
    for (const text of row) {
      const cell = line.insertCell()
      cell.textContent = text
      if (NUMBER.test(text.trim())) cell.classList.add('is-number')
    }
  }
  return table
}

function placeholder(type: string, attrs: Record<string, unknown>): string {
  const label = LABELS[type] ?? type
  return INLINE.has(type)
    ? `${label} · ${summary(attrs)}`
    : `${label} · ${summary(attrs)} — 试算后在此显示与 Word 一致的数据`
}

interface ViewState {
  props: NodeViewRendererProps
  type: string
  attrs: Record<string, unknown>
  dom: HTMLElement
  body: HTMLElement
  rendered: string
}

function renderInline(state: ViewState, value: NodeValue | null): void {
  const { dom, type, attrs } = state
  const hasValue = value !== null && Boolean(value.text)
  dom.classList.toggle('report-data-node--value', hasValue)
  dom.textContent = hasValue ? (value?.text ?? '') : placeholder(type, attrs)
}

function isFilled(type: string, value: NodeValue | null): value is NodeValue {
  if (value === null || value.text) return false
  return type === 'dsChart'
    ? hasChartData(value)
    : (value.columns?.length ?? 0) > 0
}

function blockPlaceholder(state: ViewState, value: NodeValue | null): string {
  const label = LABELS[state.type] ?? state.type
  return value?.text
    ? `${label} · ${value.text}`
    : placeholder(state.type, state.attrs)
}

function renderBlock(state: ViewState, value: NodeValue | null): void {
  const { dom, body, type } = state
  render(null, body)
  body.replaceChildren()
  const caption = dom.querySelector('.report-node-caption')
  if (caption) caption.textContent = value?.title ?? ''
  const filled = isFilled(type, value)
  dom.classList.toggle('report-data-node--value', filled)
  if (!isFilled(type, value)) {
    body.textContent = blockPlaceholder(state, value)
    return
  }
  if (type === 'dsChart')
    render(h(ReportChart, { node: value, paper: true }), body)
  else body.appendChild(paperTable(value))
}

function refresh(state: ViewState, store: PreviewStore | null): void {
  const pos = state.props.getPos()
  const preview = store?.current() ?? null
  const signature = nodeSignature(state.type, state.attrs)
  const path =
    pos === undefined ? '' : nodePath(state.props.editor.state.doc, pos)
  const value = path ? previewValue(preview, path, signature) : null
  const key = JSON.stringify([path, signature, preview?.period ?? null, value])
  if (key === state.rendered) return
  state.rendered = key
  if (INLINE.has(state.type)) renderInline(state, value)
  else renderBlock(state, value)
  const label = LABELS[state.type] ?? state.type
  state.dom.title = `配置${label}`
  state.dom.setAttribute('aria-label', `配置${label} · ${summary(state.attrs)}`)
}

function shell(type: string): { dom: HTMLElement; body: HTMLElement } {
  if (INLINE.has(type)) {
    const dom = element('span', 'report-data-node')
    return { dom, body: dom }
  }
  const dom = element('div', 'report-data-node report-data-block')
  dom.appendChild(element('div', 'report-node-caption'))
  const body = element('div', 'report-node-body')
  dom.appendChild(body)
  return { dom, body }
}

/**
 * 业务节点视图工厂。
 * @param store 正文试算结果；缺省时只显示占位
 */
export function createBusinessNodeView(
  store: PreviewStore | null = null,
): NodeViewRenderer {
  return (props) => {
    const type = props.node.type.name
    const { dom, body } = shell(type)
    dom.dataset['reportNode'] = type
    dom.contentEditable = 'false'
    dom.tabIndex = 0
    dom.setAttribute('role', 'button')
    const state: ViewState = {
      props,
      type,
      attrs: props.node.attrs,
      dom,
      body,
      rendered: '',
    }
    dom.addEventListener('click', () => openNode(props, dom))
    dom.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      openNode(props, dom)
    })
    refresh(state, store)
    const unsubscribe = store?.subscribe(() => refresh(state, store))
    return {
      dom,
      update: (node) => {
        if (node.type.name !== type) return false
        state.attrs = node.attrs
        refresh(state, store)
        return true
      },
      destroy: () => {
        unsubscribe?.()
        if (!INLINE.has(type)) render(null, body)
      },
      ignoreMutation: () => true,
      stopEvent: (event) =>
        event.type === 'click' ||
        (event instanceof KeyboardEvent &&
          (event.key === 'Enter' || event.key === ' ')),
    }
  }
}

export const businessNodeView: NodeViewRenderer = createBusinessNodeView()
