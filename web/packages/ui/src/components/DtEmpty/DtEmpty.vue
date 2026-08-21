<script setup lang="ts">
/**
 * @fileoverview DtEmpty —— 空态。空列表必须有明确的空态，否则用户分不清
 * 「没有数据」与「还没加载出来」。block 是居中卡片档，inline 是单行行内档。
 */
import { computed } from 'vue'
import DtIcon from '../DtIcon/DtIcon.vue'

const props = withDefaults(
  defineProps<{
    icon?: string | undefined
    title?: string | undefined
    hint?: string | undefined
    /** inline：单行行内空态，无大内边距；icon 仅显式传入时渲染（12px）。 */
    size?: 'block' | 'inline'
  }>(),
  {
    title: '暂无数据',
    size: 'block',
  },
)

const isInline = computed(() => props.size === 'inline')
/** block 档缺省给警示图标；inline 档不传就不渲染图标。 */
const iconName = computed(
  () => props.icon ?? (isInline.value ? undefined : 'alert-circle'),
)
const iconPx = computed(() => (isInline.value ? 12 : 26))
</script>

<template>
  <div class="dt-empty" :class="{ 'dt-empty--inline': isInline }">
    <DtIcon
      v-if="iconName"
      :name="iconName"
      :size="iconPx"
      class="dt-empty__icon"
    />
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

  &--inline {
    flex-direction: row;
    gap: 6px;
    padding: 0;
    text-align: left;

    .dt-empty__title {
      font-size: 12px;
    }
  }
}
</style>
