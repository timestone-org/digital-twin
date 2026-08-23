<script setup lang="ts">
/**
 * @fileoverview 公式编辑器：一个文本框 + 工具箱 + 实时校验 + 读法 + 试算，
 * 外加分段这另一种编辑面。落库的永远只有一行表达式文本
 * （docs/DATASET_DESIGN.md §7.6）。
 *
 * 三条时序上的规矩，每一条都对应一个真实的静默故障：
 * ⚠ 分段面**只在切进去的那一刻**播种一次。分段模式每敲一个键都会重新校验，
 *   跟着回包重新播种的话，正在打字的那一格光标会被复位。
 * ⚠ 切回文本面**必须把选区重置到末尾**。旧选区下标指的是另一个字符串，不重置
 *   的话下一次从工具箱插入会静默吃掉开头几个字符。
 * ⚠ 文本一变**立刻熄绿灯**：错误、读法、记号树一起清掉，`validity` 发 false。
 *   「改完了还亮着绿灯」是最骗人的一种状态。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { DtButton, DtNotice, DtSegmented, DtTextarea } from '@dt/ui'

import FormulaBranchEditor from './FormulaBranchEditor.vue'
import FormulaReadback from './FormulaReadback.vue'
import FormulaToolbox from './FormulaToolbox.vue'
import FormulaTrial from './FormulaTrial.vue'
import {
  composeBranches,
  referencedKeys,
  splitBranches,
  type BranchDraft,
  type InsertPayload,
} from '../scripts/formulaText'
import { useTextInsertion } from '../scripts/useTextInsertion'
import { useFormulaCatalog } from '../scripts/useFormulaCatalog'
import { useFormulaValidation } from '../scripts/useFormulaValidation'

const FACES = [
  { value: 'text', label: '文本' },
  { value: 'branch', label: '分段' },
]

const props = defineProps<{
  tableId: string
  /** 正在编辑的那一列的 key；给了才做环检测。 */
  columnKey: string
  /** 这一列的单位，只用于试算结果的显示。 */
  unit: string
}>()

const emit = defineEmits<{ validity: [ok: boolean] }>()

const formula = defineModel<string>('formula', { required: true })

const {
  catalog,
  failure: catalogFailure,
  load,
} = useFormulaCatalog(() => props.tableId)
// 摊成顶层常量而不是留一个对象：模板只对顶层 ref 自动解包
const {
  status,
  error: checkError,
  failure: checkFailure,
  notation,
  readback,
  deps,
  isFresh,
  retest,
} = useFormulaValidation({
  tableId: () => props.tableId,
  columnKey: () => props.columnKey,
})

const area = ref<{ textareaEl?: HTMLTextAreaElement | null } | null>(null)
// ⚠ 必须真的绑上 `ref="branchFace"`：不绑的话分段面下从工具箱插入会**什么都不
// 做**，且不报任何错——看着就像工具箱在分段模式下坏了
const branchFace = ref<InstanceType<typeof FormulaBranchEditor> | null>(null)
const face = ref('text')
/** 分段面的草稿。切进去的那一刻播一次种，之后由它做主。 */
const draft = ref<BranchDraft>({ arms: [], otherwise: '', form: 'IF' })

const text = useTextInsertion(() => area.value?.textareaEl ?? null)

const used = computed(() => referencedKeys(formula.value))
const isOk = computed(() => status.value === 'ok' && isFresh(formula.value))
/** 工具箱要知道「现在选中了什么」；两种面的来源不同。 */
const activeSelection = computed(() =>
  face.value === 'branch'
    ? (branchFace.value?.selection ?? '')
    : text.selected(formula.value),
)
const sameRow = computed(() => deps.value?.same_row ?? [])

function onInput(next: string): void {
  formula.value = next
  text.sync()
}

/** 工具箱插入：文本面插进光标处，分段面插进最近聚焦的那一格。 */
async function onInsert(payload: InsertPayload): Promise<void> {
  if (face.value === 'branch') {
    await branchFace.value?.insert(payload.snippet, payload.caret)
    return
  }
  formula.value = await text.insert(formula.value, payload)
}

/**
 * 切进分段面。拆得开就按拆出来的各档播种；拆不开（不是分支公式、或者还没写完）
 * 就把现有公式整段放进「否则」再补一档空条件——现成的算式于是原地变成兜底那一支，
 * 不用重打一遍。
 * ⚠ 只在**切进来的这一刻**播种一次。
 */
