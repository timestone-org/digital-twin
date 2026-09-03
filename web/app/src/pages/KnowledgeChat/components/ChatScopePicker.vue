<script setup lang="ts">
/**
 * @fileoverview 输入框上方的检索范围选择器：默认「全部知识库」，可勾选几个库
 * （ADR-0044）。改了对这个会话后续都生效。
 *
 * ⚠ 「全部」只能由那一项**显式**选出来。取消最后一个勾不算全部——那样的话，
 * 用户清空了选择，检索却悄悄扩到了他刚排除掉的那些库，所以最后一个勾禁掉。
 *
 * ⚠ 已经被删掉的库照样列出来并标一句：从范围里抹掉等于替用户把边界改宽，
 * 而他从界面上看不出来。
 */
import { computed } from 'vue'
import type { KnowledgeChatScopeBase } from '@dt/contracts'
import { DtCheckbox, DtIcon, DtPopover, DtTag } from '@dt/ui'

import type { KnowledgeBase } from '@/api/knowledge'
import { idsOf, scopeLabel, toggled } from '../scripts/chatScope'

const props = defineProps<{
  /** 这个人看得见的库。取不到时只剩「全部」一项。 */
  bases: readonly KnowledgeBase[]
  /** 此刻的范围；null = 全部知识库。 */
  scope: readonly KnowledgeChatScopeBase[] | null
  /** 回合正跑着时不许改：改了这一轮已经发出去的工具还按旧范围跑。 */
  disabled: boolean
}>()

const emit = defineEmits<{ change: [ids: string[] | null] }>()

const label = computed(() => scopeLabel(props.scope))
const picked = computed(() => idsOf(props.scope))
/** 范围里那几个已经不在了的库，单独列在下面。 */
const missing = computed(() =>
  (props.scope ?? []).filter((one) => one.is_missing),
)
/** 只剩最后一个勾时不许再取消：不限库走「全部知识库」那一项。 */
const isLast = computed(() => picked.value?.length === 1)

function isPicked(baseId: string): boolean {
  return picked.value === null || picked.value.includes(baseId)
}

function toggle(baseId: string): void {
  if (props.disabled) return
  emit('change', toggled(props.scope, baseId, props.bases))
}
</script>

<template>
  <div class="chat-scope">
    <DtPopover side="top" align="start" :disabled="disabled">
      <template #default="{ toggle: open, isOpen, panelId }">
        <button
          type="button"
          class="chat-scope__trigger"
          :class="{ 'is-open': isOpen }"
          :disabled="disabled"
          aria-haspopup="dialog"
          :aria-expanded="isOpen"
          :aria-controls="panelId"
          :title="`这次对话只查：${label}`"
          @click="open"
        >
          <DtIcon name="layers" :size="14" />
          <span class="chat-scope__label">范围 · {{ label }}</span>
        </button>
      </template>

      <template #content>
        <div class="chat-scope__panel">
          <p class="chat-scope__head">这次对话去哪几个库找</p>

          <DtCheckbox
            :model-value="scope === null"
            :disabled="scope === null"
            label="全部知识库"
            @update:model-value="emit('change', null)"
          />

          <ul class="chat-scope__list">
            <li v-for="one in bases" :key="one.id">
              <DtCheckbox
                :model-value="isPicked(one.id)"
                :disabled="isLast && isPicked(one.id)"
                :label="one.name"
                @update:model-value="toggle(one.id)"
              />
            </li>
          </ul>

          <p v-if="bases.length === 0" class="chat-scope__empty">
            这套部署还没有知识库
          </p>

          <ul v-if="missing.length > 0" class="chat-scope__list">
            <li
              v-for="one in missing"
              :key="one.base_id"
              class="chat-scope__gone"
            >
              <span>{{ one.name || one.base_id }}</span>
              <DtTag intent="warning">已不存在</DtTag>
            </li>
          </ul>
        </div>
      </template>
    </DtPopover>
  </div>
</template>

<style scoped lang="scss">
.chat-scope {
  display: flex;
  padding-bottom: 0.375rem;
}

.chat-scope__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;

  &:hover:not(:disabled),
  &.is-open {
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.chat-scope__label {
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-scope__panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 14rem;
  /* 库多了也不许把面板顶穿视口，列表自己滚 */
  max-height: 18rem;
  overflow-y: auto;
}

.chat-scope__head {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.6875rem;
}

.chat-scope__list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chat-scope__empty {
  margin: 0;
  color: var(--text-disabled);
  font-size: 0.75rem;
}

.chat-scope__gone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  color: var(--text-disabled);
  font-size: 0.75rem;
}
</style>
