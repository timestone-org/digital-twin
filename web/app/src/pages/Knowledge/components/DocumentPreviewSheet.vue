<script setup lang="ts">
/**
 * @fileoverview 原件预览的工作簿画法：把 .xlsx / .xlsm 摊成一张表。
 *
 * ⚠ 这个件**只许异步加载**（调用方用 `defineAsyncComponent`）：它静态依赖
 * 解析工作簿的那个库，同步引进来就是每次打开知识库页都白下一份。
 *
 * ⚠ 入口是 `read-excel-file/browser` 而不是包名本身：这个包没有根导出，
 * 写包名的表现是打包时报「找不到模块」——而在编辑器里它看着完全正常。
 *
 * ⚠ 只画前几百行。工作簿动辄几万行，全画出来是几十万个 DOM 节点，
 * 而预览要回答的问题是「这份表长什么样」，不是「第 27431 行是多少」。
 * 截断了就**如实说一句**——不说的话，用户会以为这份表就到那里为止。
 *
 * ⚠ 表格走 `DtTable` 而不是自己摆一张原生表：列宽、表头字号、行分隔、hover、
 * sticky 与横滚在本仓只有一套皮肤，手写一张就多一种参差。列是**运行时**才知道
 * 的（第一行是什么就是什么），所以单元格插槽名也只能在模板里动态拼。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import readXlsxFile from 'read-excel-file/browser'
import type { Row, Sheet } from 'read-excel-file/browser'
import type { DtTableColumn } from '@dt/contracts'
import { DtSegmented, DtSpinner, DtTable } from '@dt/ui'

const props = defineProps<{ blob: Blob }>()

/** 每张表最多画几行（含表头那一行）。 */
const MAX_ROWS = 400

/** 一行摊成 `DtTable` 认得的形状：`c0`、`c1`… 对应第几列。 */
interface SheetRow {
  id: string
  [column: string]: string
}

const sheets = ref<readonly Sheet[]>([])
const picked = ref('')
const isLoading = ref(true)
const failure = ref('')
let isAlive = true

const tabs = computed(() =>
  sheets.value.map((one) => ({ value: one.sheet, label: one.sheet })),
)

const current = computed(
  () => sheets.value.find((one) => one.sheet === picked.value) ?? null,
)

/** 表头那一行；空表时是空数组。 */
const head = computed<Row>(() => current.value?.data[0] ?? [])

const columns = computed<readonly DtTableColumn[]>(() =>
  head.value.map((cell, at) => ({ key: `c${at}`, label: cellText(cell) })),
)

const rows = computed<readonly SheetRow[]>(() =>
  (current.value?.data.slice(1, MAX_ROWS) ?? []).map(toRow),
)

/**
 * 一行单元格摊成一条记录。
 * @param cells 这一行的各格
 * @param at 它在正文里的第几行，当 id 用
 */
function toRow(cells: Row, at: number): SheetRow {
  const made: SheetRow = { id: String(at) }
  cells.forEach((cell, column) => {
    made[`c${column}`] = cellText(cell)
  })
  return made
}

const hidden = computed(() =>
  Math.max((current.value?.data.length ?? 0) - MAX_ROWS, 0),
)

async function load(blob: Blob): Promise<void> {
  isLoading.value = true
  failure.value = ''
  try {
    const made = await readXlsxFile(blob)
    if (!isAlive) return
    sheets.value = made
    picked.value = made[0]?.sheet ?? ''
  } catch {
    // ⚠ 不摆库里那句英文原文：用户能做的只有一件事——下载下来用 Excel 打开
    failure.value = '这份工作簿画不出来，可以下载原件后用 Excel 打开。'
  } finally {
    if (isAlive) isLoading.value = false
  }
}

/**
 * 一格摆成一句字。
 * ⚠ 日期按 ISO 的年月日摆，不走 `toLocaleDateString`：本机与服务器的 locale
 * 不是同一个（CI 上是中文），跟着 locale 走的话同一份表在两处显示的日期格式
 * 不同，而钉住它的用例会在其中一处红。
 * @param value 单元格的值
 */
function cellText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  // ⚠ 逐个类型判而不是一把 `String(value)`：这个库的单元格类型声明里有一处
  // 笔误（写成了 `Date` 这个构造器本身），照着它 `String` 一把的话，
  // 真遇上表外的类型摆出来的是 `[object Object]`
  return ''
}

watch(() => props.blob, load, { immediate: true })

onUnmounted(() => {
  isAlive = false
})
</script>

<template>
  <div class="doc-sheet">
    <DtSpinner v-if="isLoading" />
    <p v-else-if="failure !== ''" class="doc-sheet__note">{{ failure }}</p>
    <DtSegmented
      v-else-if="tabs.length > 1"
      v-model="picked"
      class="doc-sheet__tabs"
      variant="tabs"
      aria-label="工作表"
      :options="tabs"
    />
    <DtTable
      v-if="current !== null"
      :columns="columns"
      :rows="rows"
      min-width="0"
    >
      <!-- ⚠ 插槽名拼错不报错、只会把每一格渲染成一个占位符（DtTable 的默认
           插槽内容）。这里的名字是按列 key 拼出来的，与上面 `columns` 同源 -->
      <template
        v-for="column in columns"
        #[`cell-${column.key}`]="{ row }"
        :key="column.key"
      >
        {{ row[column.key] ?? '' }}
      </template>
    </DtTable>
    <p v-if="hidden > 0" class="doc-sheet__note">
      这张表还有 {{ hidden }} 行没画出来，下载原件可以看全。
    </p>
  </div>
</template>

<style scoped lang="scss">
.doc-sheet {
  min-height: 0;
  flex: 1;
  padding: 0 0 12px;
  overflow: auto;
  background: var(--surface-panel);

  &__tabs {
    position: sticky;
    // ⚠ 粘在顶上：工作表页签滚走之后就没法换表了，而这块是要横竖都能滚的
    top: 0;
    z-index: 1;
    padding: 8px 12px;
    background: var(--surface-panel);
  }

  &__note {
    margin: 12px;
    color: var(--text-secondary);
    font-size: 0.75rem;
  }
}
</style>
