<script setup lang="ts">
/**
 * @fileoverview 自定义卡片：右键画布上的一张卡片进来，整页改它——左栏结构、
 * 中栏边配边看、右栏字段。改的是**这一个节点**的 `configJson`，回画布立刻看得见。
 *
 * ⚠ 与两个孪生编辑器同构：由清单的 `subEditor` 声明跳进来，路由参数只有
 * `dashboardId` + `nodeId`。落库走大屏整树替换（见 `useCardEditorPage`）。
 */
import type { ConfigField } from '@dt/contracts'
import { getCardPart, getModule, readText } from '@dt/modules'
import { resolveModuleConfig, type GetModuleManifest } from '@dt/runtime'
import {
  DtButton,
  DtNotice,
  DtSpinner,
  DtResizableLayout,
  useConfirm,
  useToast,
  DtIconButton,
} from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { installDashboardModules } from '@/bootstrap/dashboard'
import { AppShell } from '@/components/layout'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'
import { useSubEditorRouteGuard } from '@/features/dashboard/useSubEditorRouteGuard'
import CardPreviewStage from './components/CardPreviewStage.vue'
import FieldsPane from './components/FieldsPane.vue'
import StructurePane from './components/StructurePane.vue'
import type { StructureRow } from './scripts/structureRows'
import {
  CELLS_KEY,
  PARTS_KEY,
  addCell,
  addPart,
  cellsOf,
  movePart,
  partsOf,
  removeCell,
  removePart,
  setRowField,
} from './scripts/cardDraft'
import { useCardEditorPage } from './scripts/useCardEditorPage'

// ⚠ 子编辑器也要装：直接刷新到这条路由时大屏那几页一个都没跑过，
// 不装的话中栏渲染的是「未知模块类型」，且没有报错
installDashboardModules()

const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const dashboardId = computed(() => String(route.params.dashboardId ?? ''))
const nodeId = computed(() => String(route.params.nodeId ?? ''))

const page = useCardEditorPage(
  () => dashboardId.value,
  () => nodeId.value,
)

/** 选中的是哪一项，形如 `part:0` / `cell:2`。 */
const activeKey = ref('part:0')
const backdrop = ref('screen')

const getManifest: GetModuleManifest = (moduleType: string) =>
  getModule(moduleType)

const moduleType = computed(() => page.node.value?.moduleType ?? '')
const manifest = computed(() => getModule(moduleType.value))
/**
 * 这一页改的配置：落库那份，缺了部件表或格表时补上清单缺省。
 * ⚠ 刚拖上来的卡片只存了外壳样式，画布上那两件部件与一格全来自缺省：照落库读
 * 左栏是空表，加一件就写出只有一件的表、把缺省那两件顶掉。只补这两张表，
 * 其余键仍留给渲染时铺缺省——全量写回会把缺省钉死在存量节点上。
 */
const config = computed<Record<string, unknown>>(() => {
  const stored = page.node.value?.configJson ?? {}
  const resolved = resolveModuleConfig(manifest.value, stored)
  return {
    ...stored,
    [PARTS_KEY]: resolved[PARTS_KEY],
    [CELLS_KEY]: resolved[CELLS_KEY],
  }
})

const size = computed(() => ({
  width: page.node.value?.w ?? manifest.value?.defaultSize.width ?? 420,
  height: page.node.value?.h ?? manifest.value?.defaultSize.height ?? 220,
}))

/** 那两张表在清单里的行字段声明。 */
function itemSchemaOf(key: string): readonly ConfigField[] {
  return (
    manifest.value?.configSchema.find((field) => field.key === key)
      ?.itemSchema ?? []
  )
}

const partRows = computed<StructureRow[]>(() =>
  partsOf(config.value).map((row, index) => {
    const kind = readText(row.kind)
    const found = itemSchemaOf(PARTS_KEY)
      .find((field) => field.key === 'kind')
      ?.options?.find((one) => one.value === kind)
    return {
      key: `part:${String(index)}`,
      label: found?.label ?? kind,
      note: '',
      icon: 'layers',
    }
  }),
)

const cellRows = computed<StructureRow[]>(() =>
  cellsOf(config.value).map((row, index) => ({
    key: `cell:${String(index)}`,
    label: readText(row.label) || `第 ${String(index + 1)} 格`,
    note: readText(row.unit),
    icon: 'table',
  })),
)

/** 选中项拆成「哪张表 + 第几行」。 */
const active = computed(() => {
  const [head, at] = activeKey.value.split(':')
  const index = Number(at)
  if (!Number.isInteger(index)) return null
  const key = head === 'part' ? PARTS_KEY : head === 'cell' ? CELLS_KEY : ''
  return key === '' ? null : { key, index }
})

const activeRow = computed<Record<string, unknown>>(() => {
  const hit = active.value
  if (hit === null) return {}
  const rows =
    hit.key === PARTS_KEY ? partsOf(config.value) : cellsOf(config.value)
  return rows[hit.index] ?? {}
})

/**
 * 右栏摆哪几个字段。
 * ⚠ 选中部件时把并集整份交给表单——别档的键由 `when: { key: 'kind' }` 自己滤掉，
 * 这里再筛一遍等于把那条机制抄第二份。
 */
const activeSchema = computed<readonly ConfigField[]>(() =>
  active.value === null ? [] : itemSchemaOf(active.value.key),
)

const activeTitle = computed<string>(() => {
  const hit = active.value
  if (hit === null) return ''
  const rows: readonly StructureRow[] =
    hit.key === PARTS_KEY ? partRows.value : cellRows.value
  return rows[hit.index]?.label ?? ''
})

