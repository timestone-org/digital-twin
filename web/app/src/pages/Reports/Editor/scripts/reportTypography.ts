/** @fileoverview 报告段落的精确 Word 缩进与 HTML 往返。 */
import { Extension, type Editor, type EditorEvents } from '@tiptap/core'

const STYLES = {
  leftIndentPt: { css: 'margin-left', data: 'data-report-left-indent-pt' },
  rightIndentPt: { css: 'margin-right', data: 'data-report-right-indent-pt' },
  firstLineIndentPt: {
    css: 'text-indent',
    data: 'data-report-first-line-indent-pt',
  },
}
const SYNC_META = 'reportTypographySync'
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function cssPoints(text: string): number | null {
  const found = /^(-?\d+(?:\.\d+)?)\s*(pt|px|in|cm|mm|pc)$/u.exec(text.trim())
  if (!found) return null
  const scale: Record<string, number> = {
    pt: 1,
    px: 0.75,
    in: 72,
    cm: 72 / 2.54,
    mm: 72 / 25.4,
    pc: 12,
  }
  return finiteNumber(Number(found[1]) * (scale[found[2] ?? ''] ?? 1))
}
function indentAttribute(key: keyof typeof STYLES) {
  const style = STYLES[key]
  return {
    default: null,
    parseHTML: (element: HTMLElement): number | null => {
      const raw = element.getAttribute(style.data)
      if (raw !== null && raw.trim()) {
        const exact = finiteNumber(Number(raw))
        if (exact !== null) return exact
      }
      return cssPoints(element.style.getPropertyValue(style.css))
    },
    renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
      const value = finiteNumber(attrs[key])
      return value === null
        ? {}
        : { [style.data]: String(value), style: `${style.css}: ${value}pt` }
    },
  }
}
function nativeIndentChanged(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): boolean {
  return (
    previous['indent'] !== current['indent'] ||
    previous['indentUnit'] !== current['indentUnit']
  )
}
function clearChangedFirstLine({
  editor,
  transaction,
}: EditorEvents['transaction']): void {
  if (
    !transaction.docChanged ||
    transaction.getMeta('preventUpdate') !== undefined
  )
    return
  const inverse = transaction.mapping.invert()
  const update = editor.state.tr
  transaction.doc.descendants((node, position) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return
    const exact = finiteNumber(node.attrs['firstLineIndentPt'])
    if (exact === null) return
    const mapped = inverse.mapResult(position + 1)
    if (mapped.deletedAcross || mapped.pos < 1) return
    const previous = transaction.before.nodeAt(mapped.pos - 1)
    if (!previous || previous.type.name !== node.type.name) return
    const previousExact: unknown = previous.attrs['firstLineIndentPt']
    if (
      previousExact !== exact ||
      !nativeIndentChanged(previous.attrs, node.attrs)
    )
      return
    update.setNodeMarkup(position, undefined, {
      ...node.attrs,
      firstLineIndentPt: null,
    })
  })
  if (update.docChanged) editor.view.dispatch(update)
}
function synchronizeNativeIndent(editor: Editor): void {
  const update = editor.state.tr
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return
    const exact = finiteNumber(node.attrs['firstLineIndentPt'])
    if (exact === null || exact < 0) return
    const level = exact / 2
    if (node.attrs['indent'] === level && node.attrs['indentUnit'] === 'pt')
      return
    update.setNodeMarkup(position, undefined, {
      ...node.attrs,
      indent: level,
      indentUnit: 'pt',
    })
  })
  if (update.docChanged) editor.view.dispatch(update.setMeta(SYNC_META, true))
}
function changed(event: EditorEvents['transaction']): void {
  if (event.transaction.getMeta(SYNC_META) === true) return
  if (event.transaction.getMeta('preventUpdate') !== undefined) {
    synchronizeNativeIndent(event.editor)
    return
  }
  clearChangedFirstLine(event)
}
export const reportTypography = Extension.create({
  name: 'reportTypography',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          leftIndentPt: indentAttribute('leftIndentPt'),
          rightIndentPt: indentAttribute('rightIndentPt'),
          firstLineIndentPt: indentAttribute('firstLineIndentPt'),
        },
      },
    ]
  },
  onCreate({ editor }) {
    synchronizeNativeIndent(editor)
  },
  onTransaction: changed,
})
