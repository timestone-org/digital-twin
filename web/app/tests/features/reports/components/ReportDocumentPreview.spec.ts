/** @fileoverview 报告图表挂载在 Word 原位置，并随报告切换及卸载清理。 */
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, onMounted, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import Component from '@/features/reports/components/ReportDocumentPreview.vue'
const controls = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock('@/features/reports/scripts/inlineWordCharts', async (actual) => ({
  ...(await actual<object>()),
  prepareInlineWordCharts: controls.prepare,
}))
const Word = defineComponent({
  emits: ['rendered'],
  setup(_props, { emit }) {
    const host = ref<HTMLElement | null>(null)
    onMounted(() => emit('rendered', host.value))
    return () =>
      h('div', { ref: host }, [
        h('table', [
          h('tbody', [h('tr', [h('td', 'LEFT'), h('td', 'RIGHT')])]),
        ]),
        h('p', '正文结论'),
      ])
  },
})
const Chart = defineComponent({
  props: { node: Object },
  template: '<div role="img">{{ node.title }}</div>',
})
function result() {
  return {
    blob: new Blob(['preview']),
    charts: [
      {
        marker: 'LEFT',
        node: { kind: 'line', title: '左图' },
        widthCm: 7,
        heightCm: 5,
      },
      {
        marker: 'RIGHT',
        node: { kind: 'bar', title: '右图' },
        widthCm: 7,
        heightCm: 5,
      },
    ],
  }
}
const options = {
  global: { stubs: { DocumentPreviewDocx: Word, ReportChart: Chart } },
}
afterEach(() => vi.resetAllMocks())
it('两个图表位于各自单元格，结论仍位于图表之后', async () => {
  controls.prepare.mockResolvedValue(result())
  const wrapper = mount(Component, {
    ...options,
    props: { blob: new Blob(['word']) },
  })
  await flushPromises()
  expect(wrapper.findAll('td').map((cell) => cell.text())).toEqual([
    '左图',
    '右图',
  ])
  expect(wrapper.findAll('[role="img"]')).toHaveLength(2)
  expect(wrapper.text().endsWith('正文结论')).toBe(true)
  wrapper.unmount()
})
it('慢的旧报告准备完成后不能覆盖新报告，也不能重复挂载图表', async () => {
  let finish: ((value: ReturnType<typeof result>) => void) | undefined
  controls.prepare
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValueOnce(result())
  const wrapper = mount(Component, {
    ...options,
    props: { blob: new Blob(['old']) },
  })
  await wrapper.setProps({ blob: new Blob(['new']) })
  await flushPromises()
  finish?.({ blob: new Blob(['old']), charts: [] })
  await flushPromises()
  expect(wrapper.findAll('[role="img"]')).toHaveLength(2)
  wrapper.unmount()
})
it('图表解析失败显示明确错误', async () => {
  controls.prepare.mockRejectedValue(new Error('报告图表引用无效'))
  const wrapper = mount(Component, {
    ...options,
    props: { blob: new Blob(['bad']) },
  })
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('引用无效')
  expect(wrapper.findAll('[role="img"]')).toHaveLength(0)
  wrapper.unmount()
})
it('无法还原图表位置时显示原件下载提示', async () => {
  const value = result()
  const first = value.charts[0]
  if (first) first.marker = 'MISSING'
  controls.prepare.mockResolvedValue(value)
  const wrapper = mount(Component, {
    ...options,
    props: { blob: new Blob(['word']) },
  })
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('位置未能还原')
  wrapper.unmount()
})
it('未知错误也显示可操作的原件下载提示', async () => {
  controls.prepare.mockRejectedValue(null)
  const wrapper = mount(Component, {
    ...options,
    props: { blob: new Blob(['word']) },
  })
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('请下载原件')
  wrapper.unmount()
})
