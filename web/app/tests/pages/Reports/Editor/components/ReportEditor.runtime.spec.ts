/** @fileoverview 真实 Umo 运行时与报告页面设置的挂载契约。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { DtButton, DtInput } from '@dt/ui'
import type { ReportDocument } from '@dt/contracts'

const blank: ReportDocument = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'metricRef', attrs: { expr: '{温度}', precision: 2 } }],
    },
  ],
}
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
      expect(wrapper.find('.report-data-node').exists()).toBe(true)
    })
    await wrapper.get('.report-data-node').trigger('click')
    const expression = wrapper
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === '表达式')
    expect(expression?.props('modelValue')).toBe('{温度}')
    expression?.vm.$emit('update:modelValue', '{压力}')
    await flushPromises()
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === '应用修改')
      ?.trigger('click')
    expect(wrapper.get('.report-data-node').text()).toContain('{压力}')
    expect(JSON.stringify(wrapper.emitted('update:modelValue'))).toContain(
      '{压力}',
    )
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
