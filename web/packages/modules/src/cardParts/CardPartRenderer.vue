<script setup lang="ts">
/**
 * @fileoverview 部件的**唯一装配点**：按 `kind` 查分发表，把固定三件套
 * （`part` / `cell` / `meta`）喂给查到的那个组件。卡片本体因此不认识任何一个
 * 具体部件——加一种部件不必碰它。
 *
 * 三条失败边界各自只影响一个部件，不牵连同格的其它部件、更不牵连整块卡片：
 * 档没登记 → 占位；异步 chunk 加载失败 → 重试一次后占位；渲染抛错 → 就地拦下。
 * ⚠ 三条都**画占位不留白**：静默留白就是「我加了部件但没反应」，那是这套东西里
 * 最难查的一类故障（DASHBOARD_DESIGN §5.3 陷阱 ⑤）。
 */
import {
  computed,
  defineAsyncComponent,
  onErrorCaptured,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue'

import { partConfigOf } from './define'
import { getCardPart } from './registry'
import type { CardCellView, CardPartDefinition, CardPartMeta } from './types'

const props = defineProps<{
  /** 这一档是什么部件。 */
  kind: string
  /** 落库的那一行部件配置，键**带前缀**；这里负责去前缀后再往下传。 */
  row: Readonly<Record<string, unknown>>
  cell: CardCellView
  meta: CardPartMeta
}>()

/** 异步 chunk 最多重试一次：再失败就是占位，不无限重试拖住这一格。 */
const LOAD_ATTEMPT_LIMIT = 1

/** 异步 chunk 的加载超时（ms）。 */
const LOAD_TIMEOUT_MS = 15_000

const definition = computed(() => getCardPart(props.kind))

/** 去前缀后的配置：部件因此看不见同一行里别档的键。 */
const part = computed(() => partConfigOf(props.kind, props.row))

// ⚠ 用 null 表示「没失败」而不是空串：异常带的消息**可以是空串**，
// 拿空串当哨兵的话这一格既不渲染部件也不渲染占位，只剩一块什么都不说的空白
const renderFailure = ref<string | null>(null)
const loadFailure = ref<string | null>(null)
const loaded = shallowRef<Component | null>(null)

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : '未知错误'
}

/**
 * 包成异步组件。
 * ⚠ 必须**自己剥 `default`**：Vue 只对带 `Symbol.toStringTag: 'Module'` 的结果剥，
 * 而契约允许 `Promise.resolve({ default: C })`（第三方部件不走 `import()` 时就是它）。
 * 直接交给 Vue 会把整个 `{ default: C }` 当组件，表现是这一格既不渲染也不占位。
 * @param loader 部件定义里那个异步加载器
 */
function toAsync(loader: CardPartDefinition['component']): Component {
  return defineAsyncComponent({
    loader: async () => (await loader()).default,
    timeout: LOAD_TIMEOUT_MS,
    onError(error, retry, fail, attempts) {
      if (attempts <= LOAD_ATTEMPT_LIMIT) {
        retry()
        return
      }
      loadFailure.value = describeError(error)
      fail()
    },
  })
}

// ⚠ 必须返回 false 阻断冒泡：不阻断的话这一个部件的异常会一路冒到整块卡片，
// 于是一个坏部件带走同格的其它部件与另外九个格
onErrorCaptured((error) => {
  renderFailure.value = describeError(error)
  return false
})

watch(
  definition,
  (found) => {
    renderFailure.value = null
    loadFailure.value = null
    loaded.value = found === undefined ? null : toAsync(found.component)
  },
  { immediate: true },
)

/** 画不出来时说得出为什么。⚠ 三种成因分开说：它们的排查方向完全不同。 */
const excuse = computed<string | null>(() => {
  if (definition.value === undefined) return `没有「${props.kind}」这种部件`
  if (loadFailure.value !== null) return '部件没加载出来'
  if (renderFailure.value !== null) return '部件渲染失败'
  return null
})
</script>

<template>
  <span v-if="excuse !== null" class="cp-fallback" :title="excuse">
    {{ excuse }}
  </span>
  <component
    :is="loaded"
    v-else-if="loaded !== null"
    :part="part"
    :cell="cell"
    :meta="meta"
  />
</template>

<style scoped>
.cp-fallback {
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
  border: 1px dashed var(--state-danger);
  border-radius: var(--radius-sm);
  color: var(--state-danger);
  font-size: 11px;
  line-height: 1.6;
}
</style>
