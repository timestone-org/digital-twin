<script setup lang="ts">
/**
 * @fileoverview 运行态场景工具条：搜索定位、截图、两点测量、颜色图例、剖切。
 *
 * ⚠ 要吃指针事件，所以只占左上角一小块——铺满的话 OrbitControls 就收不到拖拽了。
 * ⚠ 收整个 `SceneTools` 而不是把八个字段摊成 prop：这个组件就是那个对象的视图，
 * 一一对应；摊开之后每加一件工具都要在两处各改一遍，漏一处不报错、只是不生效。
 */
import type { TwinClipAxis, TwinSearchHit } from '@dt/twin-config'
import { formatMeasureDistance } from '@dt/twin-config'
import { DtButton, DtInput, DtSelect, DtSlider } from '@dt/ui'
import { computed } from 'vue'

import type { SceneTools } from './useSceneTools'

const props = defineProps<{ tools: SceneTools }>()

const KIND_LABELS: Readonly<Record<TwinSearchHit['kind'], string>> = {
  part: '部件',
  hier: '层级',
  node: '节点',
}

const AXIS_OPTIONS = [
  { value: 'none', label: '不剖切' },
  { value: 'x', label: 'X 轴' },
  { value: 'y', label: 'Y 轴' },
  { value: 'z', label: 'Z 轴' },
] as const

/** 剖切位置是归一化的 [0,1]，步长取百分之一够用了。 */
const CLIP_RANGE = { min: 0, max: 1, step: 0.01 }

/** 截断了多少条没显示；0 = 全都列出来了。 */
const hidden = computed(() =>
  Math.max(0, props.tools.total.value - props.tools.hits.value.length),
)

const measureText = computed(() => {
  const value = props.tools.measured.value
  return Number.isFinite(value) ? formatMeasureDistance(value) : ''
})

/** 下拉给回来的是裸字符串，在这里收窄回联合类型；对不上就当没改。 */
function onAxis(next: string): void {
  const found = AXIS_OPTIONS.find((item) => item.value === next)
  if (found !== undefined)
    props.tools.clipAxis.value = found.value as TwinClipAxis
}
</script>

<template>
  <div class="twin-tools" data-test="twin-scene-tools">
    <div class="twin-tools__row">
      <DtInput
        :model-value="tools.query.value"
        type="search"
        size="sm"
        aria-label="场景内搜索"
        placeholder="搜部件 / 层级 / 节点"
        class="twin-tools__grow"
        @update:model-value="tools.query.value = $event"
      />
      <DtButton
        variant="soft"
        intent="neutral"
        size="sm"
        icon="download"
        aria-label="截图导出"
        title="导出当前画面为 PNG"
        @click="tools.screenshot()"
      />
      <DtButton
        :variant="tools.measuring.value ? 'solid' : 'soft'"
        intent="neutral"
        size="sm"
        icon="ruler"
        aria-label="两点测量"
        title="两点测量：点两下模型量直线距离；开着时不触发部件点击"
        @click="tools.toggleMeasure()"
      />
      <DtButton
        v-if="tools.legend.value.length > 0"
        :variant="tools.legendOpen.value ? 'solid' : 'soft'"
        intent="neutral"
        size="sm"
        icon="palette"
        aria-label="颜色图例"
        title="颜色图例：这些颜色分别代表什么"
        @click="tools.legendOpen.value = !tools.legendOpen.value"
      />
    </div>

    <div class="twin-tools__row">
      <DtSelect
        :model-value="tools.clipAxis.value"
        :options="AXIS_OPTIONS"
        aria-label="剖切轴"
        size="sm"
        class="twin-tools__grow"
        @update:model-value="onAxis"
      />
      <DtSlider
        v-if="tools.clipAxis.value !== 'none'"
        :model-value="tools.clipRatio.value"
        :range="CLIP_RANGE"
        label="剖切位置"
        size="sm"
        class="twin-tools__grow"
        @update:model-value="tools.clipRatio.value = $event"
      />
    </div>

    <p v-if="tools.measuring.value" class="twin-tools__hint text-xs">
      {{
        measureText === '' ? '点两下模型量直线距离' : `直线距离 ${measureText}`
      }}
    </p>

    <dl v-if="tools.legendOpen.value" class="twin-tools__legend">
      <div
        v-for="entry in tools.legend.value"
        :key="entry.label"
        class="twin-tools__legend-row"
      >
        <dt
          class="twin-tools__swatch"
          :style="{
            background:
              entry.token === null
                ? entry.color
                : `var(${entry.token}, ${entry.color})`,
          }"
        />
        <dd class="twin-tools__legend-label text-xs">{{ entry.label }}</dd>
      </div>
    </dl>

    <ul v-if="tools.hits.value.length > 0" class="twin-tools__list">
      <li v-for="hit in tools.hits.value" :key="`${hit.kind}:${hit.id}`">
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          block
          class="twin-tools__hit"
          @click="tools.locate(hit)"
        >
          <span class="twin-tools__kind">{{ KIND_LABELS[hit.kind] }}</span>
          <span class="twin-tools__label">{{ hit.label }}</span>
        </DtButton>
      </li>
      <li v-if="hidden > 0" class="twin-tools__more text-xs">
        还有 {{ hidden }} 条没显示，再输入几个字缩小范围
      </li>
    </ul>
  </div>
</template>

<style scoped lang="scss">
.twin-tools {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 15rem;

  &__row {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  &__grow {
    flex: 1;
    min-width: 0;
  }

  &__hint {
    margin: 0;
    padding: 2px 6px;
    color: var(--text-secondary);
    background: var(--surface-sunken);
    border-radius: var(--radius-md);
  }

  &__legend {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 4px 6px;
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
  }

  &__legend-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  &__swatch {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: var(--radius-sm);
  }

  &__legend-label {
    margin: 0;
    color: var(--text-secondary);
  }

  &__list {
    max-height: 14rem;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
  }

  &__hit {
    justify-content: flex-start;
    gap: 6px;
  }

  &__kind {
    flex: none;
    color: var(--text-disabled);
  }

  &__label {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__more {
    padding: 3px 6px;
    color: var(--text-disabled);
  }
}
</style>
