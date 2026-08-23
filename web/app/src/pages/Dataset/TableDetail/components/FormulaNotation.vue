<script setup lang="ts">
/**
 * @fileoverview 把后端的记号树画成二维数学式（分式上下排、幂做上标、聚合带
 * 范围下标、IF/IFS 收成一个大括号）。只排版不解析——树由 `formula:validate`
 * 生成，前端再解析一遍就是第二个解析器（docs/DATASET_DESIGN.md §5.9）。
 *
 * 递归组件：`<script setup>` 下按文件名自引用。
 * ⚠ 认不出的节点、少了子字段的节点，一律画成 `?` 占位。少一个字段就让递归撞上
 * `undefined`，整个列表单弹窗会一起白掉，而白屏正是占位分支要避免的症状。
 */
import { computed } from 'vue'

import {
  asNode,
  hasNodeList,
  nodeChild,
  nodeNumber,
  nodeSlots,
  nodeText,
} from '../scripts/notationTree'

/**
 * 这几种节点的内容装在一个数组里。
 * ⚠ 数组不在时整块降级成占位，不能当成空表：`fn` 少了 `args` 会画出一个
 * `ABS()`，看着像一个真的零参函数，而那是一句凭空编出来的读法。
 */
const LIST_FIELD: Record<string, string> = {
  fn: 'args',
  logic: 'args',
  cases: 'arms',
}

const props = defineProps<{ node: unknown }>()

const node = computed(() => asNode(props.node))
const kind = computed(() => {
  const found = nodeText(node.value, 't')
  const field = LIST_FIELD[found]
  if (field !== undefined && !hasNodeList(node.value, field)) return ''
  return found
})

/** 子节点位。读不到时给 null，子组件自己会画成占位。 */
function child(field: string): unknown {
  return nodeChild(node.value, field)
}

function text(field: string): string {
  return nodeText(node.value, field)
}

const args = computed(() => nodeSlots(node.value, 'args'))
const arms = computed(() => nodeSlots(node.value, 'arms'))
const steps = computed(() => nodeNumber(node.value, 'n', 1))

/** 列引用的悬停说明：写法 + 单位。单位是读懂这个数的前提，不能只在表头出现。 */
const refTitle = computed(() => {
  const unit = text('unit')
  const inner =
    kind.value === 'ext' ? `${text('table_code')}.${text('key')}` : text('key')
  return `{${inner}}${unit === '' ? '' : `（${unit}）`}`
})
</script>

