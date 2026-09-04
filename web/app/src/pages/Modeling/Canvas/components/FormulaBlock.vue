<script setup lang="ts">
/**
 * @fileoverview 一条公式的排版：符号态 / 代入态两态、变量表、复制成纯 ASCII。
 * 分式、根号、Σ 与分档式靠自引用递归渲染。
 *
 * ⚠ 折行只发生在运算符前：整式交给浏览器自由折行的话，断点会落进变量名中间，
 * 一个中文列名被劈成两半在式子里完全读不出来（MODELING_RESULT_VIEW_DESIGN §6）。
 * ⚠ 复制出去的是纯 ASCII 不是 LaTeX：用户要拿它去 Excel 或台账公式里核对。
 */
import { DtButton, DtNotice } from '@dt/ui'
import { computed, onUnmounted, ref } from 'vue'

import { copyText } from '@/utils/clipboard'

import type {
  FormulaCase,
  FormulaNode,
  FormulaTermKind,
} from '../scripts/formula'
import { formulaText, termItems } from '../scripts/formula'
import type { FormulaSpec } from '../scripts/formulaCatalog'

const props = defineProps<{
  /** 一条完整的公式。带它才画标题、两态开关、复制键与变量表。 */
  spec?: FormulaSpec | undefined
  /** 递归渲染用：只画这一串节点，不带外壳。 */
  nodes?: readonly FormulaNode[] | undefined
}>()

// 「已复制」这行字停留多久
const FLASH_MS = 2000

interface ViewTerm {
  key: string
  text: string
  kind: FormulaTermKind
}
interface ViewItem {
  key: string
  terms: ViewTerm[]
}
/** 一段式子摊平成模板直接能读的形状——省得在模板里对联合类型做收窄。 */
interface ViewLine {
  key: string
  kind: FormulaNode['node']
  items: ViewItem[]
  over: FormulaNode[]
  under: FormulaNode[]
  of: FormulaNode[]
  from: string
  to: string
  rows: FormulaCase[]
}

const title = computed(() => props.spec?.title ?? '')
const notes = computed(() => props.spec?.notes ?? [])
const legend = computed(() => props.spec?.legend ?? [])
const fallback = computed(() => props.spec?.fallback ?? '')
const hasChrome = computed(() => props.spec !== undefined)
const filled = computed<FormulaNode[] | null>(() => props.spec?.filled ?? null)

// null = 还没人点过，跟着骨架表说的默认展开走
const picked = ref<boolean | null>(null)
const flash = ref('')
let timer = 0

const isFilledView = computed(() => picked.value ?? props.spec?.isOpen === true)

const shown = computed<readonly FormulaNode[]>(() => {
  const spec = props.spec
  if (spec === undefined) return props.nodes ?? []
  const body = filled.value
  return isFilledView.value && body !== null ? body : spec.symbolic
})

const lines = computed<ViewLine[]>(() =>
  shown.value.map((node, at) => {
    const line: ViewLine = {
      key: `${at}:${node.node}`,
      kind: node.node,
      items: [],
      over: [],
      under: [],
      of: [],
      from: '',
      to: '',
      rows: [],
    }
    if (node.node === 'run') {
      line.items = termItems(node.terms).map((group, index) => ({
        key: `${index}:${group[0]?.text ?? ''}`,
        terms: group.map((term, spot) => ({
          key: `${spot}:${term.text}`,
          text: term.text,
          kind: term.kind,
        })),
      }))
    } else if (node.node === 'frac') {
      line.over = node.over
      line.under = node.under
    } else if (node.node === 'sqrt') {
      line.of = node.of
    } else if (node.node === 'sum') {
      line.of = node.of
      line.from = node.from
      line.to = node.to
    } else {
      line.rows = node.rows
    }
    return line
  }),
)

/** 复制当前这一态的纯 ASCII。⚠ 走 `copyText`：内网纯 HTTP 下没有剪贴板 API。 */
async function copy(): Promise<void> {
  const done = await copyText(formulaText(shown.value))
  flash.value = done ? '已复制' : '复制失败，请手动选中'
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    flash.value = ''
  }, FLASH_MS)
}

onUnmounted(() => {
  window.clearTimeout(timer)
})
</script>

