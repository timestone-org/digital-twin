<script setup lang="ts">
/** @fileoverview 显示某次开机或预测采用的逐台季节与达标范围。 */
import { computed } from 'vue'
import type { AcEffectiveCompliance } from '@dt/contracts'

const props = defineProps<{ items: readonly AcEffectiveCompliance[] }>()
const rows = computed(() =>
  props.items.map((item) => ({
    serial: item.serial,
    season: item.season === 'winter' ? '冬季' : '非冬季',
    ranges: item.limits
      .map((limit) => {
        const name = limit.metric === 'workshop_temp_avg' ? '温度' : '湿度'
        const unit = limit.metric === 'workshop_temp_avg' ? '℃' : '%RH'
        return `${name} ${limit.lower_limit ?? '不限'}～${limit.upper_limit ?? '不限'} ${unit}`
      })
      .join('，'),
  })),
)
</script>

<template>
  <div
    v-if="rows.length > 0"
    class="flex flex-col gap-1 text-xs text-secondary"
    aria-label="本次采用的达标范围"
  >
    <p>本次采用的达标范围</p>
    <p v-for="row in rows" :key="row.serial">
      {{ row.serial }} · {{ row.season }} · {{ row.ranges || '未限制范围' }}
    </p>
  </div>
</template>
