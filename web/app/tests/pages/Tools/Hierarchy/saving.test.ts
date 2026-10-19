/** @fileoverview 自动保存串行化、保存中的新修改与错误草稿保护。 */
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/api/hierarchy'
import { useHierarchyDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyDocument'
import { useHierarchySaving } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchySaving'
import { required } from '../../../../src/pages/Tools/Hierarchy/scripts/required'
import {
  harness,
  project,
  deferred,
} from '../../../../src/testing/hierarchyHarness'
vi.mock('@/api/hierarchy')
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})
function setup(canEdit = true) {
  return harness(() => {
    const editor = useHierarchyDocument()
    const saving = useHierarchySaving(editor, () => canEdit)
    saving.install(project())
    return { editor, saving }
  })
}
it('自动保存期间的新修改继续串行保存，不回写旧文档', async () => {
  const {
    state: { editor, saving },
    wrapper,
  } = setup()
  const first = deferred<ReturnType<typeof project>>()
  vi.mocked(api.saveProject)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(project('project-1', 3))
  editor.commit({ ...required(editor.document.value), title: '第一份' })
  await flushPromises()
  await vi.advanceTimersByTimeAsync(900)
  expect(api.saveProject).toHaveBeenCalledTimes(1)
  editor.commit({ ...required(editor.document.value), title: '第二份' })
  const flush = saving.flush()
  first.resolve(project('project-1', 2))
  await flush
  expect(api.saveProject).toHaveBeenCalledTimes(2)
  expect(api.saveProject).toHaveBeenLastCalledWith(
    'project-1',
    2,
    expect.objectContaining({ title: '第二份' }),
  )
  expect(editor.document.value?.title).toBe('第二份')
  expect(saving.dirty.value).toBe(false)
  wrapper.unmount()
})
it('冲突不清空草稿，不自动重试；明确再次保存才尝试', async () => {
  const {
    state: { editor, saving },
    wrapper,
  } = setup()
  vi.mocked(api.saveProject)
    .mockRejectedValueOnce(new Error('版本冲突'))
    .mockResolvedValueOnce(project('project-1', 2))
  editor.commit({ ...required(editor.document.value), title: '待保留草稿' })
  await expect(saving.flush()).rejects.toThrow('版本冲突')
  expect(saving.dirty.value).toBe(true)
  expect(saving.error.value).toBe('版本冲突')
  await vi.advanceTimersByTimeAsync(2000)
  expect(api.saveProject).toHaveBeenCalledTimes(1)
  await saving.flush()
  expect(saving.error.value).toBe('')
  expect(saving.dirty.value).toBe(false)
  wrapper.unmount()
})
it('只读视口变化不产生保存或未保存保护，卸载取消自动保存', async () => {
  const {
    state: { editor, saving },
    wrapper,
  } = setup(false)
  editor.commit(
    {
      ...required(editor.document.value),
      viewport: { x: 200, y: 100, zoom: 2 },
    },
    false,
  )
  await saving.flush()
  expect(saving.dirty.value).toBe(false)
  expect(api.saveProject).not.toHaveBeenCalled()
  wrapper.unmount()
  const active = setup()
  active.state.editor.commit({
    ...required(active.state.editor.document.value),
    title: '离开',
  })
  await flushPromises()
  active.wrapper.unmount()
  await vi.advanceTimersByTimeAsync(1000)
  expect(api.saveProject).not.toHaveBeenCalled()
})
