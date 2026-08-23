<script setup lang="ts">
/**
 * @fileoverview 批量撤销人工修正：仪表修好之后把整段退回自动采集值。
 *
 * ⚠ 时间范围留空 = 不限，但**不限刻意不做默认值**：默认填的是当前这一页的最早
 * 与最晚时刻。一次误点就抹掉三年的修正，而后端只回一个数字，看不出抹掉了什么
 * （docs/DATASET_DESIGN.md §7.8）。
 * ⚠ 列的预选同理：只勾**这一页上真的有角标**的那几列——用户是冲着看得见的角标
 * 来的，全勾等于替他决定去动那些他没看见的列。
 * ⚠ 回执里的「一格没撤」与「触顶没撤完」必须逐条说出来：不说的话，它们和
 * 「撤干净了」长得一模一样。
 */
import { computed, ref, watch } from 'vue'
import type { DatasetColumn, DatasetOverrideBulkClear } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtDateTimeInput,
  DtModal,
  DtNotice,
} from '@dt/ui'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { isRangeInverted, type RecordRange } from '../scripts/recordView'

const props = defineProps<{
  modelValue: boolean
  tableId: string
  columns: readonly DatasetColumn[]
  /** 当前这一页的最早与最晚数据时间，就是打开时填进去的默认范围。 */
  range: RecordRange
  /** 这一页真的带着角标的那几列，打开时默认勾上它们。 */
  badgedKeys: readonly string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  cleared: []
}>()

const picked = ref<Record<string, boolean>>({})
const since = ref('')
const until = ref('')
const error = ref<string | null>(null)
const receipt = ref<DatasetOverrideBulkClear | null>(null)
const busy = ref(false)

// 只有点位汇总列会带人工修正：录入列该直接改原始值、公式列该改公式，
// 后端对这两种当场报错。把它们列出来只会让人白勾一遍
const candidates = computed(() =>
  props.columns.filter((column) => column.source === 'point'),
)

const chosen = computed(() =>
  candidates.value
    .filter((column) => picked.value[column.key] === true)
    .map((column) => column.key),
)

const rangeHint = computed(() =>
  since.value === '' && until.value === ''
    ? '两端都留空 = 不限时间，这张台账上这几列的全部人工修正都会被撤销。'
    : '只撤这段时间里的修正；两端都留空才是不限。',
)

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset()
  },
  // ⚠ immediate：组件挂载时就已经是打开态的那种，只监听变化的 watch 一次都不跑
  { immediate: true },
)

function reset(): void {
  const seeded: Record<string, boolean> = {}
  for (const key of props.badgedKeys) seeded[key] = true
  picked.value = seeded
  since.value = props.range.since
  until.value = props.range.until
  error.value = null
  receipt.value = null
}

/** 空串 = 不限，转成不带这个字段。 */
function boundOf(value: string): string | undefined {
  return value === '' ? undefined : value
}

function problemOf(): string | null {
  if (chosen.value.length === 0) return '至少选一列'
  if (isRangeInverted(since.value, until.value)) {
    return '起始时间晚于结束时间'
  }
  return null
}

async function onSubmit(): Promise<void> {
  const problem = problemOf()
  error.value = problem
  if (problem !== null) return
  busy.value = true
  receipt.value = null
  try {
    receipt.value = await dataset.clearDatasetOverridesInRange(props.tableId, {
      column_keys: chosen.value,
      since: boundOf(since.value),
      until: boundOf(until.value),
    })
    emit('cleared')
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    title="批量撤销人工修正"
    description="所选列在这段时间里的修正全部撤掉，这些格回落到自动采集值"
    width="36rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-4 text-sm">
      <p class="text-xs leading-5 text-text-secondary">
        撤销后这些格显示的数字可能与现在不同；那些周期若本来就没采到数据，格子会变空。数据迁移带进来的修正也在其中，会一并撤销。
      </p>

      <div v-if="candidates.length === 0" class="text-xs text-text-disabled">
        这张台账没有点位汇总列，也就不会有人工修正可撤。
      </div>

      <div v-else class="flex flex-col gap-1.5">
        <span class="text-xs text-text-disabled">要撤销的列</span>
        <div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <DtCheckbox
            v-for="column in candidates"
            :key="column.id"
            :model-value="picked[column.key] === true"
            :label="column.name"
            @update:model-value="picked[column.key] = $event"
          />
        </div>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DtDateTimeInput v-model="since" label="起始时间" size="sm" />
        <DtDateTimeInput v-model="until" label="结束时间" size="sm" />
      </div>
      <p class="text-xs text-text-secondary">{{ rangeHint }}</p>

      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>

      <!-- 回执逐条摊开：撤了几格、顺带重算了多少行、有没有触顶 -->
      <DtNotice
        v-if="receipt"
        :intent="receipt.is_truncated ? 'warning' : 'info'"
      >
        <span v-if="receipt.cleared_cells === 0">
          这个范围里没有可撤销的人工修正，一格都没动。
        </span>
        <span v-else>
          已撤销 {{ receipt.cleared_rows }} 行、{{
            receipt.cleared_cells
          }}
          格人工修正<template v-if="receipt.recomputed > 0">
            ，顺带重算 {{ receipt.recomputed }} 行公式</template
          ><template v-if="receipt.failed > 0">
            ，其中 {{ receipt.failed }} 行求值出错</template
          >。
        </span>
        <span v-if="receipt.is_truncated">
          单次最多处理
          {{ receipt.limit }}
          行，本次只撤了最早的那一批，还有没撤完的——缩小时间范围再撤一次。
        </span>
      </DtNotice>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        关闭
      </DtButton>
      <DtButton
        intent="danger"
        icon="undo"
        :loading="busy"
        :disabled="candidates.length === 0"
        @click="onSubmit"
      >
        撤销修正
      </DtButton>
    </template>
  </DtModal>
</template>
