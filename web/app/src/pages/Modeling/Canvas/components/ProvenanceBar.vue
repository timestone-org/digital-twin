<script setup lang="ts">
/**
 * @fileoverview ⑥ 区：这一路数据是从哪儿、哪一段时间来的，以及全量结果的下载入口。
 *
 * ⚠ 触顶时**请求区间与实际区间并排两行**：`provenance.since` 存的是请求起点，
 * 触顶时实际起点比它晚得多（结果展示规格 §1.3 D-7），只印一行是假的。
 */
import { computed } from 'vue'

import { formatDateTime } from '@/utils/datetime'

const props = defineProps<{
  tableCodes: readonly string[]
  since: string | null
  until: string | null
  /** 实际取到的起止；null = 后端没记，那时只印请求区间。 */
  actualSince: string | null
  actualUntil: string | null
  /** 全量结果的下载地址；空串 = 这次运行没留全量结果。 */
  downloadUrl: string
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
    <!-- ⚠ 用原生 <a download>：一份 CSV 可以到几十 MB，拉回内存再造 blob
         是白付一遍内存，交给浏览器直接下更省也天然带进度 -->
    <a
      v-if="props.downloadUrl"
      class="dt-ml-prov__download"
      :href="props.downloadUrl"
      download
    >
      下载全量结果
    </a>
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

  &__download {
    flex: none;
    color: var(--accent-primary);
    font-size: var(--ctl-hint-fs-md);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
