<script setup lang="ts">
/**
 * @fileoverview 孪生子编辑器：大纲（左）/ 3D 视口（中）/ 检查器（右）。
 * 编辑的是某张大屏上某个节点的那段孪生配置，落库走大屏的整树替换。
 *
 * ⚠ 这一页对「自己在编 twin-view」一无所知，也不该知道：是大屏编辑器按
 * 清单上的 `subEditor` 声明跳进来的，路由参数只有 `dashboardId` + `nodeId`。
 * ⚠ 视口里不套距离派生的显隐，只认 `visibility.visible`——编辑时镜头到处飞，
 * 套上规则会让人「刚配好的东西一转镜头就不见了」。
 */
import { collectTwinConfigIssues, type Vec3 } from '@dt/twin-config'
import { DtPageState, useConfirm, useToast } from '@dt/ui'
import { computed, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'

import { AppShell } from '@/components/layout'

import TwinDiagnosticsPanel from './components/TwinDiagnosticsPanel.vue'
import TwinEditorToolbar from './components/TwinEditorToolbar.vue'
import TwinInspector from './components/TwinInspector.vue'
import TwinOutline from './components/TwinOutline.vue'
import TwinViewport from './components/TwinViewport.vue'
import { createTwinEditorActions } from './twinEditorActions'
import { TWIN_SELECT_MODEL, type TwinEntityKind, type TwinSelection } from './types'
import { useTwinEditorPage } from './useTwinEditorPage'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const dashboardId = computed(() => String(route.params.dashboardId ?? ''))
const nodeId = computed(() => String(route.params.nodeId ?? ''))

const page = useTwinEditorPage(
  () => dashboardId.value,
  () => nodeId.value,
)

const selection = ref<TwinSelection>(TWIN_SELECT_MODEL)
const showIssues = ref(false)
/** 模型里的全部节点名，视口加载完给的；部件检查器要用。 */
const modelNodes = ref<readonly string[]>([])
/** 正在等视口里点一下：点完把结果写回这个实体的哪个字段。 */
const pending = ref<{
  kind: TwinEntityKind
  id: string
  what: 'node' | 'position'
} | null>(null)

/**
 * 视口对外的两个命令。
 * ⚠ 手工与 `TwinViewport` 的 `defineExpose` 对齐：`InstanceType<typeof 组件>`
 * 取不到 `defineExpose` 的类型（会塌成 any），写错了 typecheck 与 lint 都不拦。
 */
interface TwinViewportHandle {
  focus: (selection: TwinSelection) => void
  snapshot: () => { position: Vec3; target: Vec3; fov: number }
}

const viewportRef = ref<TwinViewportHandle | null>(null)

const config = computed(() => page.doc.value?.config.value ?? null)
const issues = computed(() =>
  config.value === null ? [] : collectTwinConfigIssues(config.value),
)
const flaggedIds = computed(
  () => new Set(issues.value.map((issue) => issue.entityId)),
)

const actions = computed(() => {
  const doc = page.doc.value
  return doc === null
    ? null
    : createTwinEditorActions(doc, (next) => {
        selection.value = next
      })
})

const pickMode = computed(() => pending.value?.what ?? null)

function select(next: TwinSelection): void {
  selection.value = next
  // 选中即取景：在大纲里点一个锚点，视口该把镜头带过去
  viewportRef.value?.focus(next)
}

function requestPick(what: 'node' | 'position'): void {
  const current = selection.value
  if (!('id' in current)) return
  pending.value = { kind: current.kind, id: current.id, what }
}

function applyPick(patch: Record<string, unknown>): void {
  const target = pending.value
  const act = actions.value
  pending.value = null
  if (target === null || act === null || config.value === null) return
  const list: readonly { id: string }[] = config.value[target.kind]
  const entity = list.find((item) => item.id === target.id)
  if (entity === undefined) return
  act.patchConfig({
    [target.kind]: list.map((item) =>
      item.id === target.id ? { ...item, ...patch } : item,
    ),
  })
}

function onPickNode(name: string): void {
  const target = pending.value
  if (target === null || config.value === null) return
  const part = config.value.parts.find((item) => item.id === target.id)
  if (part === undefined) return
  // 同一个节点点两次不该塞两条进去
  const nodes = part.nodes.includes(name) ? part.nodes : [...part.nodes, name]
  applyPick({ nodes })
}

async function save(): Promise<void> {
  const ok = await page.save()
  if (ok) toast.success('孪生场景已保存')
  else toast.error(page.conflict.value ?? '保存失败，请重试')
}

/** 把当前机位存进某个视点。 */
function captureCamera(id: string): void {
  const act = actions.value
  const snapshot = viewportRef.value?.snapshot()
  if (act === null || snapshot === undefined || config.value === null) return
  act.patchConfig({
    cameras: config.value.cameras.map((item) =>
      item.id === id ? { ...item, ...snapshot } : item,
    ),
  })
}

function back(): void {
  void router.push({
    name: 'dashboard-editor',
    params: { dashboardId: dashboardId.value },
  })
}

// ⚠ 走之前必须问：这一页的改动只在内存里，直接离开就没了，且没有任何提示
onBeforeRouteLeave(async () => {
  if (page.doc.value?.isDirty.value !== true) return true
  return await confirm.ask({
    title: '放弃未保存的改动',
    message: '孪生场景有改动还没保存，离开就会丢失。',
    confirmText: '离开',
    danger: true,
  })
})
</script>

<template>
  <AppShell
    title="孪生编辑器"
    :subtitle="page.dashboard.value?.name ?? ''"
  >
    <div class="flex h-full flex-col">
      <TwinEditorToolbar
        :is-dirty="page.doc.value?.isDirty.value ?? false"
        :is-saving="page.saving.value"
        :can-undo="page.doc.value?.canUndo.value ?? false"
        :can-redo="page.doc.value?.canRedo.value ?? false"
        :issue-count="issues.length"
        :back-label="page.dashboard.value?.name ?? '返回大屏编辑器'"
        @save="save"
        @undo="page.doc.value?.undo()"
        @redo="page.doc.value?.redo()"
        @back="back"
        @toggle-issues="showIssues = !showIssues"
      />

      <DtPageState
        v-if="page.loading.value || page.error.value !== null || config === null"
        :loading="page.loading.value"
        :error="page.error.value"
        :empty="false"
      />
      <div v-else class="flex min-h-0 flex-1">
        <TwinOutline
          class="w-64 shrink-0 overflow-y-auto border-r border-border-subtle"
          :config="config"
          :selection="selection"
          :flagged-ids="flaggedIds"
          @select="select"
          @add="actions?.add($event)"
          @remove="actions?.remove($event.kind, $event.id)"
          @duplicate="actions?.duplicate($event.kind, $event.id)"
          @move="actions?.move($event.kind, $event.id, $event.delta)"
          @toggle-visible="actions?.toggleVisible($event.kind, $event.id)"
        />

        <div class="flex min-w-0 flex-1 flex-col">
          <TwinViewport
            ref="viewportRef"
            class="min-h-0 flex-1"
            :config="config"
            :selection="selection"
            :pick-mode="pickMode"
            @select="selection = $event ?? TWIN_SELECT_MODEL"
            @pick-node="onPickNode"
            @pick-position="(position: Vec3) => applyPick({ position })"
            @model-nodes="modelNodes = $event"
          />
          <TwinDiagnosticsPanel
            v-if="showIssues"
            class="max-h-48 shrink-0 overflow-y-auto border-t border-border-subtle"
            :issues="issues"
            @focus="select"
          />
        </div>

        <TwinInspector
          class="w-80 shrink-0 overflow-y-auto border-l border-border-subtle"
          :config="config"
          :selection="selection"
          :model-nodes="modelNodes"
          :picking="pending !== null"
          @patch="actions?.patchConfig($event)"
          @request-pick="requestPick"
          @cancel-pick="pending = null"
          @capture-camera="captureCamera"
        />
      </div>
    </div>
  </AppShell>
</template>
