<script setup lang="ts">
/**
 * @fileoverview 试算：填几个样例值，看这条公式算出什么。手写公式最需要的那个确认。
 *
 * ⚠ **旧结果绝不配新公式**：显示之前先比一次「我试算的那份文本是不是还是框里
 * 这份」。不比的话，改完公式那个数还挂在上面，看着像刚算出来的
 * （docs/DATASET_DESIGN.md §7.6）。
 * ⚠ 试算**不取历史**：`PREV` / 时间窗 / 整列 / 跨表一律按空处理。回执的
 * `history_refs` 会列出来，界面必须照实说，不说就等于让人以为那几项真的算了。
 */
import { computed, onUnmounted, ref } from 'vue'
import type { DatasetFormulaColumn, DatasetFormulaPreview } from '@dt/contracts'
import { DtButton, DtInput } from '@dt/ui'

import * as dataset from '@/api/dataset'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

const props = defineProps<{
  tableId: string
  columnKey: string
  formula: string
  /** 公式引用到的本表列 key，来自校验回执的 `deps.same_row`。 */
  sameRow: readonly string[]
  /** 目录里的列，用来把 key 换成人看的名称与单位；取不到目录时是空表。 */
  columns: readonly DatasetFormulaColumn[]
  /** 公式还没校验通过时不给试算：算一条写不通的公式只会拿到同一句报错。 */
  ready: boolean
  unit: string
}>()

const values = ref<Record<string, string>>({})
const busy = ref(false)
const failure = ref('')
const result = ref<DatasetFormulaPreview | null>(null)
/** 这次结果算的是哪一份文本。公式一改，它就与框里那份对不上了。 */
const tracedFor = ref<string | null>(null)
const raced = useRacedFetch()

const fields = computed(() =>
  props.sameRow.map((key) => {
    const column = props.columns.find((one) => one.key === key)
    return {
      key,
      label: column?.name ?? key,
      placeholder: column?.unit ?? '数值',
    }
  }),
)

/** 只在「算的那份文本仍是现在这份」时才认这次结果。 */
const shown = computed(() =>
  tracedFor.value === props.formula ? result.value : null,
)

const missing = computed(() => shown.value?.missing ?? [])

/**
 * key → 列名。缺失列直接报 key 的话，用户要回头一列一列对照才知道是哪一列。
 * @param key 列标识
 */
function nameOf(key: string): string {
  return props.columns.find((one) => one.key === key)?.name ?? key
}

/** 空值不是「算错了」，是「这条公式在这组样例值下就该是空」。 */
const shownValue = computed(() => {
  const value = shown.value?.value
  if (value === null || value === undefined) return '空'
  if (typeof value === 'boolean') return value ? '真' : '假'
  if (typeof value === 'number' || typeof value === 'string')
    return String(value)
  return JSON.stringify(value)
})

/** 样例值：填得成数就按数走，否则原样当文本透传。留空即「这一列没有值」。 */
function collect(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(values.value)) {
    const text = raw.trim()
    if (text === '') continue
    const parsed = Number(text)
    out[key] = Number.isFinite(parsed) ? parsed : text
  }
  return out
}

function run(): void {
  const formula = props.formula
  busy.value = true
  failure.value = ''
  void raced.run(
    (signal) =>
      dataset.previewDatasetFormula(
        props.tableId,
        {
          formula,
          column_key: props.columnKey || undefined,
          values: collect(),
        },
        signal,
      ),
    {
      ok: (preview) => {
        result.value = preview
        tracedFor.value = formula
      },
      fail: (caught) => {
        result.value = null
        tracedFor.value = null
        failure.value = describeError(caught)
      },
      settled: () => (busy.value = false),
    },
  )
}

onUnmounted(() => raced.cancel())
</script>

<template>
  <!-- 开合交给 details 原生管：把 :open 绑到会在 @toggle 里自我翻转的 ref 上
       会 toggle → 改 state → 改 :open → 再 toggle，直接自激成死循环 -->
  <details class="text-2xs">
    <summary class="cursor-pointer text-text-disabled">
      试算（填几个样例值看算出什么）
    </summary>
    <div class="mt-2 flex flex-col gap-2">
      <p v-if="!props.ready" class="text-text-disabled">
        公式校验通过之后才能试算。
      </p>
      <p v-else-if="fields.length === 0" class="text-text-disabled">
        这条公式没有引用本表的列，填不了样例值，直接试算即可。
      </p>
      <div v-else class="flex flex-wrap gap-2">
        <label
          v-for="field in fields"
          :key="field.key"
          class="flex flex-col gap-0.5"
        >
          <span class="text-text-disabled">{{ field.label }}</span>
          <div class="w-24">
            <DtInput
              :model-value="values[field.key] ?? ''"
              size="sm"
              inputmode="decimal"
              :aria-label="`${field.label} 的样例值`"
              :placeholder="field.placeholder"
              @update:model-value="values[field.key] = $event"
            />
          </div>
        </label>
      </div>

      <div>
        <DtButton size="sm" :disabled="!props.ready || busy" @click="run">
          {{ busy ? '试算中…' : '试算' }}
        </DtButton>
      </div>

      <p v-if="failure" class="text-state-danger">{{ failure }}</p>
      <div v-else-if="shown" class="flex flex-col gap-1">
        <p v-if="!shown.is_ok" class="text-state-danger">
          {{ shown.error ?? '这条公式算不出来' }}
        </p>
        <template v-else>
          <p class="text-text-secondary">
            结果：<span class="text-text-primary">{{ shownValue }}</span>
            <span v-if="props.unit" class="text-text-disabled">{{
              props.unit
            }}</span>
          </p>
          <p v-if="missing.length > 0" class="text-state-warning">
            这些列没填值，结果被传染成空：{{ missing.map(nameOf).join('、') }}
          </p>
          <p v-if="shown.should_suggest_sum" class="text-text-disabled">
            加法遇到缺失就整条为空；想跳过缺失可以改用 SUM(…)。
          </p>
          <p v-if="shown.history_refs.length > 0" class="text-text-disabled">
            试算不读历史，下面这些引用一律按空算：{{
              shown.history_refs.join('、')
            }}
          </p>
        </template>
      </div>
    </div>
  </details>
</template>
