<script setup lang="ts">
/**
 * @fileoverview 画布上的一个算子节点。
 *
 * ⚠ 每个端口一个**具名接点**：只有一对通用接点的话，多输入算子在界面上无从
 * 区分主表与副表，语义只能靠后端按边的落库顺序猜（MODELING_DESIGN D4）。
 * ⚠ 运行态四态**不进图数据**：它随每秒一次的轮询换新，混进节点数组会让拖拽
 * 中的位置被重建的数组盖回去。
 */
import type { ModelingGraphNode, ModelingOperator } from '@dt/contracts'
import { DtIcon, DtTag } from '@dt/ui'
import { computed } from 'vue'

import type { NodeRunState } from '../scripts/nodeState'
import { STATE_INTENTS, STATE_LABELS } from '../scripts/nodeState'
import {
  PORT_NAME_ATTR,
  PORT_NODE_ATTR,
  PORT_SIDE_ATTR,
} from '../scripts/portHits'

const props = defineProps<{
  node: ModelingGraphNode
  spec: ModelingOperator | undefined
  state: NodeRunState
  isSelected: boolean
  isReadonly: boolean
  errorText: string
  headline: string
  hasResult: boolean
  /** 正在拉线时，这张卡片上还接得住的那些口（`侧:口名`）。没在拉线时给 null。 */
  openPorts: ReadonlySet<string> | null
}>()

defineEmits<{
  openConfig: []
  openResult: []
}>()

const title = computed(
  () => props.node.alias || props.spec?.name || props.node.operator,
)
const inputs = computed(() => props.spec?.inputs ?? [])
const outputs = computed(() => props.spec?.outputs ?? [])

/** 接点在卡片侧边等距分布；只有一个时居中。 */
function offsetOf(index: number, total: number): string {
  return `${((index + 1) / (total + 1)) * 100}%`
}

/** 鼠标悬停在接点上时的说明。 */
function portHint(label: string, name: string, description: string): string {
  return `${label || name} —— ${description}`
}

/**
 * 拉线时这个口该显成什么样。
 *
 * ⚠ 不能只把不合法的口变灰了事：合法的那几个要**变大**，因为用户此刻正拖着
 * 指针在找落点，靠颜色分辨太慢。
 */
function portMood(side: 'in' | 'out', name: string): string {
  if (props.openPorts === null) return ''
  return props.openPorts.has(`${side}:${name}`)
    ? 'dt-ml-node__port--open'
    : 'dt-ml-node__port--shut'
}
</script>

<template>
  <div
    class="dt-ml-node"
    :class="[
      `dt-ml-node--${state}`,
      { 'dt-ml-node--selected': props.isSelected },
    ]"
    @dblclick="$emit('openConfig')"
  >
    <span
      v-for="(port, index) in inputs"
      :key="`in-${port.name}`"
      class="dt-ml-node__port dt-ml-node__port--in"
      :class="portMood('in', port.name)"
      :style="{ top: offsetOf(index, inputs.length) }"
      :title="portHint(port.label, port.name, port.description)"
      v-bind="{
        [PORT_NODE_ATTR]: props.node.id,
        [PORT_NAME_ATTR]: port.name,
        [PORT_SIDE_ATTR]: 'in',
      }"
    />
    <header class="dt-ml-node__head">
      <DtIcon :name="props.spec?.icon ?? 'workflow'" :size="14" />
      <span class="dt-ml-node__title">{{ title }}</span>
      <DtTag :intent="STATE_INTENTS[props.state]" size="sm">
        {{ STATE_LABELS[props.state] }}
      </DtTag>
    </header>
    <p v-if="props.errorText" class="dt-ml-node__error">
      {{ props.errorText }}
    </p>
    <p v-else-if="props.headline" class="dt-ml-node__headline">
      {{ props.headline }}
    </p>
    <footer class="dt-ml-node__actions">
      <button
        type="button"
        class="dt-ml-node__action"
        :disabled="props.isReadonly"
        @pointerdown.stop
        @dblclick.stop
        @click="$emit('openConfig')"
      >
        参数
      </button>
      <button
        v-if="props.hasResult"
        type="button"
        class="dt-ml-node__action"
        @pointerdown.stop
        @dblclick.stop
        @click="$emit('openResult')"
      >
        结果
      </button>
    </footer>
    <span
      v-for="(port, index) in outputs"
      :key="`out-${port.name}`"
      class="dt-ml-node__port dt-ml-node__port--out"
      :class="portMood('out', port.name)"
      :style="{ top: offsetOf(index, outputs.length) }"
      :title="portHint(port.label, port.name, port.description)"
      v-bind="{
        [PORT_NODE_ATTR]: props.node.id,
        [PORT_NAME_ATTR]: port.name,
        [PORT_SIDE_ATTR]: 'out',
      }"
    />
  </div>
</template>

<style scoped lang="scss">
.dt-ml-node {
  position: relative;
  width: 14rem;
  border: 2px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  box-shadow: 0 1px 3px rgb(var(--neutral-fg-rgb) / 0.14);

  &--selected {
    border-color: var(--accent-primary);
    box-shadow: var(--fx-shadow-menu);
  }

  &--running {
    border-color: var(--state-info);
  }

  &--succeeded {
    border-color: var(--state-success);
  }

  &--failed {
    border-color: var(--state-danger);
  }

  &--skipped {
    opacity: 0.6;
  }

  &__head {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  &__title {
    flex: 1;
    overflow: hidden;
    color: var(--text-primary);
    font-size: var(--ctl-fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__error {
    margin: 0;
    padding: 0.25rem 0.75rem;
    overflow: hidden;
    color: var(--state-danger);
    font-size: var(--ctl-hint-fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__headline {
    margin: 0;
    padding: 0.25rem 0.75rem;
    overflow: hidden;
    color: var(--text-secondary);
    font-family: var(--font-digit);
    font-size: var(--ctl-hint-fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__actions {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
  }

  &__action {
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    cursor: pointer;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  // ⚠ 接点要压在卡片之上：不给 z-index 的话它被卡片盖住，用户点不到
  &__port {
    position: absolute;
    z-index: 1;
    width: 0.625rem;
    height: 0.625rem;
    border: 2px solid var(--accent-primary);
    border-radius: var(--radius-pill);
    background: var(--surface-base);
    transform: translateY(-50%);
    cursor: crosshair;
    transition:
      transform 120ms ease,
      opacity 120ms ease;

    // ⚠ 命中区要比看得见的圆点大得多：10px 的靶子比光标热点大不了多少，
    // 十次里落空七次——那个表象与「连线根本用不了」无从区分
    &::after {
      position: absolute;
      inset: -0.5rem;
      content: '';
    }

    &--in {
      left: -0.375rem;
    }

    &--out {
      right: -0.375rem;
    }

    &:hover {
      transform: translateY(-50%) scale(1.4);
    }

    &--open {
      border-color: var(--state-success);
      background: var(--state-success);
      transform: translateY(-50%) scale(1.4);
    }

    &--shut {
      opacity: 0.25;
    }
  }
}
</style>
