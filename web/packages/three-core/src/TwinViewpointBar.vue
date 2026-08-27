<script setup lang="ts">
/**
 * @fileoverview 运行态的视点切换控件：一块悬浮面板列出全部视点，或收成一个下拉。
 *
 * ⚠ 与漫游控件一样要吃指针事件，所以只占右上角一小块——铺满的话
 * OrbitControls 就收不到拖拽了。
 * ⚠ 行不用 DtButton：序号要自成一格（挤在一起时「1动力中心」会读成一个词），
 * 而按钮只有一个内容槽，塞两格进去就得从外面改写它的排布。
 */
import type { TwinCamera, TwinViewpointMode } from '@dt/twin-config'
import { DtSelect } from '@dt/ui'
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

function hasShortcut(index: number): boolean {
  return props.keyboard && index < MAX_DIGIT_SHORTCUT
}

/**
 * 悬停提示：名字 + 可用的数字键。
 * ⚠ 名字必须进来：窄面板上长名字会截断，而截掉的那半没有别的地方读得到。
 */
function titleOf(camera: TwinCamera, index: number): string {
  const name = labelOf(camera, index)
  return hasShortcut(index) ? `${name}（数字键 ${index + 1}）` : name
}

/** 快捷键给读屏用；序号那一格就是它的可见形态。 */
function shortcutOf(index: number): string | undefined {
  return hasShortcut(index) ? String(index + 1) : undefined
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
    <div v-else class="twin-viewpoints__panel">
      <p class="twin-viewpoints__caption">视点</p>
      <button
        v-for="(camera, index) in items"
        :key="camera.id"
        type="button"
        class="twin-viewpoints__btn"
        :class="{ 'twin-viewpoints__btn--now': camera.id === activeId }"
        :aria-pressed="camera.id === activeId"
        :aria-keyshortcuts="shortcutOf(index)"
        :title="titleOf(camera, index)"
        @click="emit('pick', camera.id)"
      >
        <span class="twin-viewpoints__index">{{ index + 1 }}</span>
        <span class="twin-viewpoints__name">{{ labelOf(camera, index) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.twin-viewpoints {
  position: absolute;
  top: 12px;
  right: 12px;
  max-width: 13rem;

  // 悬浮面板：与详情卡片同一套底 / 描边 / 投影，3D 上面不另起一种观感
  &__panel {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    box-shadow: var(--fx-shadow-modal);
    // 3D 画面直接压在面板底下，只靠半透明底的话文字会糊在模型的高光上
    backdrop-filter: blur(6px);
  }

  &__caption {
    margin: 0;
    padding: 2px 6px 3px;
    color: var(--text-secondary);
    font-family: var(--font-display);
    font-size: 10px;
    line-height: 1;
    letter-spacing: 0.12em;
  }

  &__btn {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 3px 8px 3px 3px;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: var(--ctl-fs-sm);
    line-height: 1;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      background-color 0.18s ease,
      border-color 0.18s ease,
      color 0.18s ease;

    // ⚠ 悬停只抬底不描边：描边是「当前视点」的专用标记，两处都有就分不出
    // 哪一个才是镜头停着的那个
    &:hover {
      color: var(--text-primary);
      background: var(--surface-raised);
    }

    // 焦点环与 @dt/ui 的控件同一个配方；包不许深链它的内部 mixin，故照抄取值
    &:focus-visible {
      outline: 2px solid rgba(var(--accent-primary-rgb), 0.6);
      outline-offset: 2px;
    }
  }

  // 当前视点：实心序号 + 高亮名字，一眼看出镜头停在哪
  &__btn--now {
    color: var(--text-title);
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent-primary) 55%, transparent);

    .twin-viewpoints__index {
      // ⚠ 实心强调底上的字色只能用这一档：本调色板的强调色是高亮霓虹，
      // 白字压上去只有 2:1 上下
      color: var(--text-on-emphasis);
      background: var(--accent-primary);
      box-shadow: 0 0 8px
        color-mix(in srgb, var(--accent-primary) 45%, transparent);
    }

    .twin-viewpoints__name {
      text-shadow: 0 0 8px var(--fx-glow-title);
    }
  }

  // 序号自成一格：与名字挤在一起时「1动力中心」会读成一个词
  &__index {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--accent-on-surface);
    font-family: var(--font-display);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
    border-radius: var(--radius-sm);
  }

  &__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
</style>
