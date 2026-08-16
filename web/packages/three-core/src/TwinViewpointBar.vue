<script setup lang="ts">
/**
 * @fileoverview 运行态的视点切换控件：按钮排一行，或收成一个下拉。
 * ⚠ 与漫游控件一样要吃指针事件，所以只占右上角一小块——铺满的话
 * OrbitControls 就收不到拖拽了。
 */
import type { TwinCamera, TwinViewpointMode } from '@dt/twin-config'
import { DtButton, DtSelect } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  items: readonly TwinCamera[]
  /** 当前停在哪个视点；空串 = 还没切过。 */
  activeId: string
  mode: TwinViewpointMode
  /** 开着时按钮上提示对应的数字键。 */
  keyboard: boolean
}>()

const emit = defineEmits<{ pick: [string] }>()

/** 视点没起名时按序号叫，总比一个空按钮强。 */
function labelOf(camera: TwinCamera, index: number): string {
  return camera.name === '' ? `视点 ${index + 1}` : camera.name
}

const options = computed(() =>
  props.items.map((camera, index) => ({
    value: camera.id,
    label: `${index + 1}. ${labelOf(camera, index)}`,
  })),
)

/** 下拉必须有个选中值，没切过时落在第一个上——空值会显示成一行空白。 */
const selected = computed(() => props.activeId || (props.items[0]?.id ?? ''))

const MAX_DIGIT_SHORTCUT = 9

function hintOf(index: number): string | undefined {
  if (!props.keyboard || index >= MAX_DIGIT_SHORTCUT) return undefined
  return `数字键 ${index + 1}`
}
</script>

<template>
  <div class="twin-viewpoints" data-test="twin-viewpoint-bar">
    <DtSelect
      v-if="mode === 'dropdown'"
      :model-value="selected"
      :options="options"
      aria-label="视点切换"
      size="sm"
      @update:model-value="emit('pick', $event)"
    />
    <DtButton
      v-for="(camera, index) in items"
      v-else
      :key="camera.id"
      :variant="camera.id === activeId ? 'solid' : 'soft'"
      intent="neutral"
      size="sm"
      block
      :title="hintOf(index)"
      class="twin-viewpoints__btn"
      @click="emit('pick', camera.id)"
    >
      <span class="twin-viewpoints__index">{{ index + 1 }}</span>
      <span class="twin-viewpoints__name">{{ labelOf(camera, index) }}</span>
    </DtButton>
  </div>
</template>

<style scoped lang="scss">
.twin-viewpoints {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: stretch;
  max-width: 12rem;

  // 外观交给 DtButton，这里只管内容的排布
  &__btn {
    justify-content: flex-start;
    gap: 6px;
  }

  &__index {
    flex: none;
    color: var(--text-disabled);
    font-variant-numeric: tabular-nums;
  }

  &__name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
</style>
