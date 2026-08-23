<script setup lang="ts">
/**
 * @fileoverview 函数面板：按分类分组、可搜索，点一个就插进公式。
 *
 * ⚠ **一个函数名都不许写在前端**。名字、分类、签名、参数个数、例子全部来自
 * `formula-functions`。参考实现早期硬编码了五个，后端补上对数与三角一族之后
 * 整族在界面上不可见，用户报的是「算不了 ln」（docs/DATASET_DESIGN.md §5.3）。
 */
import { computed, ref } from 'vue'
import type {
  DatasetCatalogChoice,
  DatasetCatalogFunction,
} from '@dt/contracts'
import { DtIcon, DtInput } from '@dt/ui'

import { functionSnippet, type InsertPayload } from '../scripts/formulaText'

const props = defineProps<{
  categories: readonly DatasetCatalogChoice[]
  functions: readonly DatasetCatalogFunction[]
  /** 当前选中的文本：非空时函数会套住它而不是插一个空壳。 */
  selection: string
}>()

const emit = defineEmits<{ insert: [payload: InsertPayload] }>()

const keyword = ref('')
/** 空串 = 全部分类。 */
const category = ref('')

/**
 * 分类不在目录里的函数收进这一档。
 * ⚠ 后端加了一族函数、却忘了把分类也加进 `categories` 时，按分类分组会让那一族
 * **一个都不出现**——那正是「算不了 ln」那次故障的形状，只是换了个入口。
 */
const OTHER_CATEGORY = 'dataset.formula.other'

const knownCategories = computed(
  () => new Set(props.categories.map((one) => one.value)),
)

/** 真有函数的分类；一个函数都没有的分类不给筛选钮，点了只会得到一片空。 */
const buckets = computed(() => {
  const named = props.categories.filter((one) =>
    props.functions.some((fn) => fn.category === one.value),
  )
  const hasOrphan = props.functions.some(
    (fn) => !knownCategories.value.has(fn.category),
  )
  return hasOrphan
    ? [...named, { value: OTHER_CATEGORY, label: '其它' }]
    : named
})

function inBucket(fn: DatasetCatalogFunction, bucket: string): boolean {
  return bucket === OTHER_CATEGORY
    ? !knownCategories.value.has(fn.category)
    : fn.category === bucket
}

function matches(fn: DatasetCatalogFunction, word: string): boolean {
  if (word === '') return true
  const haystack = `${fn.name} ${fn.description} ${fn.signature}`
  return haystack.toLowerCase().includes(word)
}

/**
 * 过滤后按分类分组。空分组不渲染，搜索时才不会剩一排空标题。
 * ⚠ 分类顺序就是后端给的顺序，不重排：那是面板的分组次序，不是字典序。
 */
const groups = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  return buckets.value
    .filter((one) => category.value === '' || one.value === category.value)
    .map((one) => ({
      value: one.value,
      label: one.label,
      items: props.functions.filter(
        (fn) => inBucket(fn, one.value) && matches(fn, word),
      ),
    }))
    .filter((one) => one.items.length > 0)
})

const willWrap = computed(() => props.selection.trim() !== '')

function insert(fn: DatasetCatalogFunction): void {
  emit('insert', functionSnippet(fn, props.selection))
}

/** 搜到了直接回车插第一个匹配项，不用再挪去点。 */
function onEnter(): void {
  const first = groups.value[0]?.items[0]
  if (first !== undefined) insert(first)
}

/**
 * 悬停说明：签名、用途、参数个数与例子。
 * ⚠ 参数个数是后端从元数表注入的，不是这里数出来的。
 * @param fn 目录里的这个函数
 */
function tipOf(fn: DatasetCatalogFunction): string {
  const arity =
    fn.max_args === null
      ? `${fn.min_args} 个及以上参数`
      : fn.min_args === fn.max_args
        ? `${fn.min_args} 个参数`
        : `${fn.min_args}~${fn.max_args} 个参数`
  return `${fn.signature}\n${fn.description}\n（${arity}）\n例：${fn.example}`
}

/** 说明只留第一小句：函数一多，长短参差会把整片区域搅乱。 */
function briefOf(fn: DatasetCatalogFunction): string {
  return fn.description.split(/[；。（(]/)[0] ?? fn.description
}
</script>

<template>
  <!-- 目录一大（对数与三角一族齐了之后有几十个）这一片会吃掉半个弹窗，
       默认收起。开合交给 details 原生管：把 :open 绑到会在 @toggle 里自我
       翻转的 ref 上会自激成死循环 -->
  <details>
    <summary class="ftb-head cursor-pointer">
      函数（{{ props.functions.length }} 个，展开搜索选用）
      <span v-if="willWrap" class="ftb-wrap">将套住选中的内容</span>
    </summary>

    <div class="mt-1.5 flex flex-col gap-1.5">
      <div class="w-48">
        <DtInput
          v-model="keyword"
          size="sm"
          aria-label="搜函数"
          placeholder="搜函数名或中文，如 对数 / LN"
          @keydown.enter.prevent="onEnter"
        />
      </div>

      <div class="flex flex-wrap items-center gap-1">
        <button
          type="button"
          class="ftb-cat"
          :class="{ 'ftb-cat--on': category === '' }"
          @click="category = ''"
        >
          全部
        </button>
        <button
          v-for="one in buckets"
          :key="one.value"
          type="button"
          class="ftb-cat"
          :class="{ 'ftb-cat--on': category === one.value }"
          @click="category = one.value"
        >
          {{ one.label }}
        </button>
      </div>

      <p
        v-if="groups.length === 0"
        class="flex items-center gap-1.5 py-1 text-2xs text-text-disabled"
      >
        <DtIcon name="search" :size="14" />
        没有匹配「{{ keyword }}」的函数
      </p>

      <div
        v-for="group in groups"
        :key="group.value"
        class="flex flex-col gap-1"
      >
        <span class="ftb-head">{{ group.label }}</span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="fn in group.items"
            :key="fn.name"
            type="button"
            class="ftb-fn"
            :title="tipOf(fn)"
            @click="insert(fn)"
          >
            <span class="ftb-fn__name">{{ fn.name }}</span>
            <span class="ftb-fn__desc">{{ briefOf(fn) }}</span>
          </button>
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
/* 抬头写成类名而不是一串工具类：理由见 FormulaToolbox 里同名的那一条 */
.ftb-head {
  color: var(--text-disabled);
  font-size: 11px;
}

.ftb-wrap {
  color: var(--accent-on-surface);
}

.ftb-cat {
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  color: var(--text-disabled);
  font-size: 11px;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.ftb-cat:hover {
  color: var(--text-secondary);
}

.ftb-cat--on {
  background: rgba(var(--accent-primary-rgb), 0.15);
  color: var(--accent-on-surface);
}

.ftb-fn {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(var(--accent-primary-rgb), 0.03);
  padding: 4px 6px;
  text-align: left;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.ftb-fn:hover,
.ftb-fn:focus-visible {
  border-color: var(--border-hover);
  background: rgba(var(--accent-primary-rgb), 0.1);
}

.ftb-fn__name {
  color: var(--accent-on-surface);
  font-size: 12px;
}

/* 说明截断不换行：函数一多，参差的高度会让整片区域很乱 */
.ftb-fn__desc {
  max-width: 8rem;
  overflow: hidden;
  color: var(--text-disabled);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
