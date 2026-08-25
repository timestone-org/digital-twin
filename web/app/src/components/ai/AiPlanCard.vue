<script setup lang="ts">
/**
 * @fileoverview 助手的执行计划清单：逐项打勾直到全部完成（ADR-0024）。
 *
 * ⚠ 快照整份来、整份换，这里**不做增量合并**——合并要 id 对齐，而计划事件
 * 的契约就是「来一份盖一份」。
 *
 * ⚠ 完结的计划仍然摆着（收进折叠头），不闪退：用户要能回头看这次做了哪几步。
 */
import { computed, ref } from 'vue'
import type { AssistantPlan, AssistantPlanStatus } from '@dt/contracts'
import { DtIcon, DtSpinner } from '@dt/ui'
import type { IconName } from '@dt/ui'

const props = defineProps<{ plan: AssistantPlan }>()

const collapsed = ref(false)

const doneCount = computed(
  () =>
    props.plan.items.filter(
      (item) => item.status !== 'pending' && item.status !== 'in_progress',
    ).length,
)

const title = computed(() =>
  props.plan.title === '' ? '执行计划' : props.plan.title,
)

/** 终态项的收尾图标；进行中与待办不走图标（各自是转圈与空环）。 */
function iconOf(status: AssistantPlanStatus): IconName | null {
  if (status === 'done') return 'check'
  if (status === 'skipped') return 'minus'
  if (status === 'failed') return 'alert-circle'
  return null
}
</script>

<template>
  <section class="ai-plan" aria-label="执行计划">
    <button
      type="button"
      class="ai-plan__head"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <DtIcon name="list-checks" :size="14" class="ai-plan__badge" />
      <span class="ai-plan__title">{{ title }}</span>
      <span class="ai-plan__count">
        {{ doneCount }}/{{ plan.items.length }}
      </span>
      <DtIcon
        :name="collapsed ? 'chevron-down' : 'chevron-up'"
        :size="14"
        class="ai-plan__fold"
      />
    </button>
    <ul v-if="!collapsed" class="ai-plan__items">
      <li
        v-for="(item, index) in plan.items"
        :key="`${index}:${item.title}`"
        class="ai-plan__item"
        :class="`ai-plan__item--${item.status}`"
      >
        <span class="ai-plan__mark">
          <DtSpinner
            v-if="item.status === 'in_progress'"
            :size="12"
            label="正在做这一项"
          />
          <DtIcon
            v-else-if="iconOf(item.status) !== null"
            :name="iconOf(item.status) ?? 'check'"
            :size="12"
          />
          <span v-else class="ai-plan__ring" aria-hidden="true" />
        </span>
        <span class="ai-plan__text">{{ item.title }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped lang="scss">
.ai-plan {
  margin: 0.5rem 0.75rem 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.ai-plan__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.375rem 0.625rem;
  border: none;
  background: transparent;
  color: var(--text-title);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}

.ai-plan__badge {
  flex: none;
  color: var(--accent-primary);
}

.ai-plan__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-plan__count {
  flex: none;
  color: var(--text-secondary);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.ai-plan__fold {
  flex: none;
  color: var(--text-secondary);
}

.ai-plan__items {
  margin: 0;
  padding: 0 0.625rem 0.5rem;
  list-style: none;
}

.ai-plan__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.1875rem 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.ai-plan__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 0.875rem;
  height: 0.875rem;
}

.ai-plan__ring {
  width: 0.625rem;
  height: 0.625rem;
  border: 1.5px solid var(--border-strong, var(--border-default));
  border-radius: 50%;
}

.ai-plan__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.ai-plan__item--done .ai-plan__mark {
  color: var(--state-success);
}

.ai-plan__item--done .ai-plan__text {
  text-decoration: line-through;
  opacity: 0.7;
}

.ai-plan__item--in_progress .ai-plan__text {
  color: var(--text-title);
}

.ai-plan__item--failed .ai-plan__mark,
.ai-plan__item--failed .ai-plan__text {
  color: var(--state-danger);
}

.ai-plan__item--skipped .ai-plan__text {
  text-decoration: line-through;
  opacity: 0.5;
}
</style>