<template>
  <span v-if="kind === 'col'" class="nt-col" :title="refTitle">
    {{ text('name') }}
  </span>
  <span v-else-if="kind === 'ext'" class="nt-ext" :title="refTitle">
    {{ text('table') }}·{{ text('name') }}
  </span>

  <span v-else-if="kind === 'num'" class="nt-num">{{ text('v') }}</span>
  <span v-else-if="kind === 'text'" class="nt-text">「{{ text('v') }}」</span>

  <span v-else-if="kind === 'paren'" class="nt-row">
    <span class="nt-mark">(</span>
    <FormulaNotation :node="child('x')" />
    <span class="nt-mark">)</span>
  </span>

  <span v-else-if="kind === 'frac'" class="nt-frac">
    <span class="nt-frac__part"><FormulaNotation :node="child('num')" /></span>
    <span class="nt-frac__part nt-frac__part--den">
      <FormulaNotation :node="child('den')" />
    </span>
  </span>

  <span v-else-if="kind === 'bin' || kind === 'cmp'" class="nt-row">
    <FormulaNotation :node="child('l')" />
    <span class="nt-mark">{{ text('op') }}</span>
    <FormulaNotation :node="child('r')" />
  </span>

  <span v-else-if="kind === 'logic'" class="nt-row">
    <template v-for="slot in args" :key="slot.at">
      <span v-if="slot.at > 0" class="nt-word">{{ text('op') }}</span>
      <FormulaNotation :node="slot.node" />
    </template>
  </span>

  <span v-else-if="kind === 'neg'" class="nt-row">
    <span class="nt-mark">−</span>
    <FormulaNotation :node="child('x')" />
  </span>

  <span v-else-if="kind === 'not'" class="nt-row">
    <span class="nt-word">非</span>
    <FormulaNotation :node="child('x')" />
  </span>

  <span v-else-if="kind === 'pow'" class="nt-row">
    <FormulaNotation :node="child('base')" />
    <span class="nt-sup"><FormulaNotation :node="child('exp')" /></span>
  </span>

  <span v-else-if="kind === 'sqrt'" class="nt-sqrt">
    <span class="nt-sqrt__sym">√</span>
    <span class="nt-sqrt__body"><FormulaNotation :node="child('x')" /></span>
  </span>

  <span v-else-if="kind === 'prev'" class="nt-row">
    <span class="nt-word">
      {{ steps === 1 ? '上一条的' : `上第 ${steps} 条的` }}
    </span>
    <FormulaNotation :node="child('x')" />
  </span>

  <span v-else-if="kind === 'agg'" class="nt-row">
    <span class="nt-agg">
      <span class="nt-agg__sym">{{ text('sym') }}</span>
      <span class="nt-agg__label">{{ text('label') }}</span>
    </span>
    <span class="nt-mark">(</span>
    <FormulaNotation :node="child('x')" />
    <span class="nt-mark">)</span>
  </span>

  <span v-else-if="kind === 'fn'" class="nt-row nt-row--tight">
    <span class="nt-fn" :title="text('label')">{{ text('name') }}</span>
    <span class="nt-mark">(</span>
    <template v-for="slot in args" :key="slot.at">
      <span v-if="slot.at > 0" class="nt-mark">,</span>
      <FormulaNotation :node="slot.node" />
    </template>
    <span class="nt-mark">)</span>
  </span>

  <!-- 分段：每一档一行，末行是「否则」。档数由后端摊平后给定，这里不再截断 -->
  <span v-else-if="kind === 'cases'" class="nt-cases">
    <span class="nt-cases__brace" aria-hidden="true">{</span>
    <span class="nt-cases__rows">
      <FormulaNotation v-for="slot in arms" :key="slot.at" :node="slot.node" />
      <span class="nt-row">
        <FormulaNotation :node="child('else')" />
        <span class="nt-word nt-cases__cond">否则</span>
      </span>
    </span>
  </span>

  <span v-else-if="kind === 'arm'" class="nt-row">
    <FormulaNotation :node="child('then')" />
    <span class="nt-row nt-cases__cond">
      <span class="nt-word">若</span>
      <FormulaNotation :node="child('cond')" />
    </span>
  </span>

  <!-- 后端加了新记号、前端还没学会摆它：画个占位，别把整棵树连同弹窗炸掉 -->
  <span v-else class="nt-hole" title="这个记号本界面还认不出来">?</span>
</template>

<style scoped>
/* 全部 inline-flex 垂直居中：分式、聚合这类「高块」出现时兄弟项对齐到它的
   中线，整条式子始终像一行数学式而不是错位的文字流 */
.nt-row {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
}
.nt-row--tight {
  gap: 0.1em;
}

.nt-col {
  color: var(--accent-primary);
}
.nt-ext {
  color: var(--state-warning);
}
.nt-num {
  color: var(--text-primary);
}
.nt-text {
  color: var(--text-secondary);
}
.nt-mark {
  color: var(--text-secondary);
}
.nt-word {
  color: var(--text-disabled);
  font-size: 0.85em;
  white-space: nowrap;
}
.nt-fn {
  color: var(--accent-secondary);
}

.nt-hole {
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-sm);
  padding: 0 0.4em;
  color: var(--text-disabled);
  font-size: 0.85em;
}

.nt-frac {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  margin: 0 0.15em;
  vertical-align: middle;
}
.nt-frac__part {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  padding: 0.1em 0.45em;
}
.nt-frac__part--den {
  border-top: 1px solid var(--text-secondary);
}

.nt-sup {
  align-self: flex-start;
  margin-top: -0.35em;
  font-size: 0.72em;
}

/* 近似排版：根指 + 上划线；内容极高时线不跟着延伸，可接受 */
.nt-sqrt {
  display: inline-flex;
  align-items: stretch;
}
.nt-sqrt__sym {
  align-self: flex-end;
  color: var(--text-secondary);
}
.nt-sqrt__body {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  border-top: 1px solid var(--text-secondary);
  padding: 0.15em 0.3em 0 0.2em;
}

.nt-agg {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.15;
}
.nt-agg__sym {
  color: var(--text-primary);
  font-size: 1.15em;
}
.nt-agg__label {
  color: var(--text-disabled);
  font-size: 0.62em;
  white-space: nowrap;
}

.nt-cases {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
}
.nt-cases__brace {
  color: var(--text-secondary);
  font-size: 2.1em;
  font-weight: 200;
  line-height: 1;
}
.nt-cases__rows {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3em;
}
.nt-cases__cond {
  margin-left: 0.6em;
}
</style>
