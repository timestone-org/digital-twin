<script setup lang="ts">
/** @fileoverview 批量编辑先预览差异，再逐条保存并列出失败项。 */
import { computed, ref } from 'vue'
import type { CollectPoint } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtInput,
  DtModal,
  DtNotice,
  DtSelect,
} from '@dt/ui'
import {
  BATCH_FIELDS,
  previewPointEdits,
  type PointEditPreview,
} from '../scripts/batchPointEdit'
import { useBatchPointEdit } from '../scripts/useBatchPointEdit'

const props = defineProps<{ points: readonly CollectPoint[] }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const field = ref('unit')
const value = ref('')
const preview = ref<PointEditPreview[] | null>(null)
const error = ref('')
const submitted = ref(false)
const batch = useBatchPointEdit()
const rows = computed(() =>
  submitted.value ? batch.failures.value : (preview.value ?? []),
)
const columns = [
  { key: 'name', label: '点位' },
  { key: 'before', label: '修改前' },
  { key: 'after', label: '修改后' },
]
function prepare(): void {
  error.value = ''
  try {
    preview.value = previewPointEdits(props.points, field.value, value.value)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '输入无效'
  }
}
async function save(): Promise<void> {
  const items = submitted.value ? [...batch.failures.value] : preview.value
  if (items === null || items.length === 0) return
  await batch.save(items)
  submitted.value = true
  emit('saved')
}
</script>
<template>
  <DtModal
    :model-value="true"
    title="批量编辑点位"
    width="55rem"
    :close-on-backdrop="!batch.busy.value"
    @update:model-value="!batch.busy.value && emit('close')"
  >
    <div class="flex flex-col gap-3">
      <div v-if="!submitted" class="flex flex-wrap items-end gap-3">
        <DtSelect
          v-model="field"
          :options="BATCH_FIELDS"
          label="修改字段"
          :disabled="batch.busy.value"
          @update:model-value="preview = null"
        />
        <DtInput
          v-model="value"
          label="新值"
          :disabled="batch.busy.value"
          @update:model-value="preview = null"
        />
        <DtButton
          variant="outline"
          :disabled="batch.busy.value"
          @click="prepare"
          >预览修改</DtButton
        >
      </div>
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
      <DtNotice
        v-if="submitted"
        :intent="batch.failures.value.length ? 'warning' : 'success'"
      >
        已处理 {{ batch.completed.value }} 项，失败
        {{ batch.failures.value.length }} 项。成功项不会重复提交。
      </DtNotice>
      <DtNotice v-if="preview?.length === 0 && !submitted" intent="info"
        >没有需要修改的点位。</DtNotice
      >
      <DtDataView
        v-if="rows.length"
        view="table"
        :rows="rows"
        :columns="columns"
        :layout="{ toggle: false, minWidth: '36rem', fill: false }"
        class="max-h-80 overflow-auto"
      >
        <template #cell-before="{ row }">{{ row.before || '未设置' }}</template>
        <template #cell-after="{ row }">{{ row.after || '清空' }}</template>
        <template #cell-name="{ row }"
          ><span>{{ row.name }}</span>
          <p v-if="'error' in row" class="text-state-danger">
            {{ row.error }}
          </p></template
        >
      </DtDataView>
      <p v-if="batch.busy.value" class="text-sm">
        已处理 {{ batch.completed.value }} 项，请等待本批完成。
      </p>
    </div>
    <template #footer>
      <DtButton
        variant="ghost"
        :disabled="batch.busy.value"
        @click="emit('close')"
        >关闭</DtButton
      >
      <DtButton
        :loading="batch.busy.value"
        :disabled="rows.length === 0"
        @click="save"
        >{{ submitted ? '重试失败项' : '保存以上修改' }}</DtButton
      >
    </template>
  </DtModal>
</template>
