<script setup lang="ts">
/**
 * @fileoverview 右栏的绑定页：这段孪生的全部点位绑定都在这里配。
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
  type TwinConfig,
} from '@dt/twin-config'
import { DtNotice } from '@dt/ui'
import { computed } from 'vue'

import BindingPanel from '@/components/binding/BindingPanel.vue'

const props = defineProps<{
  config: TwinConfig
  bindings: readonly BindingPayload[]
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
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 p-2">
    <DtNotice v-if="isDirty" intent="info" icon="alert-circle">
      新绑的点位要保存之后才会开始推送：推送方读的是已落库的那一份绑定。
    </DtNotice>
    <BindingPanel
      class="min-h-0 flex-1"
      :specs="TWIN_VIEW_BINDINGS"
      :bindings="bindings"
      :row-labels="rowLabels"
      :row-counts="rowCounts"
      @write="emit('write', $event)"
      @drop="emit('drop', $event)"
      @bind="emit('bind', $event)"
      @pick="emit('pick', $event)"
      @remove-row="(slotKey, rowIndex) => emit('removeRow', slotKey, rowIndex)"
    />
  </div>
</template>
