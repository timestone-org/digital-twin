<script setup lang="ts">
/**
 * @fileoverview 右栏的绑定页：默认只摆**当前选中**的那个实体的行，切回全部才摆这张图
 * 的全部绑定。
 *
 * 一张图上百行绑定是常态（一个节点按有效槽位摊平就是好几行，再加一行状态），全摆
 * 出来时「这一行是谁的」只能靠行名一行行认。跟着选中收窄之后，左边点谁、右边就是谁。
 *
 * 行**跟着实体走**，不由用户手工增删：三个槽都是钉在实体上的数组槽，每一行标着实体
 * 的名字与 id，而 id 与大纲上显示的那一份逐字相同，绑的时候一眼能对上号。
 * 一张图四十个槽位只接三个点位是常态，所以索引留空只表示「这个实体没接数据源」。
 *
 * ⚠ 收窄只对节点与连线生效：标注与两种样式本就没有绑定行，选中它们时退回全部，
 * 而不是摆一片空白让人以为绑定丢了。
 * ⚠ 新绑的点位要**保存之后**才会有实时读数：推送方按落库的大屏版本重读绑定计划，
 * 内存里的草稿它看不见（DASHBOARD_DESIGN §6）。面板上必须摆明，否则表现成
 * 「绑完了但一直是占位符」。
 */
import type { BindingPayload } from '@dt/contracts'
import {
  TWIN_2D_VIEW_BINDINGS,
  twin2dRowCounts,
  twin2dRowLabels,
  twin2dRowsOfEntity,
  type Twin2dConfig,
} from '@dt/twin2d'
import { DtButton, DtNotice, DtTag } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import BindingPanel from '@/components/binding/BindingPanel.vue'
import { TWIN_2D_ENTITY_LABELS } from '../scripts/types'
import type { Twin2dEntityKind, Twin2dSelection } from '../scripts/types'

const props = defineProps<{
  config: Twin2dConfig
  bindings: readonly BindingPayload[]
  /** 当前选中；绑定页据它收窄到一个实体。 */
  selection: Twin2dSelection
  /** 有还没保存的改动；有的话新绑的点位这一刻还不会有推送。 */
  isDirty: boolean
}>()

const emit = defineEmits<{
  write: [binding: BindingPayload]
  drop: [fieldKey: string]
  bind: [fieldKey: string]
  pick: [fieldKey: string]
  removeRow: [slotKey: string, rowIndex: number]
}>()

/** 会占绑定行的实体类别。 */
type Twin2dBindableKind = Extract<Twin2dEntityKind, 'nodes' | 'edges'>

/** 收窄只对这两类生效；标注与两种样式一行都不占。 */
const BINDABLE_KINDS: readonly Twin2dBindableKind[] = ['nodes', 'edges']

/** 收窄到哪个实体上。 */
interface Twin2dBindingScope {
  /** 页头文案里的实体名。 */
  label: string
  /** 这个实体占了哪几行，键是槽键、值是**行号**。 */
  rows: Readonly<Record<string, readonly number[]>>
}

/**
 * 选中的这一个占了哪几行。
 * ⚠ 收的是行号不是过滤后的序号：数组绑定的 fieldKey 由行号拼出来，按过滤后的位置
 * 重新编号会让每一条绑定都改喂另一个实体。
 * @param config 归一化后的 2D 孪生配置
 * @param kind 实体集合名
 * @param id 实体 id
 */
function scopeOf(
  config: Twin2dConfig,
  kind: Twin2dBindableKind,
  id: string,
): Twin2dBindingScope {
  const rows: Record<string, number[]> = {}
  for (const row of twin2dRowsOfEntity(config, id)) {
    const kept = rows[row.slotKey] ?? []
    kept.push(row.index)
    rows[row.slotKey] = kept
  }
  return { label: TWIN_2D_ENTITY_LABELS[kind], rows }
}

/** 用户主动切到了「全部」。⚠ 换选中要复位：收窄才是默认。 */
const isShowingAll = ref(false)
watch(
  () => props.selection,
  () => {
    isShowingAll.value = false
  },
)

/** 收窄生效时收在哪个实体上；没收窄（切了全部、或选中不取数）就是 null。 */
const scope = computed<Twin2dBindingScope | null>(() => {
  const target = props.selection
  if (isShowingAll.value || !('id' in target)) return null
  const kind = BINDABLE_KINDS.find((item) => item === target.kind)
  return kind === undefined ? null : scopeOf(props.config, kind, target.id)
})

const rowLabels = computed(() => twin2dRowLabels(props.config))
const rowCounts = computed(() => twin2dRowCounts(props.config))
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col gap-2 p-2"
    data-test="twin2d-binding-pane"
  >
    <div v-if="scope !== null" class="flex shrink-0 items-center gap-2">
      <DtTag size="sm" intent="primary">只看选中的{{ scope.label }}</DtTag>
      <DtButton
        size="sm"
        variant="ghost"
        class="ml-auto"
        data-test="binding-show-all"
        @click="isShowingAll = true"
      >
        显示全部
      </DtButton>
    </div>

    <DtNotice v-if="isDirty" intent="info" icon="alert-circle">
      新绑的点位要保存之后才会开始推送：推送方读的是已落库的那一份绑定。
    </DtNotice>

    <BindingPanel
      class="min-h-0 flex-1"
      :specs="TWIN_2D_VIEW_BINDINGS"
      :bindings="bindings"
      :row-labels="rowLabels"
      :row-counts="rowCounts"
      :visible-rows="scope?.rows"
      @write="emit('write', $event)"
      @drop="emit('drop', $event)"
      @bind="emit('bind', $event)"
      @pick="emit('pick', $event)"
      @remove-row="(slotKey, rowIndex) => emit('removeRow', slotKey, rowIndex)"
    />
  </div>
</template>