<template>
  <div class="dt-fx" :class="{ 'dt-fx--boxed': hasChrome }">
    <div v-if="hasChrome" class="dt-fx__head">
      <h5 class="dt-fx__title">{{ title }}</h5>
      <span v-if="flash !== ''" class="dt-fx__flash">{{ flash }}</span>
      <DtButton
        v-if="filled !== null"
        size="xs"
        :pressed="isFilledView"
        @click="picked = !isFilledView"
      >
        代入数值
      </DtButton>
      <DtButton
        size="xs"
        variant="ghost"
        icon="copy"
        aria-label="复制成纯文本"
        @click="copy"
      />
    </div>
    <div class="dt-fx__row">
      <template v-for="line in lines" :key="line.key">
        <span v-if="line.kind === 'run'" class="dt-fx__run">
          <span v-for="item in line.items" :key="item.key" class="dt-fx__item">
            <span
              v-for="term in item.terms"
              :key="term.key"
              class="dt-fx__t"
              :class="`dt-fx__t--${term.kind}`"
              >{{ term.text }}</span
            >
          </span>
        </span>
        <span v-else-if="line.kind === 'frac'" class="dt-fx__frac">
          <FormulaBlock :nodes="line.over" />
          <FormulaBlock class="dt-fx__under" :nodes="line.under" />
        </span>
        <span v-else-if="line.kind === 'sqrt'" class="dt-fx__sqrt">
          <span class="dt-fx__radical">√</span>
          <FormulaBlock class="dt-fx__roof" :nodes="line.of" />
        </span>
        <span v-else-if="line.kind === 'sum'" class="dt-fx__sum">
          <span class="dt-fx__sigma">
            <sup>{{ line.to }}</sup>
            <b>Σ</b>
            <sub>{{ line.from }}</sub>
          </span>
          <FormulaBlock :nodes="line.of" />
        </span>
        <span v-else class="dt-fx__cases">
          <template v-for="row in line.rows" :key="row.when">
            <FormulaBlock :nodes="row.then" />
            <span class="dt-fx__when">{{ row.when }}</span>
          </template>
        </span>
      </template>
    </div>
    <p v-if="fallback !== ''" class="dt-fx__fallback">{{ fallback }}</p>
    <ul v-if="legend.length > 0" class="dt-fx__legend">
      <li v-for="one in legend" :key="one.symbol">
        <code>{{ one.symbol }}</code>
        {{ one.text }}
      </li>
    </ul>
    <DtNotice v-for="note in notes" :key="note" intent="info">
      {{ note }}
    </DtNotice>
  </div>
</template>

<style scoped lang="scss">
.dt-fx {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &--boxed {
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }

  &__head {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  &__title {
    flex: 1;
    margin: 0;
    color: var(--text-title);
    font-size: var(--ctl-fs-sm);
  }

  &__flash {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  // 折行只发生在项与项之间，项内是 nowrap
  &__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 0.25em;
    row-gap: 0.35em;
    color: var(--text-primary);
    font-size: var(--ctl-fs-md);
    line-height: 1.5;
  }

  &__run {
    display: contents;
  }

  &__item {
    white-space: nowrap;
  }

  &__t {
    &--var,
    &--op {
      font-family: var(--font-mono);
    }

    &--num {
      color: var(--text-title);
      font-family: var(--font-digit);
    }

    &--op {
      margin: 0 0.25em;
      color: var(--text-secondary);
    }

    &--name {
      color: var(--text-secondary);
    }

    // ⚠ 颜色不作唯一编码：警示项另带一圈边框，色觉受限时照样看得出来
    &--warn {
      padding: 0 0.25em;
      border: 1px solid rgba(var(--state-warning-rgb), 0.7);
      border-radius: var(--radius-sm);
      color: var(--state-warning);
    }
  }

  &__item > &__t--op:first-child {
    margin-left: 0;
  }

  &__frac {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  // currentColor 而不是 border 令牌：分数线要跟着它所在那行的字色走
  &__under {
    border-top: 1px solid currentcolor;
  }

  &__sqrt {
    display: inline-flex;
    align-items: stretch;
  }

  &__radical {
    align-self: flex-end;
  }

  &__roof {
    padding: 0 0.15em;
    border-top: 1px solid currentcolor;
  }

  &__sum {
    display: inline-flex;
    gap: 0.25em;
    align-items: center;
  }

  &__sigma {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    line-height: 1;

    sub,
    sup {
      color: var(--text-secondary);
      font-size: var(--ctl-hint-fs-sm);
    }

    b {
      font-weight: 400;
    }
  }

  &__cases {
    display: inline-grid;
    grid-template-columns: auto auto;
    gap: 0.15em 0.75em;
    align-items: center;
    padding-left: 0.5rem;
    border-left: 1px solid var(--border-strong);
  }

  &__when {
    color: var(--text-secondary);
    font-size: var(--ctl-fs-sm);
  }

  &__fallback {
    margin: 0;
    color: var(--text-disabled);
    font-size: var(--ctl-fs-sm);
  }

  &__legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    margin: 0;
    padding: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    list-style: none;

    code {
      color: var(--text-primary);
      font-family: var(--font-mono);
    }
  }
}
</style>
