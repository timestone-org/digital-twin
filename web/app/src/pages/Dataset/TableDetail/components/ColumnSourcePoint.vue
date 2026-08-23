<script setup lang="ts">
/**
 * @fileoverview 列表单里「点位汇总」那一档的子块：绑哪个点位、按什么口径压成一个数。
 *
 * ⚠ 聚合口径是这一档的主要决策：一个周期里有一堆采样点，压成台账那一格时
 * 到底取均值、末值还是增量，选错了整列的数都是对的格式、错的含义。
 * ⚠ 选点面板随后续期次接进来；眼下先收点位身份本身，形如
 * `{数据源id}:{点位编码}`，与后端 `node_key` 逐字一致（ADR-0011）。
 */
import { computed } from 'vue'
import type { DatasetAggFunc } from '@dt/contracts'
import { DATASET_AGG_FUNCS } from '@dt/contracts'
import { DtInput, DtSelect } from '@dt/ui'

import { aggMeta, aggOptionsFor } from '../scripts/columnView'

const props = defineProps<{ nodeKeyError: string }>()

const nodeKey = defineModel<string>('nodeKey', { required: true })
const agg = defineModel<DatasetAggFunc>('agg', { required: true })

const aggHint = computed(() => aggMeta(agg.value).desc)
// ⚠ 认不出的口径也要留在选项里，理由见 aggOptionsFor
const aggOptions = computed(() => aggOptionsFor(agg.value))

/** DtSelect 抛的是裸 string，用窄化收口而不是 `as` 断言。 */
function onAgg(value: string): void {
  const found = DATASET_AGG_FUNCS.find((one) => one === value)
  if (found !== undefined) agg.value = found
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <DtInput
      v-model="nodeKey"
      label="点位标识"
      required
      :error="props.nodeKeyError"
      placeholder="数据源id:点位编码"
      hint="台账绑的是点位身份，与它背后跑的是哪个协议无关。选点面板随后续期次接进来，眼下先直接填这个标识。"
    />
    <DtSelect
      :model-value="agg"
      label="聚合口径"
      :options="aggOptions"
      :hint="aggHint"
      :display="{ placement: 'top' }"
      @update:model-value="onAgg"
    />
  </div>
</template>
