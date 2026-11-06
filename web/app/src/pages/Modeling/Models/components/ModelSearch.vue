<script setup lang="ts">
/** @fileoverview 模型版本与绑定列表的后端检索提交入口。 */
import { DtIconButton, DtInput } from '@dt/ui'
import { ref } from 'vue'

defineProps<{ label: string; disabled: boolean }>()
const emit = defineEmits<{ search: [query: string] }>()
const keyword = ref('')
</script>

<template>
  <form @submit.prevent="emit('search', keyword.trim())">
    <DtInput
      v-model="keyword"
      type="search"
      :aria-label="label"
      :maxlength="128"
      :disabled="disabled"
      size="sm"
      placeholder="输入关键词后搜索"
    >
      <template #actions
        ><DtIconButton
          icon="search"
          :label="label"
          :disabled="disabled"
          @click="emit('search', keyword.trim())"
      /></template>
    </DtInput>
  </form>
</template>
