<script setup lang="ts">
/**
 * @fileoverview 2D 孪生子编辑器：大纲（左）/ 画布（中）/ 检查器（右）。
 * 编辑的是某张大屏上某个节点的那段 2D 孪生配置，落库走大屏的整树替换。
 *
 * ⚠ 这一页对「自己在编 twin-2d-view」一无所知，也不该知道：是大屏编辑器按清单上的
 * `subEditor` 声明跳进来的，路由参数只有 `dashboardId` + `nodeId`。
 * ⚠ 未保存的改动只在内存里，没有本地草稿可恢复，所以两道守卫缺一不可：站内跳转
 * 拦在 `onBeforeRouteLeave`，关标签页 / 刷新拦在 `useUnsavedGuard`。
 */
import {
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
  collectTwin2dIssues,
  twin2dStyleResolver,
} from '@dt/twin2d'
import { DtButton, DtNotice, DtPageState, useConfirm, useToast } from '@dt/ui'
import { computed, onBeforeUnmount, ref } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'

import { installDashboardModules } from '@/bootstrap/dashboard'
import { AppShell } from '@/components/layout'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'

import Twin2dToolbar from './components/Twin2dToolbar.vue'
import { useTwin2dEditorPage } from './scripts/useTwin2dEditorPage'

// ⚠ 子编辑器也要装：直接刷新到这条路由时大屏那三页一个都没跑过，
// 不装的话素材地址与内置图标解析恒回空串，画面上是一张只剩底色的图
installDashboardModules()

const route = useRoute()
const toast = useToast()
const confirm = useConfirm()

const dashboardId = computed(() => String(route.params.dashboardId ?? ''))
const nodeId = computed(() => String(route.params.nodeId ?? ''))

const page = useTwin2dEditorPage(
  () => dashboardId.value,
  () => nodeId.value,
)

const showIssues = ref(false)
/** 画布层按这个信号取一次景；「适应」每按一次加一。 */
const fitRequest = ref(0)

const config = computed(() => page.doc.value?.config.value ?? null)

// 预置库里的样式也算「认识」，否则整张图的节点会被逐个报成悬空样式
const issues = computed(() => {
  const current = config.value
  return current === null
    ? []
    : collectTwin2dIssues(current, {
        knownStyleIds: new Set(TWIN_2D_BUILTIN_NODE_STYLE_MAP.keys()),
        styleOf: twin2dStyleResolver(current),
      })
})

// ⚠ 同一处路径上可能同时报出两条不同的问题，所以键里带上文档序
const issueRows = computed(() =>
  issues.value.map((issue, order) => ({
    key: `${order}:${issue.code}:${issue.at}`,
    text: `${issue.at}：${issue.message}`,
  })),
)

const outlineSummary = computed(() => {
  const current = config.value
  if (current === null) return ''
  const { nodes, edges, marks, styles } = current
  return `节点 ${nodes.length} · 连线 ${edges.length} · 标注 ${marks.length} · 样式 ${styles.length}`
})

const canvasSummary = computed(() => {
  const canvas = config.value?.canvas
  return canvas === undefined
    ? ''
    : `画布 ${canvas.width} × ${canvas.height} · 栅格 ${canvas.grid}`
})

const targetSummary = computed(() => {
  const size = page.targetSize.value
  return size === undefined ? '' : `大屏上占位 ${size.width} × ${size.height}`
})

/** 返回大屏编辑器；外壳的返回入口按站内路径走。 */
const backTo = computed(() => `/dashboards/${dashboardId.value}/edit`)

async function save(): Promise<void> {
  const ok = await page.save()
  if (ok) toast.success('2D 孪生已保存')
  else toast.error(page.conflict.value ?? '保存失败，请重试')
}

/** 冲突或加载失败之后的出口：整份重取，本地未保存的改动就此丢弃。 */
function reload(): void {
  void page.reload()
}

onBeforeRouteLeave(async () => {
  if (page.doc.value?.isDirty.value !== true) return true
  return await confirm.ask({
    title: '放弃未保存的改动',
    message: '这张 2D 孪生图有改动还没保存，离开就会丢失。',
    confirmText: '离开',
    danger: true,
  })
})

useUnsavedGuard(() => page.doc.value?.isDirty.value === true)

onBeforeUnmount(page.dispose)
</script>

<template>
  <AppShell
    title="2D 孪生编辑器"
    :subtitle="page.dashboard.value?.name ?? ''"
    :back-to="backTo"
    :back-label="page.dashboard.value?.name ?? '返回大屏编辑器'"
  >
    <template #actions>
      <Twin2dToolbar
        :is-dirty="page.doc.value?.isDirty.value ?? false"
        :is-saving="page.saving.value"
        :can-undo="page.doc.value?.canUndo.value ?? false"
        :can-redo="page.doc.value?.canRedo.value ?? false"
        :issue-count="issues.length"
        @save="save"
        @undo="page.doc.value?.undo()"
        @redo="page.doc.value?.redo()"
        @fit="fitRequest += 1"
        @toggle-issues="showIssues = !showIssues"
      />
    </template>

    <div class="flex h-full min-h-0 flex-col gap-2">
      <DtPageState
        v-if="
          page.loading.value || page.error.value !== null || config === null
        "
        :loading="page.loading.value"
        :error="page.error.value"
        :empty="false"
        @retry="reload"
      />
      <template v-else>
        <div
          v-if="page.conflict.value !== null"
          class="flex shrink-0 items-center gap-3"
          data-test="conflict"
        >
          <DtNotice intent="danger" icon="alert-triangle">
            {{ page.conflict.value }}
          </DtNotice>
          <DtButton
            size="sm"
            variant="outline"
            data-test="conflict-reload"
            @click="reload"
          >
            重新加载
          </DtButton>
        </div>

        <div class="flex min-h-0 flex-1">
          <aside
            class="w-64 shrink-0 overflow-y-auto border-r border-border-subtle p-2 text-2xs text-text-secondary"
            aria-label="大纲"
            data-test="outline"
          >
            {{ outlineSummary }}
          </aside>

          <div class="flex min-w-0 flex-1 flex-col">
            <section
              class="relative flex min-h-0 flex-1 items-center justify-center text-2xs text-text-disabled"
              aria-label="画布"
              data-test="canvas"
              :data-fit-request="fitRequest"
            >
              {{ canvasSummary }}
            </section>
            <ul
              v-if="showIssues"
              class="max-h-48 shrink-0 overflow-y-auto border-t border-border-subtle p-2 text-2xs text-text-secondary"
              aria-label="配置问题"
              data-test="diagnostics"
            >
              <li v-for="row in issueRows" :key="row.key">{{ row.text }}</li>
            </ul>
          </div>

          <aside
            class="w-80 shrink-0 overflow-y-auto border-l border-border-subtle p-2 text-2xs text-text-secondary"
            aria-label="检查器"
            data-test="inspector"
          >
            {{ targetSummary }}
          </aside>
        </div>
      </template>
    </div>
  </AppShell>
</template>
