<script setup lang="ts">
/**
 * @fileoverview 从 CSV 批量导入点位：下模板 → 选文件 → 预检 → 逐批提交。
 *
 * 预检的三类问题分开讲（见 `useCsvPreflight`）；这里只管把它们摆出来。
 *
 * ⚠ 提交按批走，且失败按批列出来：后端一批 200 条且整批原子，前面几批已经
 * 进库了——只说「失败」会让用户以为一条都没进，然后重导一次撞一堆 409。
 */
import { computed, ref, watch } from 'vue'
import type { DtTableColumn } from '@dt/contracts'
import { COLLECT_POINT_BATCH_MAX } from '@dt/contracts'
import {
  DtButton,
  DtFilePicker,
  DtModal,
  DtNotice,
  DtProgress,
  DtSwitch,
  DtTable,
  DtTag,
  DtIconButton,
} from '@dt/ui'

import { downloadCsv } from '@/utils/downloadJson'
import { CSV_COLUMNS, templateCsv } from '../scripts/pointCsv'
import { importCsvPoints, type CsvImportOutcome } from '../scripts/pointImport'
import { useCsvPreflight } from '../scripts/useCsvPreflight'

const props = defineProps<{
  modelValue: boolean
  sourceId: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  imported: []
}>()

const ERROR_COLUMNS: readonly DtTableColumn[] = [
  { key: 'line', label: '行', width: '5rem' },
  { key: 'error', label: '问题' },
]

const REQUIRED_LABELS = CSV_COLUMNS.filter((column) => column.required)
  .map((column) => column.label)
  .join('、')

const {
  fileName,
  parsed,
  scanError,
  isSkippingExisting,
  isScanning,
  goodCount,
  errorRows,
  duplicated,
  conflicting,
  submittable,
  isBlocked,
  reset,
  take,
  cancel,
} = useCsvPreflight()

const busy = ref(false)
const progress = ref({ done: 0, total: 0 })
const outcome = ref<CsvImportOutcome | null>(null)

watch(
  () => [props.modelValue, props.sourceId] as const,
  ([open]) => {
    if (!open) {
      cancel()
      return
    }
    outcome.value = null
    progress.value = { done: 0, total: 0 }
    void reset(props.sourceId)
  },
)

const batchCount = computed(() =>
  Math.ceil(submittable.value.length / COLLECT_POINT_BATCH_MAX),
)

const percent = computed(() =>
  progress.value.total === 0
    ? 0
    : Math.round((progress.value.done / progress.value.total) * 100),
)

async function onSelect(files: File[]): Promise<void> {
  const file = files[0]
  if (file === undefined) return
  outcome.value = null
  await take(file)
}

function downloadTemplate(): void {
  downloadCsv(templateCsv(), '点位导入模板')
}

