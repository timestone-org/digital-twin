<script setup lang="ts">
/**
 * @fileoverview 2D 孪生子编辑器：大纲、画布、诊断与检查器；交互由 scripts/ 编排。
 */
import type { Twin2dConfig } from '@dt/twin2d'
import {
  DtButton,
  DtNotice,
  DtPageState,
  DtResizableLayout,
  useToast,
} from '@dt/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { installDashboardModules } from '@/bootstrap/dashboard'
import AiDock from '@/components/ai/AiDock.vue'
import PointPickerDialog from '@/components/binding/PointPickerDialog.vue'
import { AppShell } from '@/components/layout'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'
import { useSubEditorRouteGuard } from '@/features/dashboard/useSubEditorRouteGuard'

import EditorStage from './components/EditorStage.vue'
import NodePalette from './components/NodePalette.vue'
import StyleLibraryDrawer from './components/StyleLibraryDrawer.vue'
import Twin2dDiagnostics from './components/Twin2dDiagnostics.vue'
import Twin2dOutline from './components/Twin2dOutline.vue'
import Twin2dRightPane from './components/Twin2dRightPane.vue'
import Twin2dRuntimePreview from './components/Twin2dRuntimePreview.vue'
import Twin2dToolbar from './components/Twin2dToolbar.vue'
import { createTwin2dCommands } from './scripts/editorCommands'
import { createTwin2dSelection } from './scripts/editorSelection'
import type { Twin2dStyleKind } from './scripts/editorSelection'
import { addNode } from './scripts/nodeOps'
import { useTwin2dShortcuts } from './scripts/shortcuts'
import { twin2dScan, twin2dSetupIssues } from './scripts/twin2dIssues'
import type { Twin2dEntityKind } from './scripts/types'
import { TWIN_2D_AI_STARTERS, useTwin2dAi } from './scripts/useTwin2dAi'
import { useTwin2dBindings } from './scripts/useTwin2dBindings'
import { useTwin2dEditorPage } from './scripts/useTwin2dEditorPage'
import { useTwin2dSizing } from './scripts/useTwin2dSizing'

// ⚠ 直达子编辑器也要装配模块，否则素材地址与内置图标恒回空串。
installDashboardModules()

const route = useRoute()
const toast = useToast()

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
/** 样式库抽屉开着没有。 */
const libraryOpen = ref(false)
// ⚠ 编辑面开着时抽屉已经关闭，键盘手势仍必须暂停。
/** 带预览的样式编辑面；空串表示关闭。 */
const styleEditId = ref('')
/** 图元树选中项；右栏字段与画布高亮共用，空串表示未选。 */
const selectedPrim = ref('')

const config = computed(() => page.doc.value?.config.value ?? null)

/** 绑定这一路：绑定表、绑定页四个动作、挑点弹窗的开关，与那一份实时读数。 */
const binding = useTwin2dBindings(
  () => page.doc.value,
  () => dashboardId.value,
  () => nodeId.value,
)

// ⚠ SVG/DOM 舞台未接截图能力，见 scripts/aiSurface.ts。
const ai = useTwin2dAi(page, binding, selection)

// ⚠ 顶栏计数与诊断清单共用 twin2dIssues，避免显示不一致。
const issues = computed(() =>
  config.value === null ? [] : twin2dScan(config.value).issues,
)

// ⚠ 装配缺口只在启动时读取，并合入顶栏计数，避免素材缺失却没有诊断提示。
const setupIssues = twin2dSetupIssues()

const outlineSummary = computed(() => {
  const current = config.value
  if (current === null) return ''
  const { nodes, edges, marks, styles } = current
  return `节点 ${nodes.length} · 连线 ${edges.length} · 标注 ${marks.length} · 样式 ${styles.length}`
})

const canvasSummary = computed(() => {
  const canvas = config.value?.canvas
  if (canvas === undefined) return ''
  const size = `画布 ${canvas.width} × ${canvas.height} · 栅格 ${canvas.grid}`
  const state = parity.value
  return state === null ? size : `${size} · ${state.summary}`
})

/** 画布尺寸那一簇：1:1 判据、裁到内容，与把它们改过去的两个动作。 */
const sizing = useTwin2dSizing(
  () => config.value,
  () => page.node.value,
  commit,
)
const parity = computed(() => sizing.parity.value)

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