const activeHelp = computed(() => {
  const hit = active.value
  if (hit === null || hit.key !== PARTS_KEY) return ''
  const kind = readText(partsOf(config.value)[hit.index]?.kind)
  return getCardPart(kind)?.hint ?? ''
})

function write(next: Record<string, unknown>): void {
  page.setConfig(next)
}

function onUpdate(field: string, value: unknown): void {
  const hit = active.value
  if (hit === null) return
  write(setRowField(config.value, hit.key, hit.index, field, value))
}

function onAddPart(): void {
  const kinds = itemSchemaOf(PARTS_KEY).find((one) => one.key === 'kind')
  const first = readText(kinds?.options?.[0]?.value)
  if (first === '') return
  write(addPart(config.value, first))
  // 新的那一件落在末尾，写完之后表长已经加一，下标是表长减一
  activeKey.value = `part:${String(partsOf(config.value).length - 1)}`
}

function onRemovePart(index: number): void {
  write(removePart(config.value, index))
  activeKey.value = 'part:0'
}

function onMovePart(index: number, delta: number): void {
  write(movePart(config.value, index, delta))
  activeKey.value = `part:${String(index + delta)}`
}

function onAddCell(): void {
  write(addCell(config.value))
}

/** ⚠ 删中间一格之后，它之后每一格的绑定都会改喂前一格——必须先说清再删。 */
async function onRemoveCell(index: number): Promise<void> {
  const ok = await confirm.ask({
    title: '删除这一格',
    message: '它之后每一格的数据绑定都会改喂前一格。删完请回大屏核对绑点面板。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  write(removeCell(config.value, index))
  activeKey.value = 'cell:0'
}

async function save(): Promise<void> {
  if (await page.save()) toast.success('已保存')
}

/** 冲突之后的出路：丢掉本地改动、重取库里的那份；脏着先问一句。 */
async function reload(): Promise<void> {
  if (page.isDirty.value) {
    const ok = await confirm.ask({
      title: '重新加载',
      message: '这一页没保存的改动会被库里的版本覆盖。',
      confirmText: '重新加载',
      danger: true,
    })
    if (!ok) return
  }
  await page.load()
}

const backTo = computed(() => `/dashboards/${dashboardId.value}/edit`)

function back(): void {
  void router.push({
    name: 'dashboard-editor',
    params: { dashboardId: dashboardId.value },
  })
}

watch([dashboardId, nodeId], () => {
  activeKey.value = 'part:0'
  void page.load()
})
onMounted(() => void page.load())
onBeforeUnmount(page.dispose)
useUnsavedGuard(() => page.isDirty.value)
useSubEditorRouteGuard(() => page.isDirty.value, {
  title: '还有没保存的改动',
  message: '离开这一页会丢掉它们。',
  confirmText: '离开',
  danger: true,
})
</script>

<template>
  <AppShell
    title="自定义卡片"
    :subtitle="manifest?.displayName ?? ''"
    :back-to="backTo"
    back-label="回大屏"
  >
    <template #actions>
      <DtButton variant="ghost" size="sm" @click="back">回大屏</DtButton>
      <DtIconButton
        size="sm"
        :loading="page.saving.value"
        :disabled="!page.isDirty.value || page.conflict.value !== null"
        data-test="save-card"
        variant="solid"
        intent="primary"
        icon="save"
        label="保存"
        @click="save"
      />
    </template>

    <div class="flex h-full min-h-0 flex-col gap-2">
      <DtNotice v-if="page.conflict.value !== null" intent="warning">
        {{ page.conflict.value }}
        <DtButton
          size="sm"
          variant="outline"
          data-test="reload-card"
          @click="reload"
        >
          重新加载
        </DtButton>
      </DtNotice>
      <DtNotice v-else-if="page.error.value !== null" intent="danger">
        {{ page.error.value }}
      </DtNotice>

      <div
        v-if="page.loading.value"
        class="flex flex-1 items-center justify-center"
      >
        <DtSpinner />
      </div>
      <DtResizableLayout
        v-else-if="page.node.value !== null"
        class="min-h-0 flex-1"
        storage-key="dt.card-editor.layout"
        :stack-at="720"
        :panes="[
          { id: 'structure', label: '结构', size: 20, minSize: 180 },
          { id: 'preview', label: '预览', size: 55, minSize: 280 },
          { id: 'fields', label: '字段', size: 25, minSize: 220 },
        ]"
      >
        <template #structure>
          <StructurePane
            class="min-h-0 flex-1 overflow-y-auto pr-2"
            :parts="partRows"
            :cells="cellRows"
            :active-key="activeKey"
            :can-remove-part="partRows.length > 1"
            :can-remove-cell="cellRows.length > 1"
            @select="activeKey = $event"
            @add-part="onAddPart"
            @add-cell="onAddCell"
            @remove-part="onRemovePart"
            @remove-cell="onRemoveCell"
            @move-part="onMovePart"
          />
        </template>
        <template #preview>
          <CardPreviewStage
            v-model:backdrop="backdrop"
            class="min-h-0 min-w-0 flex-1"
            :module-type="moduleType"
            :config="config"
            :get-manifest="getManifest"
            :width="size.width"
            :height="size.height"
          />
        </template>
        <template #fields>
          <FieldsPane
            class="min-h-0 flex-1 pl-2"
            :schema="activeSchema"
            :row="activeRow"
            :title="activeTitle"
            :help="activeHelp"
            @update="onUpdate"
          />
        </template>
      </DtResizableLayout>
    </div>
  </AppShell>
</template>
