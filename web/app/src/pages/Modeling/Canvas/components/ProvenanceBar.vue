<script setup lang="ts">
/**
 * @fileoverview ⑥ 区：这一路数据是从哪儿、哪一段时间来的，以及全量结果的下载入口。
 *
 * ⚠ 触顶时**请求区间与实际区间并排两行**：`provenance.since` 存的是请求起点，
 * 触顶时实际起点比它晚得多（结果展示规格 §1.3 D-7），只印一行是假的。
 */
import { computed } from 'vue'

import type { ModelingFrameTarget } from '@/api/modeling'
import { formatDateTime } from '@/utils/datetime'

import FrameDownloadButton from './FrameDownloadButton.vue'

const props = defineProps<{
  tableCodes: readonly string[]
  since: string | null
  until: string | null
  /** 实际取到的起止；null = 后端没记，那时只印请求区间。 */
  actualSince: string | null
  actualUntil: string | null
  /** 仅为已保留全量的端口提供下载目标。 */
  downloadTarget: ModelingFrameTarget | null
}>()

const source = computed(() =>
  props.tableCodes.length === 0 ? '' : `台账 ${props.tableCodes.join('、')}`,
)

/** 两个区间的写法必须一致，否则并排两行会被读成两种口径。 */
function span(since: string | null, until: string | null): string {
  return `${formatDateTime(since, '最早')} ~ ${formatDateTime(until, '此刻')}`
}

const requested = computed(() => span(props.since, props.until))

const actual = computed(() =>
  props.actualSince === null && props.actualUntil === null
    ? ''
    : span(props.actualSince, props.actualUntil),
)
</script>

<template>
  <div class="dt-ml-prov">
    <p v-if="actual" class="dt-ml-prov__line">
      <span v-if="source">{{ source }}</span>
      <span>请求 {{ requested }}</span>
      <span class="dt-ml-prov__actual">实际取到 {{ actual }}</span>
    </p>
    <p v-else-if="source || since || until" class="dt-ml-prov__line">
      <span v-if="source">{{ source }}</span>
      <span>{{ requested }}</span>
    </p>
    <FrameDownloadButton :target="props.downloadTarget" />
  </div>
</template>

<style scoped lang="scss">
.dt-ml-prov {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  justify-content: space-between;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-subtle);

  &__line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
  }

  &__actual {
    color: var(--text-primary);
  }
}
</style>
