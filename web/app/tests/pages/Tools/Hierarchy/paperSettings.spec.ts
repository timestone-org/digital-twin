/** @fileoverview 项目名称输入：自动保存不吃掉输入中的空格，清空不把页面打进保存失败。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/api/hierarchy'
import HierarchyPaperSettings from '../../../../src/pages/Tools/Hierarchy/components/HierarchyPaperSettings.vue'
import { useHierarchyDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyDocument'
import { useHierarchySaving } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchySaving'
import { harness, project } from '../../../../src/testing/hierarchyHarness'
vi.mock('@/api/hierarchy')
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})
function setup() {
  const { state, wrapper: host } = harness(() => {
    const editor = useHierarchyDocument()
    const saving = useHierarchySaving(editor, () => true)
    saving.install(project())
    return { editor, saving }
  })
  vi.mocked(api.saveProject).mockImplementation((id, revision, document) =>
    Promise.resolve({
      ...project(id, revision + 1),
      document: structuredClone(document),
    }),
  )
  const wrapper = mount(HierarchyPaperSettings, {
    props: { editor: state.editor, readonly: false },
  })
  return { ...state, host, wrapper }
}
it('输入中停顿触发自动保存，也不删掉光标前的空格', async () => {
  const { wrapper, host } = setup()
  const input = wrapper.get('input')
  await input.setValue('蒸汽 ')
  await vi.advanceTimersByTimeAsync(1000)
  await flushPromises()
  expect((input.element as HTMLInputElement).value).toBe('蒸汽 ')
  expect(api.saveProject).toHaveBeenLastCalledWith(
    'project-1',
    1,
    expect.objectContaining({ title: '蒸汽' }),
  )
  wrapper.unmount()
  host.unmount()
})
it('清空名称再重填，自动保存照常恢复，不出保存失败', async () => {
  const { wrapper, host, saving } = setup()
  const input = wrapper.get('input')
  await input.setValue('')
  await vi.advanceTimersByTimeAsync(1000)
  expect(wrapper.text()).toContain('请填写项目名称')
  expect(saving.error.value).toBe('')
  await input.setValue('新名称')
  await vi.advanceTimersByTimeAsync(1000)
  await flushPromises()
  expect(saving.error.value).toBe('')
  expect(api.saveProject).toHaveBeenLastCalledWith(
    'project-1',
    expect.any(Number),
    expect.objectContaining({ title: '新名称' }),
  )
  wrapper.unmount()
  host.unmount()
})
