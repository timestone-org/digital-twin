<script setup lang="ts">
/**
 * @fileoverview 一条绑定按来源种类要填的那几项。
 * ⚠ 常量的 `0` / `false` / `''` 都是合法取值：清空输入写的是 `null`（= 没配过），
 * 不许把 falsy 当成「没配」，否则一整屏的零值会消失。
 * ⚠ 五种来源**逐档显式列出**，末尾那一档是「没有认出的来源」而不是某一种来源：
 * 用 `v-else` 兜底的话，再加一种来源会安静地画成上一种的表单，
 * 用户填得完、也存得下，只是存的是另一种来源的字段。契约测试逐档钉死。
 * ⚠ 取点间隔与折算**只画在点位历史那一档**：台账 `:series` 与常量、派生都不收
 * 这两个参数，摆在别处是「配得出来、存得下、取数时被丢掉」。
 * ⚠ 这两项的说法与趋势分析页逐字一致：同一件事在两个页面上长得不一样，用户
 * 会以为它们是两回事。
 */
import type {
  ArchiveBindingDetail,
  BindingPayload,
  BindingSpec,
  CollectAggregate,
  ComputeOp,
  DtSelectOption,
  HistoryTimeRange,
} from '@dt/contracts'
import { COLLECT_AGGREGATES, COMPUTE_OPS } from '@dt/contracts'
import {
  DtCheckbox,
  DtField,
  DtInput,
  DtNotice,
  DtNumberInput,
  DtSelect,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import { windowToMs } from '@/api/pointHistories'
import {
  TREND_BUCKET_AUTO,
  trendBucketChoices,
} from '@/features/trend/trendBucket'
import DatasetRefField from './DatasetRefField.vue'
import PointRefField from './PointRefField.vue'

const props = defineProps<{
  spec: BindingSpec
  binding: BindingPayload
  /** 同节点内其它槽的 fieldKey，派生绑定从中挑输入。 */
  siblingKeys: readonly string[]
}>()

const emit = defineEmits<{
  write: [binding: BindingPayload]
  pick: []
}>()

const OP_OPTIONS: readonly DtSelectOption[] = COMPUTE_OPS.map((op) => ({
  value: op,
  label: op,
}))

/** 各档折算的说法。⚠ 与 `COLLECT_AGGREGATES` 一一对应，少一条就是下拉里少一项。 */
const AGGREGATE_LABELS: Record<string, string> = {
  avg: '平均值',
  max: '最大值',
  min: '最小值',
  sum: '求和',
  count: '样本数',
}

/** 服务端的聚合缺省档（`schemas/history.py` 的 `aggregate` 默认值）。 */
const DEFAULT_AGGREGATE = 'avg'

const AGGREGATE_OPTIONS: readonly DtSelectOption[] = [
  {
    value: '',
    label: `默认（${AGGREGATE_LABELS[DEFAULT_AGGREGATE] ?? DEFAULT_AGGREGATE}）`,
  },
  ...COLLECT_AGGREGATES.map((value) => ({
    value,
    label: AGGREGATE_LABELS[value] ?? value,
  })),
]

const staticText = computed(() =>
  typeof props.binding.staticValueJson === 'string'
    ? props.binding.staticValueJson
    : '',
)
const staticNumber = computed(() =>
  typeof props.binding.staticValueJson === 'number'
    ? props.binding.staticValueJson
    : undefined,
)
const staticBoolean = computed(() => props.binding.staticValueJson === true)

const computeInputs = computed<readonly string[]>(
  () => props.binding.computeJson?.inputs ?? [],
)
const computeOp = computed<string>(() => props.binding.computeJson?.op ?? 'sum')

const window = computed(() => props.binding.detailJson?.range.lastWindow ?? '')

function writeStatic(value: unknown): void {
  emit('write', { ...props.binding, staticValueJson: value })
}

function writeOp(raw: string): void {
  const op = COMPUTE_OPS.find((item) => item === raw)
  if (op === undefined) return
  emit('write', {
    ...props.binding,
    computeJson: { op, inputs: [...computeInputs.value] },
  })
}

function toggleInput(key: string, on: boolean): void {
  const next = on
    ? [...computeInputs.value, key]
    : computeInputs.value.filter((item) => item !== key)
  const op: ComputeOp = props.binding.computeJson?.op ?? 'sum'
  emit('write', { ...props.binding, computeJson: { op, inputs: next } })
}

/** 点位历史那一支的取数说明；这条绑定不是那一支时给 null。 */
const archiveDetail = computed<ArchiveBindingDetail | null>(() => {
  const detail = props.binding.detailJson
  return detail !== null && 'nodeKey' in detail ? detail : null
})

/** 点位历史那一支的点位身份；这条绑定不是那一支时给空串。 */
const archiveNodeKey = computed(() => archiveDetail.value?.nodeKey ?? '')

/** 桶宽下拉当前选中的那一档；没配过就是自动档。 */
const bucketValue = computed(
  () => archiveDetail.value?.interval ?? TREND_BUCKET_AUTO,
)

/**
 * 当前相对窗下的桶宽档位。
 * ⚠ 够不着的那几档禁掉而不是藏掉：藏掉会让人以为只看得到这么细，而实际上
 * 把相对窗缩小一点就选得上了。
 */
const bucketOptions = computed<DtSelectOption[]>(() =>
  trendBucketChoices(windowToMs(window.value)).map((one) => ({
    value: one.value,
    label: one.label,
    disabled: one.isTooFine,
  })),
)

/** 聚合下拉当前选中的那一档；空串即没配过、跟服务端缺省走。 */
const aggregateValue = computed(() => archiveDetail.value?.aggregate ?? '')

/** 台账那一支的列身份；这条绑定不是那一支时给空串。 */
const datasetKey = computed(() => {
  const detail = props.binding.detailJson
  return detail !== null && 'datasetKey' in detail ? detail.datasetKey : ''
})

function writeWindow(text: string): void {
  const range = { lastWindow: text }
  // ⚠ 按当前来源写回对应的那一支，绝不「保留原样只换 range」：换过来源之后
  // 原来那一支的身份串还躺在 detailJson 里，原样带过去就是拿点位身份当台账
  // 列身份用，取数永远落空而界面上什么都看不出来
  if (props.binding.sourceKind === 'dataset') {
    emit('write', {
      ...props.binding,
      detailJson: { datasetKey: datasetKey.value, range },
    })
    return
  }
  writeArchive(
    range,
    archiveDetail.value?.interval,
    archiveDetail.value?.aggregate,
  )
}

/**
 * 写回点位历史那一支。分桶口径逐项带上，缺席的键一个都不写。
 * ⚠ 换一项要把另外几项一起带回去：漏了的表现是「改一下相对窗，桶宽和聚合档
 * 自己变回默认」——存得下、没有报错，只是曲线安静地换了口径。
 * @param range 时间范围
 * @param interval 桶宽，自动档给 undefined
 * @param aggregate 聚合档位，跟服务端缺省走时给 undefined
 */
function writeArchive(
  range: HistoryTimeRange,
  interval: string | undefined,
  aggregate: CollectAggregate | undefined,
): void {
  const detailJson: ArchiveBindingDetail = {
    nodeKey: archiveNodeKey.value || (props.binding.nodeKey ?? ''),
    range,
  }
  if (interval !== undefined) detailJson.interval = interval
  if (aggregate !== undefined) detailJson.aggregate = aggregate
  const timezone = archiveDetail.value?.timezone
  if (timezone !== undefined) detailJson.timezone = timezone
  emit('write', { ...props.binding, detailJson })
}

/**
 * 换桶宽。
 * ⚠ 自动档写成「没有这个键」而不是存一个 `auto` 进去：档位口径以后变了，
 * 存下来的那个字面量会把这条绑定永久钉在旧口径上。
 * @param raw 下拉选中的档
 */
function writeInterval(raw: string): void {
  const detail = archiveDetail.value
  const interval = raw === TREND_BUCKET_AUTO ? undefined : raw
  writeArchive(detail?.range ?? {}, interval, detail?.aggregate)
}

/**
 * 换聚合档位。认不出的取值按「跟服务端缺省走」处理，不硬喂给接口换一个 422。
 * @param raw 下拉选中的档
 */
function writeAggregate(raw: string): void {
  const detail = archiveDetail.value
  const aggregate = COLLECT_AGGREGATES.find((one) => one === raw)
  writeArchive(detail?.range ?? {}, detail?.interval, aggregate)
}

/** 挑好台账列之后写回身份串，时间窗保持不变。 */
function writeDatasetKey(key: string): void {
  emit('write', {
    ...props.binding,
    // 时间窗留空时不写这个字段，而不是写一个 undefined 进去：
    // 后端收到的是一个「配过但没值」的 range，与「没配过」不是一回事
    detailJson: {
      datasetKey: key,
      range: window.value === '' ? {} : { lastWindow: window.value },
    },
  })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <template v-if="binding.sourceKind === 'opcua'">
      <PointRefField :node-key="binding.nodeKey ?? ''" @pick="emit('pick')" />
    </template>

    <template v-else-if="binding.sourceKind === 'static'">
      <DtNumberInput
        v-if="spec.dataType === 'number'"
        :model-value="staticNumber"
        size="sm"
        @update:model-value="writeStatic($event ?? null)"
      />
      <DtSwitch
        v-else-if="spec.dataType === 'boolean'"
        :model-value="staticBoolean"
        size="sm"
        :aria-label="spec.label"
        @update:model-value="writeStatic($event)"
      />
      <DtInput
        v-else
        :model-value="staticText"
        size="sm"
        placeholder="常量值"
        @update:model-value="writeStatic($event)"
      />
    </template>

    <template v-else-if="binding.sourceKind === 'computed'">
      <DtField label="运算" size="sm">
        <DtSelect
          :model-value="computeOp"
          :options="OP_OPTIONS"
          size="sm"
          aria-label="运算"
          @update:model-value="writeOp"
        />
      </DtField>
      <DtCheckbox
        v-for="key in siblingKeys"
        :key="key"
        :model-value="computeInputs.includes(key)"
        :label="key"
        size="sm"
        @update:model-value="toggleInput(key, $event)"
      />
    </template>

    <template v-else-if="binding.sourceKind === 'archive'">
      <PointRefField :node-key="archiveNodeKey" @pick="emit('pick')" />
      <DtField label="相对窗（如 1h / 7d）" size="sm">
        <DtInput
          :model-value="window"
          size="sm"
          placeholder="1h"
          @update:model-value="writeWindow"
        />
      </DtField>
      <DtField label="取点间隔" size="sm">
        <DtSelect
          :model-value="bucketValue"
          :options="bucketOptions"
          size="sm"
          aria-label="取点间隔"
          @update:model-value="writeInterval"
        />
      </DtField>
      <DtField label="折算" size="sm">
        <DtSelect
          :model-value="aggregateValue"
          :options="AGGREGATE_OPTIONS"
          size="sm"
          aria-label="折算"
          @update:model-value="writeAggregate"
        />
      </DtField>
    </template>

    <template v-else-if="binding.sourceKind === 'dataset'">
      <DatasetRefField :dataset-key="datasetKey" @pick="writeDatasetKey" />
      <DtField label="相对窗（如 1h / 7d）" size="sm">
        <DtInput
          :model-value="window"
          size="sm"
          placeholder="1h"
          @update:model-value="writeWindow"
        />
      </DtField>
    </template>

    <DtNotice v-else intent="danger" icon="alert-triangle">
      没有认出的绑定来源「{{ binding.sourceKind }}」，这条绑定填不了。
    </DtNotice>
  </div>
</template>
