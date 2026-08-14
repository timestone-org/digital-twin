<script setup lang="ts">
/**
 * @fileoverview twin-view 的渲染壳：把配置归一成 TwinConfig、把数组绑定按文档序
 * 缝回场景，再交给 3D 宿主。
 * ⚠ three 只能异步进：静态 import 会把整个 three 焊进任何引用本模块的入口静态图，
 * 不开孪生的大屏也要为它付首屏包体（DASHBOARD_DESIGN §5.4）。
 */
import type { ModuleMeta } from '@dt/contracts'
import {
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_CONFIG_KEY,
  TWIN_TINT_BINDING_KEY,
  isTintAlarm,
  normalizeTwinConfig,
  stitchAnchorValues,
  stitchTintValues,
} from '@dt/twin-config'
import { DtNotice } from '@dt/ui'
import { computed, defineAsyncComponent } from 'vue'

import { readBoolean, readText } from '../../shared/config'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const TwinScene = defineAsyncComponent(async () => {
  const core = await import('@dt/three-core')
  return core.TwinScene
})

// ⚠ TwinScene 按引用比对这份配置，所以只能是 normalizeTwinConfig 的输出本身：
// 就地改字段不会重绘，而 computed 只在 config 换了对象时才产出新引用
const scene = computed(() => normalizeTwinConfig(props.config[TWIN_CONFIG_KEY]))
const title = computed(() => readText(props.config.title))
const isAlarmSummaryShown = computed(() =>
  readBoolean(props.config.showAlarmSummary),
)

const tintValues = computed(() =>
  stitchTintValues(scene.value.tints, props.values[TWIN_TINT_BINDING_KEY]),
)
const anchorValues = computed(() =>
  stitchAnchorValues(
    scene.value.anchors,
    props.values[TWIN_ANCHOR_BINDING_KEY],
  ),
)

const alarms = computed(() =>
  scene.value.tints.filter((rule) =>
    isTintAlarm(rule, tintValues.value[rule.id]),
  ),
)

// 取不到就说取不到：绝不留一块什么都不说的空画布（DASHBOARD_DESIGN §4.3）
const errorMessage = computed(() =>
  props.meta?.status === 'error'
    ? (props.meta.errorMessage ?? '孪生数据取不到')
    : '',
)
</script>

<template>
  <div class="dt-twin">
    <TwinScene
      :config="scene"
      :tint-values="tintValues"
      :anchor-values="anchorValues"
    />
    <p v-if="title !== ''" class="dt-twin__title">{{ title }}</p>
    <ul
      v-if="isAlarmSummaryShown && alarms.length > 0"
      class="dt-twin__alarms"
      aria-label="告警汇总"
    >
      <li v-for="rule in alarms" :key="rule.id" class="dt-twin__alarm">
        {{ rule.name }}
      </li>
    </ul>
    <DtNotice v-if="errorMessage !== ''" class="dt-twin__error" intent="danger">
      {{ errorMessage }}
    </DtNotice>
  </div>
</template>

<style scoped lang="scss">
.dt-twin {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.dt-twin__title {
  position: absolute;
  top: 12px;
  left: 16px;
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 16px;
  letter-spacing: 0.06em;
  text-shadow: var(--fx-glow-title);
}

.dt-twin__alarms {
  position: absolute;
  top: 12px;
  right: 16px;
  display: flex;
  max-width: 40%;
  flex-direction: column;
  padding: 6px 10px;
  border: 1px solid var(--state-danger);
  border-radius: var(--radius-sm);
  margin: 0;
  background: var(--surface-overlay);
  gap: 4px;
  list-style: none;
}

.dt-twin__alarm {
  color: var(--state-danger);
  font-size: 12px;
  line-height: 1.6;
}

.dt-twin__error {
  position: absolute;
  right: 16px;
  bottom: 12px;
  left: 16px;
}
</style>
