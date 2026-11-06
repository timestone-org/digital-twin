<script setup lang="ts">
/** @fileoverview 从响应样例为列表型接口生成逐项映射列。 */
import { ref } from 'vue'
import { DtButton, DtNotice, DtTextarea } from '@dt/ui'
import { columnsFromSample, type ApiColumn } from '../scripts/apiSourceForm'

const SAMPLE_HINT = '["1.2", "2026年11月", "增长"]'
const props = defineProps<{ columns: readonly ApiColumn[] }>()
const emit = defineEmits<{ parsed: [columns: ApiColumn[]] }>()
const sample = ref('')
const error = ref('')
function parse(): void {
  error.value = ''
  try {
    emit('parsed', columnsFromSample(sample.value, props.columns))
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '响应样例解析失败'
  }
}
</script>
<template>
  <div class="flex flex-col gap-3 rounded border border-border-subtle p-3">
    <DtTextarea
      v-model="sample"
      label="响应样例"
      :rows="4"
      mono
      :placeholder="SAMPLE_HINT"
      hint="粘贴数据位置指向的列表，每一项生成一个字段，再改成业务名称"
    />
    <DtNotice v-if="error" intent="warning">{{ error }}</DtNotice>
    <DtButton size="sm" variant="outline" icon="list-checks" @click="parse">
      按样例生成字段
    </DtButton>
  </div>
</template>