function toBranchFace(): void {
  const split = splitBranches(formula.value)
  draft.value = split ?? {
    arms: [{ cond: '', value: '' }],
    otherwise: formula.value.trim(),
    form: 'IF',
  }
  face.value = 'branch'
}

/**
 * 切回文本面。**必须把选区重置到末尾**：旧下标指的是切进分段之前那份文本，
 * 而分段面已经把公式整条重拼过，旧下标落在新文本上指向完全不同的一段。
 */
function toTextFace(): void {
  text.moveToEnd(formula.value.length)
  face.value = 'text'
}

function onFace(next: string): void {
  if (next === 'branch') toBranchFace()
  else toTextFace()
}

/** 分段改动 → 拼回一行文本。删到一档不剩就不再是分支公式，退回文本面。 */
function onBranchChange(next: BranchDraft): void {
  draft.value = next
  if (next.arms.length === 0) {
    // 公式刚被换成「否则」那一档，旧选区同样对不上了
    formula.value = next.otherwise
    text.moveToEnd(next.otherwise.length)
    face.value = 'text'
    return
  }
  formula.value = composeBranches(next)
}

function clearAll(): void {
  formula.value = ''
  text.moveToEnd(0)
  face.value = 'text'
}

// ⚠ 文本一变就重排校验；`retest` 自己先熄灯，绿灯不会留在上一份结论上
watch(formula, (next) => retest(next))

/**
 * 能不能保存。
 * ⚠ `unavailable`（校验这条链路打不通）**放行**：「不知道对不对」不能读成
 * 「不对」，否则后端一抖谁也存不了公式列，而保存时后端还会再判一次。
 */
watch(
  () => [status.value, isFresh(formula.value)] as const,
  ([state, fresh]) =>
    emit('validity', state === 'unavailable' || (state === 'ok' && fresh)),
  { immediate: true },
)

onMounted(() => {
  void load()
  retest(formula.value)
})
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div class="flex items-center gap-2">
      <span class="text-2xs text-text-disabled">公式</span>
      <span class="flex-1"></span>
      <!-- 分段是同一条公式的另一种编辑面，不是另一套语法：切换本身不改公式 -->
      <DtSegmented
        :model-value="face"
        :options="FACES"
        size="sm"
        aria-label="编辑方式"
        @update:model-value="onFace"
      />
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="trash"
        :disabled="formula === ''"
        aria-label="清空公式"
        @click="clearAll"
      />
    </div>

    <DtTextarea
      v-if="face === 'text'"
      ref="area"
      :model-value="formula"
      :rows="3"
      size="sm"
      mono
      autosize
      spellcheck="false"
      aria-label="公式"
      placeholder="如：({进水量} - {出水量}) / 3600 —— 本表的列写 {列标识}，其他表写 {表标识.列标识}"
      @update:model-value="onInput"
      @click="text.sync()"
      @keyup="text.sync()"
      @select="text.sync()"
    />

    <template v-else>
      <FormulaBranchEditor
        ref="branchFace"
        :draft="draft"
        @change="onBranchChange"
      />
      <!-- 拼出来的那一行照样给看：落库的是它，不是各档 -->
      <p class="fe-composed">{{ formula }}</p>
    </template>

    <FormulaReadback
      :status="status"
      :error="checkError"
      :failure="checkFailure"
      :notation="notation"
      :readback="readback"
      :is-fresh="isOk"
    />

    <DtNotice v-if="catalogFailure" intent="warning" icon="alert-triangle">
      取不到函数目录（{{
        catalogFailure
      }}），快速插入这一片先不可用；公式照样能手写， 也照样由后端校验。
    </DtNotice>
    <FormulaToolbox
      v-else
      :catalog="catalog"
      :used="used"
      :selection="activeSelection"
      @insert="onInsert"
    />

    <FormulaTrial
      :table-id="props.tableId"
      :column-key="props.columnKey"
      :formula="formula"
      :same-row="sameRow"
      :columns="catalog?.columns ?? []"
      :ready="isOk"
      :unit="props.unit"
    />
  </div>
</template>

<style scoped>
/* 分段面下把拼出来的那一行如实显示：落库的是它，不是各档 */
.fe-composed {
  overflow-x: auto;
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  padding: 4px 8px;
  color: var(--text-disabled);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: pre;
}
</style>
