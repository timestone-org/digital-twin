/** @fileoverview 项目快速切换、失败保留、恢复和分页操作。 */
import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { useConfirm } from '@dt/ui'
import * as api from '@/api/hierarchy'
import { useHierarchyDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyDocument'
import { useHierarchySaving } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchySaving'
import { useHierarchyProjects } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyProjects'
import {
  harness,
  project,
  deferred,
} from '../../../../src/testing/hierarchyHarness'
vi.mock('@/api/hierarchy')
afterEach(() => {
  vi.resetAllMocks()
  useConfirm().resolve(false)
})
function setup() {
  return harness(() => {
    const editor = useHierarchyDocument()
    const saving = useHierarchySaving(editor, () => true)
    saving.install(project())
    return { editor, saving, projects: useHierarchyProjects(saving) }
  })
}
it('先发的慢请求不得覆盖后选项目，失败保留当前项目', async () => {
  const {
    state: { saving, projects },
    wrapper,
  } = setup()
  const first = deferred<ReturnType<typeof project>>(),
    second = deferred<ReturnType<typeof project>>()
  vi.mocked(api.getProject)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const older = projects.open('old')
  await flushPromises()
  const newer = projects.open('new')
  await flushPromises()
  second.resolve(project('new'))
  await newer
  first.resolve(project('old'))
  await older
  expect(saving.projectId.value).toBe('new')
  vi.mocked(api.getProject).mockRejectedValueOnce(new Error('无法连接'))
  await projects.open('failure')
  expect(saving.projectId.value).toBe('new')
  expect(projects.error.value).toBe('无法连接')
  wrapper.unmount()
})
it('搜索重置页码，历史恢复与删除需明确确认', async () => {
  const {
    state: { saving, projects },
    wrapper,
  } = setup()
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [project()],
    page: 1,
    size: 20,
    total: 1,
  })
  projects.setQuery('蒸汽')
  await projects.goToPage(2)
  expect(api.listProjects).toHaveBeenLastCalledWith(
    { page: 2, size: 20, q: '蒸汽' },
    expect.any(AbortSignal),
  )
  await projects.search()
  expect(projects.page.value).toBe(1)
  vi.mocked(api.history).mockResolvedValue({
    items: [{ revision: 1, created_at: project().updated_at }],
    next: null,
    has_more: false,
  })
  await projects.loadHistory()
  expect(projects.versions.value).toHaveLength(1)
  let restoring = projects.restore(1)
  useConfirm().resolve(false)
  await restoring
  expect(api.restoreProject).not.toHaveBeenCalled()
  vi.mocked(api.restoreProject).mockResolvedValue(project('project-1', 2))
  restoring = projects.restore(1)
  useConfirm().resolve(true)
  await restoring
  expect(saving.revision.value).toBe(2)
  const canceled = projects.remove()
  useConfirm().resolve(false)
  await canceled
  expect(api.deleteProject).not.toHaveBeenCalled()
  vi.mocked(api.deleteProject).mockResolvedValue()
  const removal = projects.remove()
  useConfirm().resolve(true)
  await removal
  expect(api.deleteProject).toHaveBeenCalledWith('project-1')
  wrapper.unmount()
})

it('明确重新加载可恢复冲突，不再次提交旧版本草稿', async () => {
  const {
    state: { editor, saving, projects },
    wrapper,
  } = setup()
  editor.commit({ ...project().document, title: '本地冲突草稿' })
  vi.mocked(api.saveProject).mockRejectedValue(new Error('版本冲突'))
  await expect(saving.flush()).rejects.toThrow('版本冲突')
  vi.mocked(api.getProject).mockResolvedValue({
    ...project('project-1', 4),
    document: { ...project().document, title: '服务器内容' },
  })
  await projects.reloadCurrent()
  expect(editor.document.value?.title).toBe('服务器内容')
  expect(saving.revision.value).toBe(4)
  expect(saving.error.value).toBe('')
  expect(api.saveProject).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
