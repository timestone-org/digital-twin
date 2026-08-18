<script setup lang="ts">
/**
 * @fileoverview 快捷键帮助弹窗：只负责排版，清单本身在 `../shortcuts`。
 * ⚠ 修饰键按平台变形，判定串拼上 userAgent——`navigator.platform` 在部分
 * 浏览器已废弃，取不到时按非 Mac 显示 Ctrl。
 */
import { DtModal } from '@dt/ui'
import { computed } from 'vue'

import { modLabel, shortcutGroups } from '../scripts/shortcuts'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const groups = computed(() => {
  const platform =
    typeof navigator === 'undefined'
      ? ''
      : `${navigator.platform} ${navigator.userAgent}`
  return shortcutGroups(modLabel(platform))
})
</script>

<template>
  <DtModal
    :model-value="props.open"
    title="快捷键"
    width="44rem"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="dt-shortcuts">
      <section v-for="group in groups" :key="group.title" data-test="sc-group">
        <h3 class="dt-shortcuts__title text-2xs">{{ group.title }}</h3>
        <div
          v-for="item in group.items"
          :key="item.keys"
          class="dt-shortcuts__row text-sm"
        >
          <kbd class="dt-shortcuts__keys text-2xs">{{ item.keys }}</kbd>
          <span class="min-w-0 text-text-secondary">{{ item.desc }}</span>
        </div>
      </section>
    </div>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-shortcuts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 18px 24px;

  &__title {
    margin: 0 0 6px;
    color: var(--accent-primary);
    font-weight: 600;
  }

  &__row {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 3px 0;
  }

  &__keys {
    flex: none;
    min-width: 6rem;
    padding: 2px 7px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font-family: inherit;
    text-align: center;
  }
}
</style>
