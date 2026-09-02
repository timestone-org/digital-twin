<script setup lang="ts">
/**
 * @fileoverview 左栏里的单个对话条目：选中态、显示名与时刻、行内的改名 / 归档 / 删除。
 *
 * ⚠ 动作组用 opacity 藏而不是 hidden：hidden 的按钮 Tab 不进去，键盘用户
 * 永远够不着归档与删除。
 */
import { computed, nextTick, ref } from 'vue'
import type { KnowledgeChatSession } from '@dt/contracts'
import { DtButton, DtIcon, DtInput } from '@dt/ui'

import { formatMinuteStamp } from '@/utils/datetime'
import { sessionLabel } from '../scripts/sessionLabel'

const props = defineProps<{
  session: KnowledgeChatSession
  active: boolean
}>()

const emit = defineEmits<{
  select: []
  rename: [title: string]
  archive: []
  remove: []
}>()

const label = computed(() => sessionLabel(props.session))
const stamp = computed(() => formatMinuteStamp(props.session.updated_at))

/** 正在行内改名，以及它的草稿。 */
const editing = ref(false)
const draft = ref('')

/** DtInput 暴露出来的那一格；结构类型而不是 InstanceType，同 AiComposer。 */
const box = ref<{ inputEl: HTMLInputElement | null } | null>(null)

function startRename(): void {
  draft.value = props.session.title
  editing.value = true
  void nextTick(() => box.value?.inputEl?.focus())
}

/** Enter 与失焦都提交；Esc 取消之后紧跟的那次失焦不再提交。 */
function commitRename(): void {
  if (!editing.value) return
  editing.value = false
  emit('rename', draft.value)
}

function cancelRename(): void {
  editing.value = false
}
</script>

<template>
  <li class="group">
    <DtInput
      v-if="editing"
      ref="box"
      v-model="draft"
      size="sm"
      aria-label="对话标题"
      @enter="commitRename"
      @keyup.esc="cancelRename"
      @blur="commitRename"
    />
    <div
      v-else
      class="relative flex items-center gap-1 rounded-md border pr-1 transition-colors"
      :class="
        active
          ? 'border-accent-primary/50 bg-accent-primary/10'
          : 'border-border-subtle bg-surface-sunken/40 hover:border-border-default hover:bg-accent-primary/5'
      "
    >
      <span
        v-if="active"
        class="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-accent-primary"
      />
      <button
        type="button"
        class="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left"
        :title="label"
        :aria-current="active ? 'true' : undefined"
        @click="emit('select')"
        @dblclick="startRename"
      >
        <span class="flex w-full items-center gap-2">
          <DtIcon
            name="sparkles"
            :size="15"
            :class="active ? 'text-accent-primary' : 'text-text-secondary'"
          />
          <span
            class="min-w-0 flex-1 truncate text-sm font-medium"
            :class="active ? 'text-text-title' : 'text-text-primary'"
          >
            {{ label }}
          </span>
        </span>
        <span class="text-xs text-text-secondary">{{ stamp }}</span>
      </button>
      <div
        class="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <DtButton
          variant="ghost"
          size="xs"
          icon="pencil"
          aria-label="改名"
          title="改名"
          @click="startRename"
        />
        <DtButton
          variant="ghost"
          size="xs"
          icon="folder"
          aria-label="归档"
          title="归档（不删历史）"
          @click="emit('archive')"
        />
        <DtButton
          variant="ghost"
          size="xs"
          icon="trash"
          intent="danger"
          aria-label="删除"
          title="删除"
          @click="emit('remove')"
        />
      </div>
    </div>
  </li>
</template>
