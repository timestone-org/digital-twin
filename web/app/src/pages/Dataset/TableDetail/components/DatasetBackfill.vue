<script setup lang="ts">
/** @fileoverview 历史桶回填入口与实际任务回执；关闭后可重新读取进度。 */
import { computed } from 'vue'
import type { DatasetTable } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtDateTimeInput,
  DtModal,
  DtNotice,
  DtProgress,
  DtTag,
} from '@dt/ui'
import PermGuard from '@/components/PermGuard.vue'
import {
  BACKFILL_STATUS_LABELS,
  backfillRangeProblem,
  backfillTime,
} from '../scripts/backfillView'
import { useDatasetBackfill } from '../scripts/useDatasetBackfill'

const props = defineProps<{ table: DatasetTable }>()
const task = useDatasetBackfill(() => props.table)
const rangeProblem = computed(() =>
  backfillRangeProblem(task.since.value, task.until.value),
)
const canStart = computed(
  () =>
    !task.loading.value &&
    !task.busy.value &&
    !task.uncertain.value &&
    task.job.value?.status !== 'running' &&
    rangeProblem.value === null,
)
const status = computed(() =>
  task.job.value === null ? '' : BACKFILL_STATUS_LABELS[task.job.value.status],
)
</script>

<template>
  <p
    v-if="props.table.collect_mode === 'manual'"
    class="text-xs text-text-secondary"
  >
    手动录入台账不支持历史桶回填。
  </p>
  <div v-else class="flex shrink-0 flex-wrap items-center gap-2 text-xs">
    <PermGuard :codes="[PERMISSION_CODES.datasetBackfill]">
      <DtButton
        size="sm"
        variant="outline"
        data-test="backfill-open"
        @click="task.isOpen.value = true"
      >
        历史桶回填
      </DtButton>
    </PermGuard>
    <DtButton
      size="sm"
      variant="ghost"
      intent="neutral"
      @click="task.isOpen.value = true"
    >
      回填进度
    </DtButton>
    <DtTag v-if="task.job.value" size="sm">
      {{ status }}
    </DtTag>
    <span v-if="task.uncertain.value" class="text-text-secondary">
      状态待核查，请打开进度手动刷新
    </span>
  </div>

  <DtModal
    v-model="task.isOpen.value"
    title="历史桶回填"
    description="读取历史点位值，重建汇总桶；与仅重算公式不同"
    width="44rem"
  >
    <div class="backfill-body flex flex-col gap-4 text-sm">
      <p class="text-xs leading-5 text-text-secondary">
        时间以本地时区显示，提交为
        UTC。范围包含结束桶，由后台按汇总周期对齐、历史保留范围和完整桶裁剪。关闭或返回不会取消后台任务，重开可读取实际状态。
      </p>
      <PermGuard :codes="[PERMISSION_CODES.datasetBackfill]">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DtDateTimeInput
            v-model="task.since.value"
            label="起始桶时间"
            required
            :disabled="task.busy.value || task.job.value?.status === 'running'"
          />
          <DtDateTimeInput
            v-model="task.until.value"
            label="结束桶时间（包含）"
            required
            :disabled="task.busy.value || task.job.value?.status === 'running'"
          />
        </div>
        <DtNotice
          v-if="task.since.value && task.until.value && rangeProblem"
          intent="danger"
        >
          {{ rangeProblem }}
        </DtNotice>
      </PermGuard>
      <DtNotice v-if="task.error.value" intent="danger">
        {{ task.error.value }}
      </DtNotice>
      <DtNotice v-if="task.notice.value" intent="info">
        {{ task.notice.value }}
      </DtNotice>
      <p
        v-if="task.loading.value"
        role="status"
        class="text-xs text-text-secondary"
      >
        正在读取实际进度…
      </p>
      <section
        v-if="task.job.value"
        aria-label="实际回填任务"
        class="flex flex-col gap-2"
      >
        <strong>{{ status }}</strong>
        <DtProgress
          :value="task.job.value.done_buckets"
          :max="task.job.value.total_buckets"
          aria-label="历史桶回填进度"
        />
        <p>
          桶进度 {{ task.job.value.done_buckets }} /
          {{ task.job.value.total_buckets }}；已写
          {{ task.job.value.written_rows }} 行
        </p>
        <p>
          请求范围：{{ backfillTime(task.job.value.requested_since) }} 至
          {{ backfillTime(task.job.value.requested_until) }}
        </p>
        <p>
          实际范围：{{ backfillTime(task.job.value.since) }} 至
          {{ backfillTime(task.job.value.until) }}；周期
          {{ task.job.value.interval_ms / 1000 }} 秒
        </p>
        <p>
          开始 {{ backfillTime(task.job.value.started_at) }}；更新
          {{ backfillTime(task.job.value.updated_at) }}
        </p>
        <p v-if="task.job.value.finished_at">
          结束 {{ backfillTime(task.job.value.finished_at) }}
        </p>
        <p>
          后续公式已重算 {{ task.job.value.recomputed }} 行；失败
          {{ task.job.value.recompute_failed }} 行
        </p>
        <DtNotice v-if="task.job.value.is_clamped" intent="warning">
          范围已被后台裁剪，请核对实际范围。
        </DtNotice>
        <DtNotice
          v-if="
            task.job.value.is_recompute_truncated ||
            task.job.value.recompute_failed > 0
          "
          intent="warning"
        >
          后续公式重算未全部完成，请核查数据；此回执不代表全部公式已更新。
        </DtNotice>
        <DtNotice v-if="task.job.value.status === 'cancelled'" intent="warning">
          任务已取消，已经写入的历史桶保留。
        </DtNotice>
        <DtNotice v-if="task.job.value.error" intent="danger">
          {{ task.job.value.error }}
        </DtNotice>
        <p v-if="task.job.value.message">{{ task.job.value.message }}</p>
        <ul
          v-if="task.job.value.notes.length"
          class="list-inside list-disc text-xs text-text-secondary"
        >
          <li v-for="note in task.job.value.notes" :key="note">
            {{ note }}
          </li>
        </ul>
        <p
          v-if="task.job.value.status !== 'running'"
          class="text-xs text-text-secondary"
        >
          返回数据分区并刷新数据，可核查已写入的历史桶。
        </p>
      </section>
    </div>
    <template #footer>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <DtButton
          variant="ghost"
          intent="neutral"
          :disabled="task.busy.value"
          @click="task.isOpen.value = false"
        >
          关闭
        </DtButton>
        <DtButton
          variant="outline"
          :disabled="task.loading.value || task.busy.value"
          data-test="backfill-refresh"
          @click="task.refresh()"
        >
          刷新进度
        </DtButton>
        <PermGuard :codes="[PERMISSION_CODES.datasetBackfill]">
          <DtButton
            v-if="task.job.value?.status === 'running'"
            intent="danger"
            :disabled="
              task.loading.value || task.busy.value || task.uncertain.value
            "
            data-test="backfill-cancel"
            @click="task.cancel()"
          >
            取消任务
          </DtButton>
          <DtButton
            v-else
            :disabled="!canStart"
            data-test="backfill-start"
            @click="task.start()"
          >
            开始回填
          </DtButton>
        </PermGuard>
      </div>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.backfill-body {
  overflow-wrap: anywhere;
}
</style>
