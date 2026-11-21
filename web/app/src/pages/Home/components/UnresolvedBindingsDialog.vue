<script setup lang="ts">
/**
 * @fileoverview 导入或模板实例化后仍需处理的点位和派生绑定。
 *
 * ⚠ 这些绑定**已经入库**，不是被丢掉了：不逐条列出来，用户会以为导进来的是一张
 * 能用的屏，直到上线那天才发现这几个位置永远不产数据。
 */
import { DtButton, DtModal, DtNotice, DtTag } from '@dt/ui'
import type { ComputedBindingWarning, UnresolvedBinding } from '@dt/contracts'

defineProps<{
  open: boolean
  count: number
  computedWarnings?: readonly ComputedBindingWarning[] | undefined
  list: readonly UnresolvedBinding[]
  dashboardName?: string | undefined
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  preview: []
  dismiss: []
}>()
</script>

<template>
  <DtModal
    :model-value="open"
    :title="
      computedWarnings?.length
        ? '已创建，部分绑定需要检查'
        : '已创建，但有绑定没接上'
    "
    :description="dashboardName"
    width="40rem"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtNotice v-if="count > 0" intent="warning" icon="alert-triangle">
        有 {{ count }} 条绑定指向本部署不存在的点位。绑定按原样保留了，
        但这些位置在屏上不会有数据，要到编辑器里重新挑点位。
      </DtNotice>

      <div v-if="list.length > 0" class="dt-unresolved">
        <div
          v-for="item in list"
          :key="`${item.nodeKey}|${item.fieldKey}`"
          class="dt-unresolved__row"
        >
          <DtTag size="sm" intent="warning">{{ item.sourceKind }}</DtTag>
          <span class="text-text-secondary">{{ item.fieldKey }}</span>
          <span class="dt-unresolved__key" :title="item.nodeKey">
            {{ item.nodeKey }}
          </span>
          <span class="dt-unresolved__why">{{ item.reason }}</span>
        </div>
      </div>
      <DtNotice
        v-if="computedWarnings?.length"
        intent="warning"
        icon="alert-triangle"
      >
        派生绑定已按原样保留。可在大屏编辑器中修正下列运算规格。
      </DtNotice>
      <ul v-if="computedWarnings?.length" class="dt-unresolved">
        <li
          v-for="item in computedWarnings"
          :key="`${item.nodeClientKey}|${item.fieldKey}|${item.field}|${item.reason}`"
          class="dt-unresolved__computed"
        >
          <span
            >{{ item.moduleType }} · {{ item.nodeClientKey }} ·
            {{ item.fieldKey }}</span
          >
          <span class="dt-unresolved__why"
            >{{ item.field }} · {{ item.message }}</span
          >
        </li>
      </ul>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="emit('dismiss')"> 留在此页 </DtButton>
      <DtButton icon="play" @click="emit('preview')"> 去预览 </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-unresolved {
  max-height: 16rem;
  overflow-y: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);

  &__row {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 12px;

    &:last-child {
      border-bottom: 0;
    }
  }

  &__key {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-disabled);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__computed {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  &__why {
    color: var(--state-warning);
  }
}
</style>
