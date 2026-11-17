<script setup lang="ts">
/** @fileoverview 离线地图的 SVG 展示与站点点击。 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed } from 'vue'
import ModulePanel from '../../shared/ModulePanel.vue'
import {
  readArray,
  readBoolean,
  readNumber,
  readRecord,
  readText,
} from '../../shared/config'
import china from './china.json'
import { project, regionViews } from './geometry'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()
const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()
const title = computed(() => readText(props.config.title))
const regions = computed(() => regionViews(china, props.config))
const highlight = computed(() => readText(props.config.highlightRegion))
const capitals = computed(() => readBoolean(props.config.showCapitals, true))
const capitalLabels = computed(() =>
  readBoolean(props.config.showCapitalLabel, true),
)
const markers = computed(() =>
  readArray(props.config.markers).map((raw) => {
    const item = readRecord(raw)
    const lng = readNumber(item.lng, 115.81)
    const lat = readNumber(item.lat, 32.89)
    const label = readText(item.label, '站点')
    return {
      label,
      key: `${label}:${lng}:${lat}`,
      ...project(lng, lat, props.config),
    }
  }),
)
function pick(value: string): void {
  emit('interaction', { event: 'click', value })
}
</script>
<template>
  <ModulePanel :title="title">
    <svg
      class="geo-map"
      viewBox="0 0 1000 660"
      role="img"
      aria-label="中国省级地图与工厂位置"
    >
      <g v-for="region in regions" :key="region.key">
        <path
          :d="region.path"
          :class="{ 'geo-map__highlight': region.name === highlight }"
        >
          <title>{{ region.name }}</title>
        </path>
        <circle
          v-if="capitals && region.center"
          :cx="region.center.x"
          :cy="region.center.y"
          r="2"
        />
        <text
          v-if="capitalLabels && region.center"
          :x="region.center.x + 4"
          :y="region.center.y - 5"
          class="geo-map__label"
        >
          {{ region.name }}
        </text>
      </g>
      <g
        v-for="marker in markers"
        :key="marker.key"
        class="geo-map__marker"
        role="button"
        tabindex="0"
        :aria-label="marker.label"
        @click.stop="pick(marker.label)"
        @keydown.enter.stop="pick(marker.label)"
        @keydown.space.stop.prevent="pick(marker.label)"
      >
        <circle :cx="marker.x" :cy="marker.y" r="15" opacity="0.2" />
        <circle :cx="marker.x" :cy="marker.y" r="5" />
        <text :x="marker.x + 12" :y="marker.y - 12">{{ marker.label }}</text>
      </g>
    </svg>
  </ModulePanel>
</template>
<style scoped lang="scss">
.geo-map {
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: var(--accent-primary);
}
path {
  fill: var(--surface-raised);
  stroke: var(--accent-primary);
  stroke-width: 0.6;
  vector-effect: non-scaling-stroke;
}
path.geo-map__highlight {
  fill: color-mix(in srgb, var(--accent-primary) 38%, var(--surface-base));
  stroke-width: 1.3;
}
circle {
  fill: currentColor;
}
text {
  fill: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 12px;
}
.geo-map__label {
  fill: var(--text-secondary);
  font-size: 9px;
}
.geo-map__marker {
  cursor: pointer;
  color: var(--state-warning);
}
.geo-map__marker text {
  fill: currentColor;
  font-size: 14px;
  font-weight: 600;
}
</style>
