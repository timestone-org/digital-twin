<script setup lang="ts">
/**
 * @fileoverview 模型的压缩档一览：逐档的体积、相对原件的比例与状态。
 *
 * ⚠ 压缩失败**不影响素材可用**（原件一直在桶里），所以这一块要如实显示
 * 「压缩中 / 失败」而不是藏起来：藏了的话用户看到的是「选了一档却还是那么慢」，
 * 而没有任何一处说得清为什么。
 * ⚠ 相对比例拿**原件体积**当分母而不是拿最大的那一档：用户问的是「比原来小多少」。
 */
import { DtButton, DtNotice, DtTag } from '@dt/ui'
import { computed } from 'vue'

import type { AssetVariant } from '@/api/assets'
import { formatSize } from '@/utils/filesize'

const PERCENT = 100

const props = defineProps<{
  variants: readonly AssetVariant[]
  /** 原件体积，做相对比例的分母。 */
  originalBytes: number
  /** 持 `asset:manage` 才给重压。 */
  canManage: boolean
  /** 重压请求在途。 */
  isBusy: boolean
}>()

const emit = defineEmits<{ recompress: [] }>()

/** 有没有哪一档失败了——有的话才值得把「重压」摆出来当补救。 */
const hasFailure = computed(() =>
  props.variants.some((item) => item.status === 'failed'),
)
const isCompressing = computed(() =>
  props.variants.some((item) => item.status === 'pending'),
)

/**
 * 一档相对原件的百分比；还没压好或原件体积不明时给空串。
 * @param item 一档
 */
function ratioOf(item: AssetVariant): string {
  if (item.sizeBytes === null || props.originalBytes <= 0) return ''
  return `${Math.round((item.sizeBytes / props.originalBytes) * PERCENT)}%`
}

/**
 * 一档右侧那句话。
 * @param item 一档
 */
function stateOf(item: AssetVariant): string {
  if (item.status === 'ready') return formatSize(item.sizeBytes ?? 0)
  return item.status === 'pending' ? '压缩中…' : '失败'
}
</script>

<template>
  <section class="dt-variants">
    <header class="dt-variants__head">
      <span>压缩档</span>
      <DtButton
        v-if="canManage"
        size="sm"
        variant="ghost"
        icon="undo"
        :loading="isBusy"
        @click="emit('recompress')"
      >
        {{ hasFailure ? '重压' : '重新压一遍' }}
      </DtButton>
    </header>

    <p class="dt-variants__lead">
      原件永远保留且不改写；下面几档由后台压出来，配大屏时按「要多清楚」选。
    </p>

    <ul class="dt-variants__list">
      <li v-for="item in variants" :key="item.variant">
        <span class="dt-variants__name">
          {{ item.label }}
          <DtTag
            v-if="item.status === 'ready' && ratioOf(item) !== ''"
            size="sm"
          >
            {{ ratioOf(item) }}
          </DtTag>
        </span>
        <span class="dt-variants__hint">{{ item.hint }}</span>
        <span class="dt-variants__state" :class="`is-${item.status}`">
          {{ stateOf(item) }}
        </span>
      </li>
    </ul>

    <!-- ⚠ 失败原因必须给出来：不给的话用户只知道「有一档没成」，
         而重压一遍大概率还是同样的结果 -->
    <DtNotice
      v-for="item in variants.filter((one) => one.error !== '')"
      :key="`${item.variant}-error`"
      intent="danger"
    >
      {{ item.label }}：{{ item.error }}
    </DtNotice>

    <DtNotice v-if="isCompressing" intent="info">
      正在后台压缩。这期间素材照常可用——大屏会走原件。
    </DtNotice>
  </section>
</template>

<style scoped lang="scss">
.dt-variants {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--text-primary);
    gap: 8px;
  }

  &__lead {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-label-fs-md);
  }

  &__list {
    display: flex;
    flex-direction: column;
    padding: 0;
    margin: 0;
    gap: 6px;
    list-style: none;

    li {
      display: grid;
      align-items: center;
      padding: 6px 10px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      background: var(--surface-sunken);
      gap: 12px;
      grid-template-columns: minmax(7rem, auto) 1fr minmax(5rem, auto);
    }
  }

  &__name {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  &__hint {
    overflow: hidden;
    color: var(--text-disabled);
    font-size: var(--ctl-label-fs-md);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__state {
    color: var(--text-secondary);
    text-align: right;

    &.is-failed {
      color: var(--state-danger);
    }

    &.is-ready {
      color: var(--state-success);
    }
  }
}
</style>
