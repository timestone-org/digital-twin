<script setup lang="ts">
/** @fileoverview 已部署模型的后端关键词检索与启停状态筛选。 */
import { DtIconButton, DtInput, DtSelect } from '@dt/ui'
import { ref } from 'vue'

defineProps<{ status: string; disabled: boolean }>()
const emit = defineEmits<{ search: [query: string]; status: [value: string] }>()
const keyword = ref('')
const statuses = [
  { value: 'all', label: '全部状态' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已停用' },
]
</script>

<template>
  <form
    class="flex flex-wrap items-center gap-3"
    @submit.prevent="emit('search', keyword.trim())"
  >
    <DtInput
      v-model="keyword"
      class="w-72 max-w-full"
      type="search"
      aria-label="搜索已发布模型"
      :maxlength="128"
      :disabled="disabled"
      size="sm"
      placeholder="服务、模型或工作流名称与编码"
    >
      <template #actions
        ><DtIconButton
          icon="search"
          label="搜索已发布模型"
          :disabled="disabled"
          @click="emit('search', keyword.trim())"
      /></template>
    </DtInput>
    <DtSelect
      :model-value="status"
      aria-label="服务状态"
      :options="statuses"
      :display="{ searchable: false }"
      :disabled="disabled"
      size="sm"
      @update:model-value="emit('status', $event)"
    />
  </form>
</template>
