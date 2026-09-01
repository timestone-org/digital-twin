<script setup lang="ts">
/**
 * @fileoverview 左栏：知识库清单与新建。
 *
 * ⚠ 每一行显示嵌入档：`null` 是「这个库还没建索引」，而不是「模型名忘填了」。
 * 不显示的话，用户会对着一个永远搜不到东西的库反复上传。
 */
import { ref } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtEmpty, DtInput } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import type { KnowledgeBase } from '@/api/knowledge'

const props = defineProps<{
  bases: readonly KnowledgeBase[]
  selectedId: string
}>()

const emit = defineEmits<{
  select: [baseId: string]
  create: [name: string]
  drop: [baseId: string]
}>()

const draft = ref('')

function submit(): void {
  const name = draft.value.trim()
  if (name === '') return
  emit('create', name)
  draft.value = ''
}
</script>

<template>
  <aside class="flex w-64 shrink-0 flex-col gap-3">
    <PermGuard :codes="[PERMISSION_CODES.knowledgeManage]">
      <div class="flex gap-2">
        <DtInput
          v-model="draft"
          size="sm"
          placeholder="新建知识库"
          aria-label="新建知识库的名字"
          @keyup.enter="submit"
        />
        <DtButton size="sm" :disabled="draft.trim() === ''" @click="submit">
          建
        </DtButton>
      </div>
    </PermGuard>

    <DtEmpty v-if="props.bases.length === 0" inline title="还没有知识库" />

    <ul v-else class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      <li v-for="one in props.bases" :key="one.id">
        <button
          type="button"
          class="w-full rounded px-3 py-2 text-left"
          :class="
            one.id === props.selectedId
              ? 'bg-surface-raised text-accent-on-surface'
              : 'text-text-secondary hover:bg-surface-raised'
          "
          @click="emit('select', one.id)"
        >
          <span class="block truncate text-sm">{{ one.name }}</span>
          <span class="block truncate text-xs text-text-secondary">
            {{ one.documentCount }} 份文档 ·
            {{ one.embeddingModel === null ? '未建索引' : one.embeddingModel }}
          </span>
        </button>
      </li>
    </ul>
  </aside>
</template>
