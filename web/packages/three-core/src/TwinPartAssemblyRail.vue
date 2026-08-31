<script setup lang="ts">
/**
 * @fileoverview 装配栏：父件详情弹窗左边那一列，把这台设备拆开的样子摊出来，
 * 点哪一行右边就换成谁的读数。
 *
 * ⚠ 连接轨伸进每一行的那一小段横线用**这个部件此刻的状态色**：层级与状态合用
 * 同一个装置，不再另加一排圆点。没配染色的给发丝色，那是「没取数」不是「正常」。
 * ⚠ 行的次序就是 `partAssembly` 给的文档序，这里只画不排：它与绑点面板上数的
 * 行号是同一个，重排一次就没人对得上了。
 */
import type { TwinAssemblyNode, TwinPartValues } from '@dt/twin-config'
import { computed, type CSSProperties } from 'vue'

import { partToneCss } from './partToneCss'

const props = defineProps<{
  /** 装配清单，第一项是打开的那个部件自己。 */
  nodes: readonly TwinAssemblyNode[]
  /** 现在看的是哪个部件。 */
  currentId: string
  /** 部件状态染色那一路实时值，连接轨据它上色。 */
  values: TwinPartValues
}>()

const emit = defineEmits<{ select: [partId: string] }>()

/** 一行左边的一格连接轨。 */
interface RailGuide {
  key: string
  /** 末端那一格：伸出横 tick。 */
  tip: boolean
  /** 同层最后一个：竖线收成半截，轨道到此为止。 */
  last: boolean
  style: CSSProperties
}

interface RailRow {
  id: string
  label: string
  /** 打开的那个部件自己，字重与菱标都与后代不同。 */
  root: boolean
  guides: RailGuide[]
}

function guidesOf(node: TwinAssemblyNode, tone: string): RailGuide[] {
  // 顶层也摆一格：它的菱标要与后代的 tick 对齐，少一格就整列错开
  const count = Math.max(node.depth, 1)
  return Array.from({ length: count }, (_, index) => {
    const tip = index === count - 1
    return {
      key: `${node.part.id}:${index}`,
      tip,
      last: tip && node.isLast && node.depth > 0,
      style: tip && tone !== '' ? { '--tone': tone } : {},
    }
  })
}

const rows = computed<RailRow[]>(() =>
  props.nodes.map((node) => ({
    id: node.part.id,
    label: node.part.name === '' ? node.part.id : node.part.name,
    root: node.depth === 0,
    guides: guidesOf(node, partToneCss(node.part, props.values)),
  })),
)
</script>

<template>
  <nav class="twin-assembly" aria-label="装配">
    <p class="twin-assembly__cap">
      装配<span class="twin-assembly__count">{{ rows.length }} 件</span>
    </p>
    <ul class="twin-assembly__list">
      <li v-for="row in rows" :key="row.id">
        <button
          type="button"
          class="twin-assembly__row"
          :class="{
            'is-root': row.root,
            'is-active': row.id === currentId,
          }"
          :aria-current="row.id === currentId ? 'true' : undefined"
          :data-test="`assembly-row-${row.id}`"
          @click="emit('select', row.id)"
        >
          <span
            v-for="guide in row.guides"
            :key="guide.key"
            class="twin-assembly__guide"
            :class="{
              'is-root': row.root,
              'is-tip': guide.tip && !row.root,
              'is-last': guide.last,
            }"
            :style="guide.style"
            aria-hidden="true"
          />
          <span class="twin-assembly__name">{{ row.label }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped lang="scss">
.twin-assembly {
  display: flex;
  flex-direction: column;
  min-width: 0;

  &__cap {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin: 0;
    padding: 0 0 8px 2px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--tp-accent);
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.2em;
  }

  &__count {
    color: var(--text-disabled);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }

  &__list {
    display: flex;
    flex-direction: column;
    margin: 6px 0 0;
    padding: 0;
    max-height: var(--tp-stage-height, 260px);
    overflow-y: auto;
    list-style: none;
    scrollbar-width: thin;
  }

  &__row {
    position: relative;
    display: flex;
    align-items: stretch;
    width: 100%;
    padding: 0 8px 0 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 12.5px;
    line-height: 1.4;
    text-align: left;
    cursor: pointer;

    &:hover {
      background: var(--surface-raised);
      color: var(--text-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--tp-accent);
      outline-offset: -2px;
    }

    &.is-active {
      background: color-mix(in srgb, var(--tp-accent) 12%, transparent);
      color: var(--text-primary);

      &::before {
        content: '';
        position: absolute;
        inset: 3px auto 3px 0;
        width: 2px;
        background: var(--tp-accent);
      }
    }
  }

  // 连接轨：每层一格，格子里一条发丝竖线；末端那一格伸出横 tick，
  // tick 的颜色就是这个部件此刻的状态色
  &__guide {
    position: relative;
    flex: none;
    width: 14px;

    &::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 6px;
      width: 1px;
      background: var(--border-default);
    }

    &.is-tip::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 6px;
      width: 7px;
      height: 1px;
      background: var(--tone, var(--border-hover));
    }

    &.is-last::before {
      bottom: 50%;
    }

    // 顶层没有上一级可连，只留一枚菱标
    &.is-root::before {
      display: none;
    }

    &.is-root::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 4px;
      width: 7px;
      height: 7px;
      border-radius: 2px;
      background: var(--tone, var(--border-hover));
      transform: translateY(-50%) rotate(45deg);
    }
  }

  &__name {
    flex: 1 1 auto;
    min-width: 0;
    padding: 7px 0 7px 6px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__row.is-root &__name {
    color: var(--text-title);
    font-family: var(--font-display);
    font-weight: 600;
  }
}
</style>
