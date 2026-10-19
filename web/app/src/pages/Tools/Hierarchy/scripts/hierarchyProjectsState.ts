/** @fileoverview 项目列表、切换、导入和历史恢复的页面状态。 */
import * as api from '@/api/hierarchy'
import { useRacedFetch } from '@/composables/useRacedFetch'
import type { HierarchySummary, HierarchyVersion } from '@dt/contracts'
import { useConfirm } from '@dt/ui'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { GraphDocument } from './types'
import type { useHierarchySaving } from './useHierarchySaving'

export function createState(saving: ReturnType<typeof useHierarchySaving>) {
  const items = shallowRef<HierarchySummary[]>([]),
    versions = shallowRef<HierarchyVersion[]>([])
  const page = ref(1),
    total = ref(0),
    query = ref(''),
    loading = ref(false),
    error = ref('')
  const listRequest = useRacedFetch(),
    projectRequest = useRacedFetch(),
    historyRequest = useRacedFetch()
  const confirm = useConfirm()
  const alive = true
  const fail = (caught: unknown) => {
    error.value = caught instanceof Error ? caught.message : '读取失败'
  }
  return {
    items,
    versions,
    page,
    total,
    query,
    loading,
    error,
    listRequest,
    projectRequest,
    historyRequest,
    confirm,
    alive,
    fail,
    saving,
  }
}

export class Controller {
  constructor(readonly state: ReturnType<typeof createState>) {
    watch(state.saving.savedProject, (project) => {
      if (project)
        state.items.value = state.items.value.map((item) =>
          item.id === project.id ? project : item,
        )
    })
    onBeforeUnmount(() => {
      this.state.alive = false
      this.state.listRequest.cancel()
      this.state.projectRequest.cancel()
      this.state.historyRequest.cancel()
    })
  }
  setQuery = (query: string) => {
    this.state.query.value = query
  }
  search = async () => {
    this.state.page.value = 1
    await this.refresh()
  }
  goToPage = async (page: number) => {
    this.state.page.value = page
    await this.refresh()
  }
  refresh = async () => {
    if (!this.state.alive) return
    await this.state.listRequest.run(
      (signal) =>
        api.listProjects(
          { page: this.state.page.value, size: 20, q: this.state.query.value },
          signal,
        ),
      {
        ok: (result) => {
          this.state.items.value = result.items
          this.state.total.value = result.total
          this.state.error.value = ''
        },
        fail: this.state.fail,
        settled: () => undefined,
      },
    )
  }
  open = async (id: string) => {
    if (!this.state.alive) return
    this.state.loading.value = true
    await this.state.projectRequest.run(
      async (signal) => {
        await this.state.saving.flush()
        return api.getProject(id, signal)
      },
      {
        ok: (project) => {
          this.state.saving.install(project)
          this.state.error.value = ''
        },
        fail: this.state.fail,
        settled: () => {
          if (this.state.alive) this.state.loading.value = false
        },
      },
    )
  }
  reloadCurrent = async () => {
    if (
      !this.state.alive ||
      this.state.loading.value ||
      this.state.saving.saving.value
    )
      return
    const id = this.state.saving.projectId.value
    this.state.loading.value = true
    await this.state.projectRequest.run(
      (signal) => api.getProject(id, signal),
      {
        ok: (project) => {
          this.state.saving.install(project)
          this.state.error.value = ''
        },
        fail: this.state.fail,
        settled: () => {
          this.state.loading.value = false
        },
      },
    )
  }
  create = async (document: GraphDocument) => {
    if (!this.state.alive) return
    if (this.state.loading.value) return
    this.state.loading.value = true
    this.state.projectRequest.cancel()
    try {
      await this.state.saving.flush()
      const project = await api.createProject(document)
      if (this.state.alive) {
        this.state.saving.install(project)
        this.state.page.value = 1
        await this.refresh()
      }
    } finally {
      if (this.state.alive) this.state.loading.value = false
    }
  }
  remove = async () => {
    if (this.state.loading.value || !this.state.alive) return false
    const id = this.state.saving.projectId.value
    this.state.loading.value = true
    try {
      const confirmed = await this.state.confirm.ask({
        title: '删除层级图项目？',
        message:
          '项目与其保存版本将一并删除。需要保留时请先导出 JSON 或 Excel 配置。',
        confirmText: '删除项目',
        danger: true,
      })
      if (!confirmed || !this.state.alive) return false
      await this.state.saving.flush()
      if (!this.state.alive || id !== this.state.saving.projectId.value)
        return false
      await api.deleteProject(id)
      await this.refresh()
      return true
    } finally {
      if (this.state.alive) this.state.loading.value = false
    }
  }
  loadHistory = async () => {
    if (!this.state.alive) return
    this.state.versions.value = []
    await this.state.historyRequest.run(
      (signal) => api.history(this.state.saving.projectId.value, signal),
      {
        ok: (result) => {
          this.state.versions.value = result.items
        },
        fail: this.state.fail,
        settled: () => undefined,
      },
    )
  }
  restore = async (target: number) => {
    if (!this.state.alive || this.state.loading.value) return
    const id = this.state.saving.projectId.value
    this.state.loading.value = true
    try {
      const confirmed = await this.state.confirm.ask({
        title: '恢复保存版本？',
        message:
          '当前修改会先保存，恢复后生成新版本。可以再次从历史中恢复当前内容。',
        confirmText: '恢复版本',
      })
      if (!confirmed || !this.state.alive) return
      await this.state.saving.flush()
      if (!this.state.alive || id !== this.state.saving.projectId.value) return
      const project = await api.restoreProject(
        id,
        this.state.saving.revision.value,
        target,
      )
      if (this.state.alive) {
        this.state.saving.install(project)
        await this.refresh()
        await this.loadHistory()
        return true
      }
    } finally {
      if (this.state.alive) this.state.loading.value = false
    }
  }
}
