/** @fileoverview 标准图预览的提示收纳、按面板宽度适配和手动缩放。 */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import HierarchyPreview from '@/pages/Tools/Hierarchy/components/HierarchyPreview.vue'
import { generate } from '@/pages/Tools/Hierarchy/scripts/drawing'
import { SAMPLE } from '@/pages/Tools/Hierarchy/scripts/sample'

enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('大量独立节点提示初始收拢，仍可展开查阅完整列表', async () => {
  const document = structuredClone(SAMPLE)
  document.edges = []
  document.nodes = document.nodes.filter((node) => node.kind === 'meter')
  const drawing = generate(document)
  const preview = mount(HierarchyPreview, { props: { drawing } })
  const details = preview.get<HTMLDetailsElement>('details')
  expect(details.element.open).toBe(false)
  expect(details.get('summary').text()).toContain(String(drawing.nodeCount))
  await details.get('summary').trigger('click')
  expect(details.element.open).toBe(true)
  expect(details.findAll('li')).toHaveLength(drawing.nodeCount)
  expect(details.text()).toContain('Z1-01 是独立根节点')
})

it('适宽模式随面板变化，手动缩放保留比例，点击适应后恢复跟随', async () => {
  let resize: (width: number) => void = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(notify: (entries: { contentRect: DOMRect }[]) => void) {
        resize = (width) =>
          notify([{ contentRect: new DOMRect(0, 0, width, 400) }])
      }
      observe = vi.fn()
      disconnect = disconnect
    },
  )
  const drawing = generate(SAMPLE)
  const preview = mount(HierarchyPreview, { props: { drawing } })
  const width = () =>
    parseFloat(preview.get<HTMLImageElement>('img').element.style.width)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(520)
  await preview.get('img').trigger('load')
  resize(480)
  await nextTick()
  expect(width()).toBeCloseTo(480)
  resize(300)
  await nextTick()
  expect(width()).toBeCloseTo(300)
  await preview.get('[aria-label="放大"]').trigger('click')
  resize(640)
  await nextTick()
  expect(width()).toBeCloseTo(360)
  await preview.get('[aria-label="适应图纸"]').trigger('click')
  expect(width()).toBeCloseTo(640)
  preview.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})