const commands = createTwin2dCommands({
  config: () => config.value,
  selection,
  commit,
  undo: () => page.doc.value?.undo(),
  redo: () => page.doc.value?.redo(),
  save: () => void save(),
  selectedPrim: () => selectedPrim.value,
  pickPrim: (primId) => {
    selectedPrim.value = primId
  },
})

useTwin2dShortcuts({
  handlers: commands.handlers,
  grid: () => config.value?.canvas.grid ?? 0,
  // ⚠ 编辑面也算一道覆盖层：它开着的时候抽屉已经被 `focusStyle` 关掉了，只认
  //   `libraryOpen` 的话这道硬闸自己失效，Delete 会去删画布上选中的那个节点
  suspended: () => libraryOpen.value || styleEditId.value !== '',
})

/**
 * 从调色板加一个节点，落在画布正中。
 * ⚠ 走 `addNode` 而不是就地拼一个：缺省值抄一份出来，抄的那份一旦与归一化不一致，
 * 新节点会在「存一次再读回来」之后悄悄变样。
 * @param styleId 拖下来的那份样式
 */
function addFromPalette(styleId: string): void {
  const current = config.value
  if (current === null) return
  const added = addNode(current, {
    styleId,
    x: current.canvas.width / 2,
    y: current.canvas.height / 2,
  })
  commit(added.config)
  if (added.id !== null) selection.select('nodes', added.id)
}

/**
 * 样式库里点了一份样式：右栏切过去，抽屉让开。
 * @param kind 哪条样式轴
 * @param id 样式 id
 */
function focusStyle(kind: Twin2dStyleKind, id: string): void {
  selection.focusStyle(kind, id)
  libraryOpen.value = false
}

/**
 * 诊断里点了一条：跳到出问题的那一个。
 * ⚠ 两条样式轴走 `styleFocus` 而不是画布选中：塞进画布那条轴的话，右栏画不出样式面，
 * 而画布上还会多出一个选不中的幽灵。
 * @param target 出问题的那个实体
 */
