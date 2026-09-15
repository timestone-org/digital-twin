/** @fileoverview 临时视角历史和隔离，不修改持久化视点。 */
import { defineComponent, h, ref, shallowRef } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { useTwinNavigation } from '@/pages/TwinEditor/scripts/useTwinNavigation'
import type { TwinViewportHandle } from '@/pages/TwinEditor/scripts/twinViewportOps'
import type { TwinSelection } from '@/pages/TwinEditor/scripts/types'
it('返回上一视角，切换对象同步隔离，显示全部恢复显隐', async () => {
  const pose: ReturnType<TwinViewportHandle['snapshot']> = {
    position: [1, 2, 3],
    target: [0, 0, 0],
    fov: 45,
  }
  const handle: TwinViewportHandle = {
    focus: vi.fn(),
    snapshot: () => pose,
    restoreView: vi.fn(),
    isolatePart: vi.fn(),
    measureDistance: () => null,
    playRoamPreview: () => false,
    stopRoamPreview: () => undefined,
    stageEl: () => null,
  }
  const viewport = shallowRef<TwinViewportHandle | null>(handle),
    selection = ref<TwinSelection>({ kind: 'parts', id: 'p' })
  const reset = vi.fn(),
    holder: { api: ReturnType<typeof useTwinNavigation> | null } = { api: null }
  const wrapper = mount(
    defineComponent({
      setup() {
        holder.api = useTwinNavigation(viewport, () => selection.value, reset)
        return () => h('div')
      },
    }),
  )
  const api = holder.api
  if (api === null) throw new Error('missing navigation')
  api.focus({ kind: 'cameras', id: 'c' })
  api.back()
  expect(handle.restoreView).toHaveBeenCalledWith(pose)
  expect(api.canBack.value).toBe(false)
  api.toggleIsolation()
  expect(handle.isolatePart).toHaveBeenLastCalledWith('p')
  selection.value = { kind: 'parts', id: 'q' }
  await flushPromises()
  expect(handle.isolatePart).toHaveBeenLastCalledWith('q')
  selection.value = { kind: 'model' }
  await flushPromises()
  expect(api.isolated.value).toBe(false)
  api.reset()
  expect(reset).toHaveBeenCalledOnce()
  wrapper.unmount()
})
