/** @fileoverview 真实 Umo 运行时与报告页面设置的挂载契约。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReportDocument } from '@dt/contracts'

const blank: ReportDocument = { type: 'doc', content: [{ type: 'paragraph' }] }
const EXPECTED_WARNINGS = [
  "KaTeX doesn't work in quirks mode",
  'The `textContent` prop on <button>',
  '当前环境不支持Canvas',
  'The element <.umo-page-content> does not exist',
]

afterEach(async () => {
  document.body.replaceChildren()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  vi.restoreAllMocks()
})

it('含 Word 水印旋转角时真实 Umo 仍能挂载正文页', async () => {
  if (document.doctype === null) {
    document.insertBefore(
      document.implementation.createDocumentType('html', '', ''),
      document.documentElement,
    )
  }
  const errors: string[] = []
  const warnings: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    errors.push(parts.map(String).join(' '))
  })
  vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
    warnings.push(parts.map(String).join(' '))
  })
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  const ReportEditor = (
    await import('@/pages/Reports/Editor/components/ReportEditor.vue')
  ).default
  const appendChild = document.head.appendChild.bind(document.head)
  vi.spyOn(document.head, 'appendChild').mockImplementation(
    <TNode extends Node>(node: TNode): TNode => {
      if (
        node instanceof HTMLScriptElement ||
        node instanceof HTMLLinkElement
      ) {
        queueMicrotask(() => node.dispatchEvent(new Event('load')))
        return node
      }
      return appendChild(node)
    },
  )
  const wrapper = mount(ReportEditor, {
    attachTo: document.body,
    props: {
      modelValue: blank,
      page: {
        watermark: { text: '内部', font_size_pt: 12, rotation: -30 },
      },
    },
  })

  try {
    await vi.waitFor(() => {
      expect(wrapper.find('.umo-page-content').exists()).toBe(true)
    })
    expect(errors).toEqual([])
    expect(
      warnings.filter(
        (warning) =>
          !EXPECTED_WARNINGS.some((expected) => warning.includes(expected)),
      ),
    ).toEqual([])
  } finally {
    wrapper.unmount()
    await flushPromises()
  }
})
