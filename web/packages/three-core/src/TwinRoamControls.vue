<script setup lang="ts">
/**
 * @fileoverview 运行态的漫游播放控件：上一段 / 播放暂停 / 下一段。
 * ⚠ 只有这一条浮层是要吃指针事件的（其余浮层一律 `pointer-events: none`），
 * 所以它自己占一小块，不铺满画布——铺满的话 OrbitControls 就收不到拖拽了。
 */
import { DtButton } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{ playing: boolean }>()

const emit = defineEmits<{ toggle: []; next: []; prev: [] }>()

const toggleLabel = computed(() => (props.playing ? '暂停漫游' : '播放漫游'))
</script>

<template>
  <div class="twin-roam" data-test="twin-roam-controls">
    <DtButton
      variant="ghost"
      size="sm"
      icon="chevron-left"
      aria-label="上一段漫游"
      @click="emit('prev')"
    />
    <DtButton variant="soft" size="sm" @click="emit('toggle')">
      {{ toggleLabel }}
    </DtButton>
    <DtButton
      variant="ghost"
      size="sm"
      icon="chevron-right"
      aria-label="下一段漫游"
      @click="emit('next')"
    />
  </div>
</template>

<style scoped lang="scss">
.twin-roam {
  position: absolute;
  bottom: 12px;
  left: 50%;
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 4px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  transform: translateX(-50%);
}
</style>