function focusIssue(target: { kind: Twin2dEntityKind; id: string }): void {
  if (target.kind === 'styles' || target.kind === 'edgeStyles') {
    selection.focusStyle(target.kind, target.id)
    return
  }
  selection.select(target.kind, target.id)
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

// ⚠ 换一份样式必须把图元选中清掉：图元 id 只在**它自己那份样式**里唯一，留着上一份
// 的 id 会让右栏画出另一份样式里同名的那一枚，而改哪一项都落在别人身上
watch(
  () => selection.styleFocus.value?.id ?? '',
  () => {
    selectedPrim.value = ''
  },
)

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

useSubEditorRouteGuard(() => page.doc.value?.isDirty.value === true, {
  title: '放弃未保存的改动',
  message: '这张 2D 孪生图有改动还没保存，离开就会丢失。',
  confirmText: '离开',
  danger: true,
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
        :issue-count="issues.length + setupIssues.length"
        :parity-text="parity?.summary ?? ''"
        :parity-exact="parity?.exact ?? false"
        :crop-exact="sizing.contentFit.value?.exact ?? true"
        :align-crops="sizing.alignCrops.value"
        @save="save"
        @undo="page.doc.value?.undo()"
        @redo="page.doc.value?.redo()"
        @fit="fitRequest += 1"
        @align-cell="sizing.alignToCell"
        @crop-to-content="sizing.cropToContent"
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

        <DtResizableLayout
          class="min-h-0 flex-1"
          storage-key="dt.twin2d-editor.layout"
          :stack-at="720"
          :panes="[
            { id: 'outline', label: '大纲', size: 20, minSize: 180 },
            { id: 'stage', label: '画布', size: 55, minSize: 280 },
            { id: 'inspector', label: '检查器', size: 25, minSize: 240 },
          ]"
        >
          <template #outline>
            <aside
              class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 text-2xs text-text-secondary"
              aria-label="大纲"
              data-test="outline"
            >
              <div class="flex items-center gap-1">
                <span class="min-w-0 flex-1 truncate">{{
                  outlineSummary
                }}</span>
                <DtButton
                  size="xs"
                  variant="ghost"
                  intent="primary"
                  icon="palette"
                  aria-label="样式库"
                  title="样式库：新建、复制、恢复内置与整包导入导出"
                  data-test="open-style-library"
                  @click="libraryOpen = true"
                />
              </div>
              <Twin2dOutline
                :config="config"
                :selection="selection"
                @change="commit"
              />
              <NodePalette :styles="config.styles" @add="addFromPalette" />
            </aside>
          </template>
          <template #stage>
            <DtResizableLayout
              class="min-h-0 flex-1"
              direction="vertical"
              storage-key="dt.twin2d-editor.diagnostics"
              :panes="
                showIssues
                  ? [
                      { id: 'canvas', label: '画布', size: 75, minSize: 180 },
                      {
                        id: 'issues',
                        label: '配置问题',
                        size: 25,
                        minSize: 80,
                      },
                    ]
                  : [{ id: 'canvas', label: '画布', size: 75, minSize: 180 }]
              "
            >
              <template #canvas>
                <section
                  class="relative min-h-0 min-w-0 flex-1"
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
                  <Twin2dRuntimePreview
                    :node="page.node.value"
                    :config="config"
                    :bindings="binding.bindings.value"
                    :live="binding.live"
                  />
                  <p
                    class="pointer-events-none absolute bottom-1 right-2 text-2xs text-text-disabled"
                    data-test="canvas-readout"
                  >
                    {{ canvasSummary }}
                  </p>
                </section>
              </template>
              <template #issues>
                <div
                  v-if="showIssues"
                  class="min-h-0 flex-1 overflow-y-auto p-2 text-2xs text-text-secondary"
                  aria-label="配置问题"
                  data-test="diagnostics"
                >
                  <DtNotice
                    v-for="text in setupIssues"
                    :key="text"
                    class="mb-1.5"
                    intent="warning"
                    icon="alert-triangle"
                    data-test="setup-issue"
                  >
                    {{ text }}
                  </DtNotice>
                  <Twin2dDiagnostics :config="config" @select="focusIssue" />
                </div>
              </template>
            </DtResizableLayout>
          </template>
          <template #inspector>
            <aside
              class="flex min-h-0 flex-1 flex-col text-2xs text-text-secondary"
              aria-label="检查器"
              data-test="inspector"
            >
              <div class="flex shrink-0 items-center gap-1 p-2 pb-0">
                <span
                  class="min-w-0 flex-1 truncate text-text-disabled"
                  data-test="inspector-target"
                >
                  {{ targetSummary }}
                </span>
                <DtButton
                  v-if="selection.styleFocus.value !== null"
                  size="xs"
                  variant="ghost"
                  intent="neutral"
                  icon="close"
                  aria-label="退出样式编辑"
                  title="退出样式编辑，回到画布上选中的那一个"
                  data-test="close-style-focus"
                  @click="selection.clearStyleFocus()"
                />
              </div>
              <Twin2dRightPane
                v-if="config !== null"
                class="min-h-0 flex-1"
                :config="config"
                :selection="selection.inspect.value"
                :pick="selection.pick.value"
                :style-focus="selection.styleFocus.value"
                :selected-prim="selectedPrim"
                :bindings="binding.bindings.value"
                :is-dirty="page.doc.value?.isDirty.value ?? false"
                @change="commit"
                @merge="commitMerged"
                @end-merge="endMerge"
                @pick-prim="selectedPrim = $event"
                @copy-prim="commands.handlers.copy()"
                @paste-prim="commands.handlers.paste()"
                @write-binding="binding.write"
                @drop-binding="binding.drop"
                @add-binding="binding.bind"
                @pick-point="binding.pickingFieldKey.value = $event"
                @remove-binding-row="binding.removeRow"
              />
            </aside>
          </template>
        </DtResizableLayout>

        <StyleLibraryDrawer
          v-model:open="libraryOpen"
          v-model:wizard-id="styleEditId"
          :config="config"
          :selected-prim="selectedPrim"
          :file-name="`${page.dashboard.value?.name ?? '2d'}-样式包`"
          @change="commit"
          @focus="focusStyle"
          @merge="commitMerged"
          @end-merge="endMerge"
          @pick-prim="selectedPrim = $event"
          @copy-prim="commands.handlers.copy()"
          @paste-prim="commands.handlers.paste()"
        />

        <PointPickerDialog
          :model-value="binding.pickingFieldKey.value !== null"
          :field-key="binding.pickingFieldKey.value"
          @update:model-value="binding.closePicker"
          @pick="binding.pickPoint"
        />

        <AiDock
          :ai="ai"
          surface-label="2D 孪生编辑器"
          hint="助手改的是草稿；它自己会问你要不要保存，保存之后实时读数才认得新绑的点位。"
          :starters="TWIN_2D_AI_STARTERS"
        />
      </template>
    </div>
  </AppShell>
</template>
