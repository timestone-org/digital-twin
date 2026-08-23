<script setup lang="ts">
/**
 * @fileoverview 公式工具箱：本表的列、其他台账的列、公式库、函数、运算符与
 * 时间窗写法，点一下就插进公式。
 *
 * ⚠ 每一栏的内容**全部来自后端目录**，前端一个函数名、一个运算符都不写死。
 * 硬编码一份的下场是后端加了一族函数、界面上整族不可见，而没有任何东西会报
 * （docs/DATASET_DESIGN.md §5.3）。
 * ⚠ 只负责说「要插什么、光标停哪」，插到哪一格由宿主决定：文本面插进 textarea，
 * 分段面插进最近聚焦的那一格。
 */
import { computed, ref } from 'vue'
import type { DatasetFormulaCatalog } from '@dt/contracts'
import { DtInput } from '@dt/ui'

import FormulaCrossTable from './FormulaCrossTable.vue'
import FormulaFunctionPicker from './FormulaFunctionPicker.vue'
import {
  columnRef,
  librarySnippet,
  operatorSnippet,
  operatorTokens,
  windowSnippet,
  type InsertPayload,
} from '../scripts/formulaText'

const props = defineProps<{
  catalog: DatasetFormulaCatalog | null
  /** 公式里已经引用过的 key，用来在列上标「已用」。 */
  used: ReadonlySet<string>
  /** 当前选中的文本：非空时函数会套住它。 */
  selection: string
}>()

const emit = defineEmits<{ insert: [payload: InsertPayload] }>()

const libraryKeyword = ref('')

const columns = computed(() => props.catalog?.columns ?? [])
const tables = computed(() => props.catalog?.tables ?? [])
const categories = computed(() => props.catalog?.categories ?? [])
const functions = computed(() => props.catalog?.functions ?? [])
const windowUnits = computed(() => props.catalog?.window_units ?? [])
const rules = computed(() => props.catalog?.rules ?? [])

/**
 * 运算符速查拆成一个个能插的符号。
 * ⚠ 后端把同一类的几个写在一格里（`>  >=  <  <=`），照原样插进去就是语法错误。
 */
const operators = computed(() =>
  (props.catalog?.operators ?? []).flatMap((one) =>
    operatorTokens(one.value).map((symbol) => ({ symbol, desc: one.label })),
  ),
)

/**
 * 公式库里的条目，同样来自目录。第 12 期落地之前后端恒给空表，这一栏于是不出现。
 * ⚠ 不写「公式库还没做」这类话：目录里有就显示，没有就没有，界面不替后端排期。
 */
const library = computed(() => {
  const word = libraryKeyword.value.trim().toLowerCase()
  const all = props.catalog?.library ?? []
  return word === ''
    ? all
    : all.filter((code) => code.toLowerCase().includes(word))
})

function insertColumn(key: string): void {
  const snippet = columnRef(key)
  emit('insert', { snippet, caret: snippet.length })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <section class="flex flex-col gap-1">
      <span class="ftb-head">本表的列（点一下插入引用）</span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="column in columns"
          :key="column.key"
          type="button"
          class="ftb-chip"
          :class="{ 'ftb-chip--used': props.used.has(column.key) }"
          :title="`插入 {${column.key}}${column.unit ? `，单位 ${column.unit}` : ''}`"
          @click="insertColumn(column.key)"
        >
          {{ column.name }}
          <span v-if="column.unit" class="ftb-chip__unit">{{
            column.unit
          }}</span>
        </button>
        <span v-if="columns.length === 0" class="text-2xs text-text-disabled">
          这张台账还没有别的列
        </span>
      </div>
    </section>

    <FormulaCrossTable :tables="tables" @insert="emit('insert', $event)" />

    <!-- 公式库排在函数之前：多数人想算的口径库里已经有了，先看见它就不必用
         函数从头拼一遍 -->
    <section
      v-if="(props.catalog?.library ?? []).length > 0"
      class="flex flex-col gap-1"
    >
      <div class="flex items-center gap-2">
        <span class="ftb-head">公式库</span>
        <div class="w-36">
          <DtInput
            v-model="libraryKeyword"
            size="sm"
            aria-label="搜库公式"
            placeholder="搜公式标识"
          />
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="code in library"
          :key="code"
          type="button"
          class="ftb-chip"
          :title="`插入 @${code}()`"
          @click="emit('insert', librarySnippet(code))"
        >
          @{{ code }}
        </button>
      </div>
      <p v-if="library.length === 0" class="text-2xs text-text-disabled">
        没有匹配的库公式
      </p>
    </section>

    <FormulaFunctionPicker
      v-if="functions.length > 0"
      :categories="categories"
      :functions="functions"
      :selection="props.selection"
      @insert="emit('insert', $event)"
    />

    <section v-if="operators.length > 0" class="flex flex-col gap-1">
      <span class="ftb-head">运算符</span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="op in operators"
          :key="op.symbol"
          type="button"
          class="ftb-op"
          :title="op.desc"
          @click="emit('insert', operatorSnippet(op.symbol))"
        >
          {{ op.symbol }}
        </button>
      </div>
    </section>

    <!-- 求值规则与后端 `RULES` 逐字一致：口径的说明与实现不许各写一套 -->
    <details v-if="rules.length > 0" class="text-2xs">
      <summary class="ftb-head cursor-pointer">计算规则说明</summary>
      <ul class="mt-1 flex flex-col gap-0.5 pl-4 text-text-disabled">
        <li v-for="rule in rules" :key="rule" class="list-disc">{{ rule }}</li>
      </ul>
    </details>

    <!-- 时间窗是字符串参数，不带引号解析不过；这一排省掉「引号怎么写」的回忆 -->
    <section v-if="windowUnits.length > 0" class="flex flex-col gap-1">
      <span class="ftb-head">时间窗写法（给 *_OVER 用）</span>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="unit in windowUnits"
          :key="unit.value"
          type="button"
          class="ftb-op"
          :title="unit.label"
          @click="emit('insert', windowSnippet(unit.value))"
        >
          '{{ unit.value }}'
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 栏目抬头写成类名而不是一串工具类：一行装不下时 prettier 会把闭合尖括号折到
   下一行，而结构闸的闭合标签正则认不出那种写法 */
.ftb-head {
  color: var(--text-disabled);
  font-size: 11px;
}

.ftb-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(var(--accent-primary-rgb), 0.04);
  padding: 4px 6px;
  color: var(--text-secondary);
  font-size: 11px;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.ftb-chip:hover,
.ftb-chip:focus-visible {
  border-color: var(--border-hover);
  color: var(--accent-on-surface);
}

/* 已引用过的列多一道左边线，而不是只改颜色：只靠颜色区分在色觉障碍下失效 */
.ftb-chip--used {
  border-left: 2px solid var(--accent-primary);
  color: var(--accent-on-surface);
}

.ftb-chip__unit {
  color: var(--text-disabled);
  font-size: 10px;
}

.ftb-op {
  min-width: 2rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(var(--accent-primary-rgb), 0.04);
  padding: 4px 0;
  color: var(--text-secondary);
  font-size: 13px;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.ftb-op:hover,
.ftb-op:focus-visible {
  border-color: var(--border-hover);
  color: var(--accent-on-surface);
}
</style>
