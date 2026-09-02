<script setup lang="ts">
/**
 * @fileoverview 左栏：对话清单与新建。
 *
 * ⚠ 没标题的对话显示建立时刻而不是空白：标题由首轮摘要出来，摘不出就一直
 * 是空串，一排空白行谁也分不清哪个是哪个。
 */
import { ref } from 'vue'
import type { KnowledgeChatSession } from '@dt/contracts'
import { DtButton, DtEmpty, DtInput } from '@dt/ui'

import { formatMinuteStamp } from '@/utils/datetime'

const props = defineProps<{
  sessions: readonly KnowledgeChatSession[]
  selectedId: string | null
  isBusy: boolean
}>()

const emit = defineEmits<{
  select: [sessionId: string]
  create: []
  rename: [sessionId: string, title: string]
  archive: [sessionId: string]
  remove: [sessionId: string]
}>()

/** 正在改名的那一条与它的草稿。 */
const editingId = ref<string | null>(null)
const draft = ref('')

function labelOf(one: KnowledgeChatSession): string {
  if (one.title !== '') return one.title
  return `未命名 · ${formatMinuteStamp(one.created_at)}`
}

function startRename(one: KnowledgeChatSession): void {
  editingId.value = one.id
  draft.value = one.title
}

function commitRename(): void {
  const id = editingId.value
  if (id !== null) emit('rename', id, draft.value)
  editingId.value = null
}
</script>

<template>
  <aside class="flex w-64 shrink-0 flex-col gap-3">
    <DtButton size="sm" :disabled="props.isBusy" @click="emit('create')">
      新对话
    </DtButton>

    <DtEmpty v-if="props.sessions.length === 0" inline title="还没有对话" />

    <ul v-else class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      <li v-for="one in props.sessions" :key="one.id" class="group">
        <DtInput
          v-if="editingId === one.id"
          v-model="draft"
          size="sm"
          aria-label="对话标题"
          @keyup.enter="commitRename"
          @keyup.esc="editingId = null"
          @blur="commitRename"
        />
        <div
          v-else
          class="flex items-center gap-1 rounded"
          :class="
            one.id === props.selectedId
              ? 'bg-surface-raised text-accent-on-surface'
              : 'text-text-secondary hover:bg-surface-raised'
          "
        >
          <button
            type="button"
            class="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
            :title="labelOf(one)"
            @click="emit('select', one.id)"
            @dblclick="startRename(one)"
          >
            {{ labelOf(one) }}
          </button>
          <div class="hidden shrink-0 gap-0.5 pr-1 group-hover:flex">
            <DtButton
              variant="ghost"
              size="xs"
              icon="pencil"
              aria-label="改名"
              title="改名"
              @click="startRename(one)"
            />
            <DtButton
              variant="ghost"
              size="xs"
              icon="folder"
              aria-label="归档"
              title="归档（不删历史）"
              @click="emit('archive', one.id)"
            />
            <DtButton
              variant="ghost"
              size="xs"
              icon="trash"
              intent="danger"
              aria-label="删除"
              title="删除"
              @click="emit('remove', one.id)"
            />
          </div>
        </div>
      </li>
    </ul>
  </aside>
</template>
