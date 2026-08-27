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
import type { Twin2dConfig } from '@dt/twin2d'
import { DtButton, DtNotice, DtPageState, useConfirm, useToast } from '@dt/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'

import { installDashboardModules } from '@/bootstrap/dashboard'
import { AppShell } from '@/components/layout'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'

import EditorStage from './components/EditorStage.vue'
import Twin2dInspector from './components/Twin2dInspector.vue'
import Twin2dToolbar from './components/Twin2dToolbar.vue'
import { createTwin2dSelection } from './scripts/editorSelection'
import { useTwin2dEditorPage } from './scripts/useTwin2dEditorPage'
import type { Twin2dEntityKind } from './scripts/types'

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

/** 画布这一条选中轴；大纲与检查器随后接同一份。 */
const selection = createTwin2dSelection()

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

/**
 * 一手势、一次点选改出来的整份配置落一步撤销。
 * ⚠ 写配置只有这一支与 `commitMerged`：绕开文档态写的那一笔不会重派绑定，
 * 而界面上一切照旧。
 * @param next 整份新配置
 */
function commit(next: Twin2dConfig): void {
  page.doc.value?.commit(next)
}

/**
 * 连续输入的一帧：同 `key` 的连着并成一帧撤销。
 * ⚠ 文本框逐键各落一帧的话，敲一个显示名就往撤销栈里塞进十几格，撤销键从此
 * 按不回上一步。
 * @param next 整份新配置
 * @param key 这一段连续输入的标识
 */
function commitMerged(next: Twin2dConfig, key: string): void {
  page.doc.value?.commitMerged(next, key)
}

/** 一段连续输入到此为止；下一次输入重新开一帧。 */
function endMerge(): void {
  page.doc.value?.endMerge()
}

// ⚠ 撤销、重做与删除之后选中里会留下已经不存在的 id：不摘的表现是右栏画着一个
// 已经不存在的东西，改哪一项都写不回去且不报错
watch(config, (next) => {
  if (next === null) return
  selection.prune((kind: Twin2dEntityKind, id: string) => {
    const rows: readonly { id: string }[] = next[kind]
    return rows.some((row) => row.id === id)
  })
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
              class="relative min-h-0 flex-1"
              aria-label="画布"
              data-test="canvas"
              :data-fit-request="fitRequest"
            >
              <EditorStage
                v-if="config !== null"
                :config="config"
                :selection="selection"
                :fit-request="fitRequest"
                @change="commit"
              />
              <p
                class="pointer-events-none absolute bottom-1 right-2 text-2xs text-text-disabled"
                data-test="canvas-readout"
              >
                {{ canvasSummary }}
              </p>
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
            class="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border-subtle p-2 text-2xs text-text-secondary"
            aria-label="检查器"
            data-test="inspector"
          >
            <p class="text-text-disabled" data-test="inspector-target">
              {{ targetSummary }}
            </p>
            <Twin2dInspector
              v-if="config !== null"
              :config="config"
              :selection="selection.inspect.value"
              @change="commit"
              @merge="commitMerged"
              @end-merge="endMerge"
            />
          </aside>
        </div>
      </template>
    </div>
  </AppShell>
</template>
