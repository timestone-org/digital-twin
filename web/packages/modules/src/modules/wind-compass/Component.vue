<script setup lang="ts">
/** @fileoverview 八方位 SVG 罗盘与独立状态读数。 */
import type { ModuleMeta } from '@dt/contracts'
import { computed } from 'vue'

import { readNumber, readText } from '../../shared/config'
import ModulePanel from '../../shared/ModulePanel.vue'
import { directionLabel, normalizeDirection, windReading } from './readings'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const marks = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'].map(
  (label, index) => ({
    label,
    angle: index * 45,
    x: 100 + Math.sin((index * Math.PI) / 4) * 88,
    y: 100 - Math.cos((index * Math.PI) / 4) * 88,
  }),
)
const title = computed(() => readText(props.config.title))
const readings = computed(() => {
  const slots = props.meta?.slots
  const hasSlots = slots !== undefined
  return {
    direction: windReading(
      props.values.direction,
      slots?.direction,
      hasSlots,
      0,
    ),
    speed: windReading(props.values.speed, slots?.speed, hasSlots, 1),
    temperature: windReading(
      props.values.temperature,
      slots?.temperature,
      hasSlots,
      1,
    ),
  }
})
const angle = computed(() => normalizeDirection(readings.value.direction.value))
const label = computed(() => directionLabel(angle.value))
const pointer = computed(() => `rotate(${angle.value ?? 0} 100 100)`)
const style = computed(() => ({
  '--wind-accent': readText(props.config.accent, 'var(--accent-primary)'),
  '--wind-value-size': `${readNumber(props.config.valueSize, 22)}px`,
}))
const cells = computed(() => [
  { key: 'speed', label: '风速', unit: 'm/s', ...readings.value.speed },
  {
    key: 'direction',
    label: `风向 · ${label.value}`,
    unit: '°',
    ...readings.value.direction,
    text:
      angle.value === null
        ? readings.value.direction.text
        : String(Math.round(angle.value) % 360),
  },
  {
    key: 'temperature',
    label: '气温',
    unit: '°C',
    ...readings.value.temperature,
  },
])
</script>

<template>
  <ModulePanel :title="title">
    <div class="wind" :style="style">
      <svg
        class="wind__dial"
        viewBox="0 0 200 200"
        role="img"
        :aria-label="`风向：${label}`"
      >
        <circle cx="100" cy="100" r="78" class="wind__ring" />
        <circle cx="100" cy="100" r="68" class="wind__ring" />
        <circle cx="100" cy="100" r="58" class="wind__ticks" />
        <g v-for="mark in marks" :key="mark.label">
          <path d="M100 22V34" :transform="`rotate(${mark.angle} 100 100)`" />
          <text
            :x="mark.x"
            :y="mark.y"
            dominant-baseline="middle"
            text-anchor="middle"
          >
            {{ mark.label }}
          </text>
        </g>
        <g
          v-if="angle !== null"
          data-testid="wind-pointer"
          :transform="pointer"
        >
          <path d="M100 49L88 78H96V100H104V78H112Z" class="wind__needle" />
          <path d="M100 143L93 130L100 104L107 130Z" class="wind__tail" />
          <circle cx="100" cy="100" r="7" class="wind__needle" />
        </g>
        <text v-else x="100" y="100" text-anchor="middle">—</text>
      </svg>
      <div class="wind__readings">
        <div
          v-for="cell in cells"
          :key="cell.key"
          class="wind__cell"
          :title="cell.reason"
        >
          <span class="wind__label">{{ cell.label }}</span>
          <strong>{{ cell.text }}</strong>
          <small v-if="cell.value !== null"> {{ cell.unit }}</small>
          <small v-if="cell.isStale">数据已陈旧</small>
        </div>
      </div>
    </div>
  </ModulePanel>
</template>

<style scoped lang="scss">
.wind {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--wind-accent);
  &__dial {
    flex: 1;
    min-height: 0;
    width: 100%;
    max-height: 100%;
    overflow: visible;
  }
  svg {
    fill: none;
    stroke: currentColor;
  }
  text {
    fill: currentColor;
    stroke: none;
    font-size: 11px;
  }
  &__ring {
    opacity: 0.4;
  }
  &__ticks {
    stroke-width: 4;
    stroke-dasharray: 0.8 3;
    opacity: 0.35;
  }
  &__needle {
    fill: currentColor;
    stroke: none;
  }
  &__tail {
    fill: var(--text-secondary);
    stroke: none;
  }
  &__readings {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    width: 100%;
    padding: 8px 0;
    border-top: 1px solid var(--border-subtle);
  }
  &__cell {
    text-align: center;
    min-width: 0;
  }
  &__cell + &__cell {
    border-left: 1px solid var(--border-subtle);
  }
  &__label {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  strong {
    font-family: var(--font-digit);
    font-size: var(--wind-value-size);
    font-weight: 400;
  }
  small {
    font-size: 11px;
    color: var(--text-secondary);
  }
  strong {
    font-family: var(--font-digit);
    font-size: var(--wind-value-size);
    font-weight: 400;
  }
  small {
    color: var(--text-secondary);
    font-size: 11px;
  }
}
</style>
