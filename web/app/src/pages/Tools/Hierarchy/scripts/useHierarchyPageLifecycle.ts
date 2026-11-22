/** @fileoverview 服务可用性与层级图页面离开保护。 */
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'
import { useWorkspaceGuard } from '@/features/workspace/useWorkspaceGuard'
import { useHierarchyCapabilitiesStore } from '@/stores/hierarchyCapabilities'
import type { useConfirm } from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { useHierarchyDocument } from './useHierarchyDocument'
import type { useHierarchyProjects } from './useHierarchyProjects'
import type { useHierarchySaving } from './useHierarchySaving'

type Projects = ReturnType<typeof useHierarchyProjects>
type Saving = ReturnType<typeof useHierarchySaving>
type Confirm = ReturnType<typeof useConfirm>

/** 装配可用性检查、初始项目读取及离开保护。 */
export function useHierarchyPageLifecycle(
  projects: Projects,
  saving: Saving,
  confirm: Confirm,
) {
  const capabilityRequests = useHierarchyCapabilitiesStore()
  const request = useRacedFetch()
  const available = ref(false)
  const checking = ref(true)
  const availabilityError = ref('')
  let alive = true
  onBeforeUnmount(() => {
    alive = false
    request.cancel()
  })
  useLeaveGuard(saving, confirm, () => alive)

  async function initialize(): Promise<void> {
    checking.value = true
    let ready = false
    await request.run(() => capabilityRequests.load(), {
      ok: (result) => {
        ready = result.is_enabled
        available.value = result.is_enabled
        availabilityError.value = ''
      },
      fail: (error) => {
        available.value = false
        availabilityError.value =
          error instanceof Error ? error.message : '层级图服务不可用'
      },
      settled: () => {
        checking.value = false
      },
    })
    if (!ready || !alive) return
    await projects.refresh()
    if (!alive) return
    const first = projects.items.value[0]
    if (first) await projects.open(first.id)
  }

  onMounted(() => {
    void initialize()
  })
  return { available, checking, availabilityError, initialize }
}

/** 离开时优先保存，失败后保留草稿供用户选择。 */
function useLeaveGuard(
  saving: Saving,
  confirm: Confirm,
  isAlive: () => boolean,
) {
  useUnsavedGuard(() => saving.dirty.value || saving.saving.value)
  useWorkspaceGuard(async () => {
    if (!saving.dirty.value && !saving.saving.value) return true
    try {
      await saving.flush()
      return true
    } catch {
      if (!isAlive()) return false
      return confirm.ask({
        title: '仍有未保存的层级图',
        message:
          '保存未成功，离开会丢失本地修改。可以取消并导出 JSON 保留草稿。',
        confirmText: '放弃修改并离开',
        cancelText: '保留草稿',
        danger: true,
      })
    }
  })
}

/** 展示稿件应用与保存状态。 */
export function savingStatus(
  saving: ReturnType<typeof useHierarchySaving>,
  editor: ReturnType<typeof useHierarchyDocument>,
) {
  return computed(() =>
    saving.error.value
      ? '保存失败，草稿仍保留'
      : saving.saving.value
        ? '正在保存'
        : editor.hasDrafts.value
          ? '节点内容待应用'
          : saving.dirty.value
            ? '等待保存'
            : '已保存',
  )
}