async function submit(): Promise<void> {
  const items = submittable.value
  if (
    busy.value ||
    isScanning.value ||
    scanError.value ||
    isBlocked.value ||
    items.length === 0
  )
    return
  busy.value = true
  progress.value = { done: 0, total: items.length }
  try {
    outcome.value = await importCsvPoints(
      props.sourceId,
      items,
      (next) => (progress.value = next),
      isSkippingExisting.value,
    )
    if (outcome.value.created > 0 || outcome.value.updated > 0) emit('imported')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    title="批量导入点位"
    width="46rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <DtIconButton
          variant="outline"
          size="sm"
          intent="neutral"
          icon="download"
          label="下载导入模板"
          @click="downloadTemplate"
        />
        <DtFilePicker
          accept=".csv,text/csv"
          label="选择 CSV 文件"
          size="sm"
          :disabled="busy"
          @select="onSelect"
        />
        <DtTag v-if="fileName" mono size="sm">{{ fileName }}</DtTag>
      </div>

      <p class="m-0 text-xs text-text-secondary">
        模板是带 BOM 的 UTF-8 CSV，Excel 双击即可打开；改完仍另存为 CSV。
        必填列：{{ REQUIRED_LABELS }}；新增点位还需名称和寻址串。
        同一数据源下编码相同的点位会更新已填写的信息，留空保留原值；0
        和“否”正常更新。
      </p>

      <DtNotice v-if="scanError" intent="warning" icon="alert-triangle">
        取不到已有点位（{{
          scanError
        }}），暂无法完成导入预检，请重新打开弹窗重试。
      </DtNotice>

      <DtNotice v-if="parsed?.fatal" intent="danger" icon="alert-circle">
        {{ parsed.fatal }}
      </DtNotice>

      <template v-if="parsed && !parsed.fatal">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <DtTag intent="success">可导入 {{ goodCount }} 行</DtTag>
          <DtTag v-if="errorRows.length > 0" intent="danger">
            读不了 {{ errorRows.length }} 行
          </DtTag>
          <DtTag v-if="conflicting.length > 0" intent="warning">
            编码已存在 {{ conflicting.length }} 个
          </DtTag>
          <DtTag v-if="duplicated.length > 0" intent="danger">
            文件内重复 {{ duplicated.length }} 个
          </DtTag>
        </div>

        <DtNotice v-if="isBlocked" intent="danger" icon="alert-triangle">
          文件里有重复的点位编码（{{ duplicated.slice(0, 5).join('、')
          }}{{
            duplicated.length > 5 ? ' 等' : ''
          }}）。同一个数据源下编码必须唯一，请先在文件里改掉再导入。
        </DtNotice>

        <DtSwitch
          v-if="conflicting.length > 0"
          v-model="isSkippingExisting"
          label="跳过库里已存在的编码"
          :disabled="busy"
        />
        <DtNotice
          v-if="conflicting.length > 0 && !isSkippingExisting"
          intent="warning"
          icon="alert-triangle"
        >
          将按编码更新 {{ conflicting.length }} 个已有点位，空白字段保留原值。
          点位编码、历史记录和已有绑定保持不变。
        </DtNotice>

        <div v-if="errorRows.length > 0" class="max-h-48 overflow-auto">
          <DtTable
            :columns="ERROR_COLUMNS"
            :rows="errorRows"
            caption="读不了的行"
          >
            <template #cell-line="{ row }">第 {{ row.line }} 行</template>
            <template #cell-error="{ row }">{{ row.error }}</template>
          </DtTable>
        </div>
      </template>

      <template v-if="busy || outcome">
        <DtProgress :value="percent" show-label />
        <p class="m-0 text-xs text-text-secondary">
          已提交 {{ progress.done }} / {{ progress.total }} 条
        </p>
      </template>

      <template v-if="outcome">
        <DtNotice
          :intent="outcome.failures.length > 0 ? 'warning' : 'success'"
          icon="check"
        >
          已新增 {{ outcome.created }} 个点位，更新
          {{ outcome.updated }} 个，未改动 {{ outcome.unchanged }} 个。
          <template v-if="outcome.unverified > 0">
            其中 {{ outcome.unverified }} 条寻址串没有被现场确认过（采集侧当时
            没有活会话或超时），它们会照常下发，但是否真读得到要看运行态。
          </template>
        </DtNotice>
        <DtNotice
          v-for="failure in outcome.failures"
          :key="failure.batch"
          intent="danger"
          icon="alert-circle"
        >
          第 {{ failure.batch }} 批（{{ failure.codes.slice(0, 3).join('、')
          }}{{ failure.codes.length > 3 ? ' 等' : '' }}）未保存：{{
            failure.message
          }}
        </DtNotice>
      </template>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="emit('update:modelValue', false)">
        {{ outcome ? '关闭' : '取消' }}
      </DtButton>
      <DtButton
        :disabled="
          isBlocked || isScanning || !!scanError || submittable.length === 0
        "
        :loading="busy"
        @click="submit"
      >
        导入 {{ submittable.length }} 个点位{{
          batchCount > 1 ? `（分 ${batchCount} 批）` : ''
        }}
      </DtButton>
    </template>
  </DtModal>
</template>
