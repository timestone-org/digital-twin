<script setup lang="ts">
/** @fileoverview 平台来源配置：显式字段，不收 URL 或凭据。 */
import { computed, ref, watch } from 'vue'
import { DtButton, DtCheckbox, DtInput, DtNotice } from '@dt/ui'
import type { PlatformSourceConfig } from '@/api/knowledge'
import { isCursorPlatformPath } from '../scripts/sourcePath'

const props = defineProps<{ isBusy: boolean }>()
const emit = defineEmits<{
  submit: [name: string, config: PlatformSourceConfig]
  dirty: [value: boolean]
}>()
const name = ref('')
const path = ref('')
const idField = ref('row_id')
const titleField = ref('')
const pageParam = ref('page')
const sizeParam = ref('size')
const isAcknowledged = ref(false)
const isDirty = computed(
  () =>
    name.value !== '' ||
    path.value !== '' ||
    idField.value !== 'row_id' ||
    titleField.value !== '' ||
    pageParam.value !== 'page' ||
    sizeParam.value !== 'size' ||
    isAcknowledged.value,
)
watch(isDirty, (value) => emit('dirty', value), { immediate: true })
const config = computed<PlatformSourceConfig>(() => ({
  path: path.value.trim(),
  id_field: idField.value.trim(),
  title_field: titleField.value.trim(),
  page_param: pageParam.value.trim(),
  size_param: sizeParam.value.trim(),
}))
const pathError = computed(() =>
  isCursorPlatformPath(config.value.path)
    ? '目前只支持 page/size 页码集合，不能读取使用 after 游标的台账记录。'
    : path.value !== '' && !isPlatformPath(config.value.path)
      ? '填写 /api/v1/platform/ 开头的平台路径，不含域名、查询参数或片段。'
      : '',
)
const nameError = computed(() =>
  [...name.value.trim()].length > 120 ? '来源名称最多 120 个字符。' : '',
)
const isValid = computed(
  () =>
    name.value.trim().length > 0 &&
    nameError.value === '' &&
    isPlatformPath(config.value.path) &&
    !isCursorPlatformPath(config.value.path) &&
    config.value.id_field !== '' &&
    config.value.page_param !== '' &&
    config.value.size_param !== '' &&
    config.value.page_param !== config.value.size_param &&
    isAcknowledged.value,
)

function isPlatformPath(value: string): boolean {
  return (
    /^\/api\/v1\/platform\/[A-Za-z0-9/_-]+$/.test(value) &&
    !value.includes('//')
  )
}

function submit(): void {
  if (!isValid.value || props.isBusy) return
  emit('submit', name.value.trim(), config.value)
}
</script>

<template>
  <form class="flex flex-col gap-3" @submit.prevent="submit">
    <h3 class="text-sm font-medium text-text-title">添加平台来源</h3>
    <DtNotice intent="info"
      >使用当前账号读取平台，不保存凭据。添加后不会自动同步。仅支持 page/size
      页码集合，暂不支持 after 游标接口。</DtNotice
    >
    <DtInput
      v-model="name"
      name="source-name"
      label="来源名称"
      required
      :error="nameError"
      :disabled="isBusy"
    />
    <DtInput
      v-model="path"
      name="source-path"
      label="平台路径"
      required
      placeholder="/api/v1/platform/dataset-tables"
      hint="示例读取台账目录；行标识字段填 id，标题字段填 name。"
      :error="pathError"
      :disabled="isBusy"
    />
    <div class="grid grid-cols-2 gap-3">
      <DtInput
        v-model="idField"
        name="source-id-field"
        label="行标识字段"
        required
        :disabled="isBusy"
      />
      <DtInput
        v-model="titleField"
        name="source-title-field"
        label="标题字段"
        hint="留空则用行标识"
        :disabled="isBusy"
      />
      <DtInput
        v-model="pageParam"
        name="source-page-param"
        label="页码参数名"
        required
        :disabled="isBusy"
      />
      <DtInput
        v-model="sizeParam"
        name="source-size-param"
        label="每页条数参数名"
        required
        :disabled="isBusy"
      />
    </div>
    <DtNotice
      v-if="pageParam.trim() !== '' && pageParam.trim() === sizeParam.trim()"
      intent="warning"
      >页码和每页条数参数名不能相同。</DtNotice
    >
    <DtCheckbox
      v-model="isAcknowledged"
      label="我确认这些资料可供拥有 knowledge:use 的用户检索"
      :disabled="isBusy"
    />
    <DtButton :disabled="!isValid || isBusy" :loading="isBusy" @click="submit"
      >添加来源</DtButton
    >
  </form>
</template>
