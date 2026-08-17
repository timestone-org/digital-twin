<script setup lang="ts">
/**
 * @fileoverview 右栏的绑定页：默认只摆**当前选中**的那个实体的行，切回全部才
 * 摆这段孪生的全部绑定。
 *
 * 一段孪生上百行绑定是常态（信息牌按字段摊平，一张牌就是好几行），全摆出来时
 * 「这一行是谁的」只能靠行名一行行认。跟着选中收窄之后，左边点谁、右边就是谁。
 *
 * 行**跟着实体走**，不由用户手工增删：每一行标着实体的名字与 id，而 id 与
 * 左边实体清单上显示的那一份逐字相同（信息牌字段是 `<牌 id>::<字段 key>`），
 * 绑的时候一眼能对上号。
 *
 * ⚠ 新绑的点位要**保存之后**才会有实时读数：推送方按落库的大屏版本重读绑定
 * 计划，内存里的草稿它看不见（DASHBOARD_DESIGN §6）。面板上必须摆明，
 * 否则表现成「绑完了但一直是占位符」。
 */
import type { BindingPayload } from '@dt/contracts'
import {
  TWIN_VIEW_BINDINGS,
  twinRowCounts,
  twinRowLabels,
  twinRowsOfEntity,
  type TwinConfig,
} from '@dt/twin-config'
import { DtButton, DtNotice, DtTag } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import BindingPanel from '@/components/binding/BindingPanel.vue'
import { TWIN_ENTITY_LABELS, type TwinSelection } from '../types'

const props = defineProps<{
  config: TwinConfig
  bindings: readonly BindingPayload[]
  /** 当前选中；绑定页据它收窄到一个实体。 */
  selection: TwinSelection
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

const rowLabels = computed(() => twinRowLabels(props.config))
const rowCounts = computed(() => twinRowCounts(props.config))

/** 用户主动切到了「全部」。⚠ 换选中要复位：收窄才是默认。 */
const isShowingAll = ref(false)
watch(
  () => props.selection,
  () => {
    isShowingAll.value = false
  },
)

/** 选中的那一个实体占了哪几行；这个选中不取数时是 null。 */
const ownRows = computed(() =>
  'id' in props.selection
    ? twinRowsOfEntity(props.config, props.selection.kind, props.selection.id)
    : null,
)

/** 收窄生效时选中的是什么，用于页头文案；没收窄就是 null。 */
const scope = computed(() => {
  if (isShowingAll.value || ownRows.value === null) return null
  const { kind } = props.selection
  return TWIN_ENTITY_LABELS[kind as keyof typeof TWIN_ENTITY_LABELS] ?? '实体'
})

const visibleRows = computed(() =>
  scope.value === null ? undefined : (ownRows.value ?? undefined),
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 p-2">
    <!-- ⚠ 收窄时必须说出来：不说的话，一个只有两行的绑定页看着像别的绑定丢了 -->
    <div v-if="scope !== null" class="flex shrink-0 items-center gap-2">
      <DtTag size="sm" intent="primary">只看选中的{{ scope }}</DtTag>
      <DtButton
        size="sm"
        variant="ghost"
        class="ml-auto"
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
      :specs="TWIN_VIEW_BINDINGS"
      :bindings="bindings"
      :row-labels="rowLabels"
      :row-counts="rowCounts"
      :visible-rows="visibleRows"
      @write="emit('write', $event)"
      @drop="emit('drop', $event)"
      @bind="emit('bind', $event)"
      @pick="emit('pick', $event)"
      @remove-row="(slotKey, rowIndex) => emit('removeRow', slotKey, rowIndex)"
    />
  </div>
</template>
