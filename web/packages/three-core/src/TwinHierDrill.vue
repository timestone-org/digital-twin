<script setup lang="ts">
/**
 * @fileoverview 层级钻取面板：面包屑往回走、点卡片往下钻、叶子层摊开全部字段。
 *
 * ⚠ 刻意**不是** DtModal：`hideChildList` 的那一层只能靠点 3D 上的部件钻进下一层，
 * 而模态会把画布整个盖住并锁焦点，那一层于是成了死路。所以它是钉在画布一侧的
 * 浮层，画布照常能转能点。
 * ⚠ 当前是哪一层由宿主持有（`nodeId` + `update:nodeId`）：宿主还要按这一层给
 * 镜头取景、还要把部件点击换算成钻取跳转，两边各存一份必然对不上。
 */
import type { TwinHierNode, TwinHierValues } from '@dt/twin-config'
import { childrenOf, hierAncestors } from '@dt/twin-config'
import { DtIcon } from '@dt/ui'
import { computed } from 'vue'

import { hierCardViews, hierLeafReadings, hierNodeName } from './hierDrillRows'
import TwinHierCard from './TwinHierCard.vue'

const props = defineProps<{
  /** 归一化后的全部钻取节点。 */
  nodes: readonly TwinHierNode[]
  /** 当前停在哪一层。 */
  nodeId: string
  /** 实时值，键是 `<节点 id>::<字段 key>`。 */
  values: TwinHierValues
}>()

const emit = defineEmits<{
  'update:nodeId': [string]
  close: []
}>()

const current = computed(
  () => props.nodes.find((item) => item.id === props.nodeId) ?? null,
)
const trail = computed(() => hierAncestors(props.nodes, props.nodeId))
const children = computed(() => childrenOf(props.nodes, props.nodeId))
const isLeaf = computed(() => children.value.length === 0)

/** 标题空着就用整条钻取路径，不留一个没名字的头。 */
const title = computed(() => {
  const node = current.value
  if (node === null) return ''
  if (node.title !== '') return node.title
  return trail.value.map(hierNodeName).join(' / ')
})

/** 上一层；当前已经是根时给 null，此时返回键关掉整个面板。 */
const parentId = computed(() => {
  const chain = trail.value
  return chain.length < 2 ? null : (chain[chain.length - 2]?.id ?? null)
})

const cards = computed(() =>
  hierCardViews(props.nodes, props.nodeId, props.values),
)
const leafFields = computed(() =>
  hierLeafReadings(props.nodes, props.nodeId, props.values),
)

/** 藏了子项列表，又确实有下一层：只能在 3D 上点部件钻进去。 */
const pickOnly = computed(
  () => !isLeaf.value && current.value?.hideChildList === true,
)

function goTo(id: string): void {
  if (id !== props.nodeId) emit('update:nodeId', id)
}

/** 返回：有上一层就上一层，已经在根上就整个关掉。 */
function back(): void {
  const up = parentId.value
  if (up === null) emit('close')
  else emit('update:nodeId', up)
}
</script>

<template>
  <section v-if="current !== null" class="twin-drill" data-test="twin-drill">
    <header class="twin-drill__head">
      <button
        type="button"
        class="twin-drill__icon"
        aria-label="返回上一层"
        data-test="drill-back"
        @click="back"
      >
        <DtIcon name="chevron-left" :size="14" />
      </button>
      <nav class="twin-drill__crumbs" aria-label="钻取路径">
        <template v-for="(node, index) in trail" :key="node.id">
          <DtIcon
            v-if="index > 0"
            name="chevron-right"
            :size="11"
            class="twin-drill__sep"
          />
          <button
            type="button"
            class="twin-drill__crumb"
            :class="{ 'twin-drill__crumb--now': node.id === nodeId }"
            :disabled="node.id === nodeId"
            data-test="drill-crumb"
            :data-id="node.id"
            @click="goTo(node.id)"
          >
            {{ hierNodeName(node) }}
          </button>
        </template>
      </nav>
      <button
        type="button"
        class="twin-drill__icon"
        aria-label="关闭钻取"
        data-test="drill-close"
        @click="emit('close')"
      >
        <DtIcon name="close" :size="14" />
      </button>
    </header>

    <p class="twin-drill__title" data-test="drill-title">{{ title }}</p>

    <ul v-if="leafFields.length > 0" class="twin-drill__fields">
      <li v-for="field in leafFields" :key="field.key" data-test="drill-field">
        <span class="twin-drill__label">{{ field.label }}</span>
        <span class="twin-drill__value">{{ field.text }}</span>
      </li>
    </ul>

    <p v-if="pickOnly" class="twin-drill__hint" data-test="drill-pick-only">
      点模型上的部件进入下一层
    </p>

    <ul v-else-if="cards.length > 0" class="twin-drill__cards">
      <li v-for="card in cards" :key="card.id">
        <TwinHierCard
          :name="card.name"
          :icon="card.icon"
          :child-count="card.childCount"
          :summary="card.summary"
          :data-id="card.id"
          @select="goTo(card.id)"
        />
      </li>
    </ul>

    <p
      v-else-if="leafFields.length === 0"
      class="twin-drill__hint"
      data-test="drill-empty"
    >
      这一层还没有配字段，也没有下一层。
    </p>
  </section>
</template>

<style scoped lang="scss">
.twin-drill {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 100%;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-overlay);
  box-shadow: var(--fx-shadow-modal);

  &__head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);

    &:hover {
      color: var(--accent-primary);
    }
  }

  &__crumbs {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  &__sep {
    color: var(--text-disabled);
  }

  &__crumb {
    font-size: 11px;
    color: var(--text-secondary);

    &:hover:not(:disabled) {
      color: var(--accent-primary);
    }

    &--now {
      color: var(--accent-on-surface);
      cursor: default;
    }
  }

  &__title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 13px;
    color: var(--text-title);
  }

  &__fields,
  &__cards {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__fields li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  &__label {
    font-size: 11px;
    color: var(--text-secondary);
  }

  &__value {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }

  &__hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-disabled);
  }
}
</style>
