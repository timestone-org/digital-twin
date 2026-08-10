<script setup lang="ts">
/**
 * @fileoverview DtEmpty —— 空态。空列表必须有明确的空态，否则用户分不清
 * 「没有数据」与「还没加载出来」。
 */
import DtIcon from '../DtIcon/DtIcon.vue'

const props = withDefaults(
  defineProps<{
    icon?: string | undefined
    title?: string | undefined
    hint?: string | undefined
  }>(),
  {
    icon: 'alert-circle',
    title: '暂无数据',
  },
)
</script>

<template>
  <div class="dt-empty">
    <DtIcon :name="props.icon" :size="26" class="dt-empty__icon" />
    <p class="dt-empty__title">{{ props.title }}</p>
    <p v-if="props.hint" class="dt-empty__hint">{{ props.hint }}</p>
    <slot />
  </div>
</template>

<style scoped lang="scss">
.dt-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
  text-align: center;

  &__icon {
    color: var(--text-disabled);
  }

  &__title {
    margin: 0;
    font-size: 14px;
    color: var(--text-secondary);
  }

  &__hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-disabled);
  }
}
</style>
