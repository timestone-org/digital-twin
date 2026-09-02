<script setup lang="ts">
/**
 * @fileoverview 上传队列面板：逐个文件的进度、结果与整体取消。
 *
 * ⚠ 失败的那一条要留在列表里并说出原因：一次挑十个文件、其中一个超限时，
 * 把它悄悄丢掉的话用户只会发现「怎么少了一个」，而没有任何一处说过为什么。
 */
import { DtButton, DtProgress } from '@dt/ui'
import { computed } from 'vue'

import type { UploadJob } from '@/features/assets/assetUploads'
import { formatSize } from '@/utils/filesize'

const PERCENT = 100

const props = defineProps<{
  jobs: readonly UploadJob[]
  /** 已结束（成功或失败）的条数。 */
  finished: number
}>()

const emit = defineEmits<{ cancel: []; clear: [] }>()

const isBusy = computed(() =>
  props.jobs.some(
    (job) => job.status === 'waiting' || job.status === 'uploading',
  ),
)

/**
 * 一项传到哪儿了，0～100。
 * ⚠ 分母用文件自身大小而不是浏览器报的总数：后者含表单字段，用它算出来的
 * 百分比永远差一点点、到不了 100。
 * @param job 队列里的一项
 */
function percentOf(job: UploadJob): number {
  if (job.status === 'done') return PERCENT
  if (job.sizeBytes <= 0) return 0
  return Math.min(PERCENT, (job.loaded / job.sizeBytes) * PERCENT)
}

/**
 * 这一项右侧那句话。
 * @param job 队列里的一项
 */
function statusOf(job: UploadJob): string {
  if (job.status === 'failed') return job.error
  if (job.status === 'done') return '已完成'
  if (job.status === 'waiting') return '排队中'
  return `${formatSize(job.loaded)} / ${formatSize(job.sizeBytes)}`
}
</script>

<template>
  <section v-if="jobs.length > 0" class="dt-upload-panel">
    <header class="dt-upload-panel__head">
      <span>上传队列（{{ finished }}/{{ jobs.length }}）</span>
      <DtButton v-if="isBusy" size="sm" variant="ghost" @click="emit('cancel')">
        全部取消
      </DtButton>
      <DtButton
        v-else-if="finished > 0"
        size="sm"
        variant="ghost"
        @click="emit('clear')"
      >
        清空
      </DtButton>
    </header>

    <ul class="dt-upload-panel__list">
      <li v-for="job in jobs" :key="job.id" :class="`is-${job.status}`">
        <span class="dt-upload-panel__name">{{ job.name }}</span>
        <DtProgress
          class="dt-upload-panel__bar"
          :value="percentOf(job)"
          :intent="job.status === 'failed' ? 'danger' : 'primary'"
        />
        <span class="dt-upload-panel__state">{{ statusOf(job) }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped lang="scss">
.dt-upload-panel {
  flex: none;
  padding: 8px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
    gap: 8px;
  }

  &__list {
    display: flex;
    max-height: 9rem;
    flex-direction: column;
    padding: 0;
    margin: 4px 0 0;
    gap: 4px;
    list-style: none;
    overflow-y: auto;

    li {
      display: grid;
      align-items: center;
      gap: 12px;
      // 末列定宽：按内容自适应的话，失败那一行的长原因会把它自己的进度条挤短，条与条不齐
      grid-template-columns: minmax(6rem, 1fr) 2fr 12rem;
    }

    .is-failed .dt-upload-panel__state {
      color: var(--state-danger);
    }
  }

  &__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__state {
    overflow-wrap: anywhere;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
    text-align: right;
  }
}
</style>
