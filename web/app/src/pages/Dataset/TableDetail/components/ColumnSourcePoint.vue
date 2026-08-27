<script setup lang="ts">
/**
 * @fileoverview 列表单里「点位汇总」那一档的子块：绑哪个点位、按什么口径压成一个数。
 *
 * ⚠ 聚合口径是这一档的主要决策：一个周期里有一堆采样点，压成台账那一格时
 * 到底取均值、末值还是增量，选错了整列的数都是对的格式、错的含义。
 * ⚠ 点位从选点面板里挑，不手打：身份串 `{数据源id}:{点位编码}` 的前半截是
 * UUID，敲错一个字符就是一列永远汇总不出数的台账，而界面上一切正常——
 * 那与「这个周期确实没采到数」长得一模一样。身份串本身与它背后跑的是哪种
 * 协议无关（ADR-0011），换协议不改这里。
 */
import { computed, ref } from 'vue'
import type { CollectPoint, DatasetAggFunc } from '@dt/contracts'
import { DATASET_AGG_FUNCS } from '@dt/contracts'
import { DtField, DtSelect } from '@dt/ui'

import PointPickerDialog from '@/components/binding/PointPickerDialog.vue'
import PointRefField from '@/components/binding/PointRefField.vue'

import { aggMeta, aggOptionsFor } from '../scripts/columnView'

const props = defineProps<{
  nodeKeyError: string
  /** 正在配哪一列；只用来在选点面板上标明是给谁挑的。 */
  columnKey: string
}>()

const nodeKey = defineModel<string>('nodeKey', { required: true })
const agg = defineModel<DatasetAggFunc>('agg', { required: true })

const picking = ref(false)

const aggHint = computed(() => aggMeta(agg.value).desc)
// ⚠ 认不出的口径也要留在选项里，理由见 aggOptionsFor
const aggOptions = computed(() => aggOptionsFor(agg.value))

/** DtSelect 抛的是裸 string，用窄化收口而不是 `as` 断言。 */
function onAgg(value: string): void {
  const found = DATASET_AGG_FUNCS.find((one) => one === value)
  if (found !== undefined) agg.value = found
}

function onPick(point: CollectPoint): void {
  nodeKey.value = point.node_key
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <DtField
      label="点位"
      required
      :error="props.nodeKeyError"
      hint="台账绑的是点位身份，与它背后跑的是哪个协议无关：采集里配了什么数据源，这里就挑得到它下面的点位。"
    >
      <template #default="{ id, describedby }">
        <PointRefField
          :node-key="nodeKey"
          :control-id="id"
          :describedby="describedby"
          @pick="picking = true"
        />
      </template>
    </DtField>
    <DtSelect
      :model-value="agg"
      label="聚合口径"
      :options="aggOptions"
      :hint="aggHint"
      :display="{ placement: 'top' }"
      @update:model-value="onAgg"
    />
    <PointPickerDialog
      v-model="picking"
      :field-key="props.columnKey === '' ? null : props.columnKey"
      layer="confirm"
      @pick="onPick"
    />
  </div>
</template>
