<script setup lang="ts">
/**
 * @fileoverview 新建 / 编辑库公式的弹窗：标识、名称、分类、形参表与公式体。
 *
 * ⚠ 调用标识只在新建时可填：它就是调用点上的那个字面量，改一次等于让每一处
 * `@旧标识(…)` 当场解析失败，后端的补丁入参里因此根本没有这一项。
 * ⚠ 保存键**不吊在任何校验结论上**：库公式没有校验端点（一条公式体离开形参
 * 无法单独解析，docs/DATASET_DESIGN.md §5.11），写不写得通由保存那一次的 400
 * 说了算。吊在结论上的写法有个必现的死角——重开同一条、一个字不改，那一轮
 * 校验永远不触发，于是保存键永远点不动。
 * ⚠ 启用开关不在这张表单里：停用是一次会被后端 409 拦下的独立动作，混进来会
 * 让「改个名字」被一句「还有 3 个台账列在用它」挡下。
 */
import { computed, ref, watch } from 'vue'
import type { DatasetFormulaDef } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtSelect,
  DtTextarea,
} from '@dt/ui'

import * as formulas from '@/api/datasetFormulas'
import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'
import { useFormDirty } from '@/composables/useFormDirty'

import FormulaParamRows from './FormulaParamRows.vue'
import {
  CODE_MAX,
  DESCRIPTION_MAX,
  EXPRESSION_MAX,
  NAME_MAX,
  blankParam,
  formStateOf,
  hasError,
  isSemanticChange,
  toCreateInput,
  toPatchInput,
  validateFormulaForm,
  type FormulaFormErrors,
  type FormulaFormState,
  type ParamDraft,
} from '../scripts/formulaForm'
import { categoryOptions, savedMessage } from '../scripts/formulaView'

const NO_ERRORS: FormulaFormErrors = {
  code: '',
  name: '',
  expression: '',
  params: '',
}

const props = defineProps<{
  modelValue: boolean
  formula: DatasetFormulaDef | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [message: string]
}>()

// 行号只在本次会话内唯一即可——它只用来当 v-for 的 key
let rowSeed = 0
const nextRowId = (): string => `p${(rowSeed += 1)}`

const code = ref('')
const name = ref('')
const category = ref('')
const expression = ref('')
const description = ref('')
const params = ref<ParamDraft[]>([])
const errors = ref<FormulaFormErrors>(NO_ERRORS)
/** 后端说公式写不通那一句，落在「公式体」那一格上。 */
const rejected = ref('')
const failure = ref<string | null>(null)
const busy = ref(false)

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  [code, name, category, expression, description, params],
  () => props.modelValue,
)

const isEdit = computed(() => props.formula !== null)
const state = computed<FormulaFormState>(() => ({
  code: code.value,
  name: name.value,
  category: category.value,
  expression: expression.value,
  description: description.value,
  params: params.value,
}))
const categoryList = computed(() => categoryOptions(category.value))
// 值形参落在字面量位上时，后端那句报错指的是样例调用而不是公式体本身
const hasValueParam = computed(() =>
  params.value.some((param) => param.kind === 'value'),
)

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetTo(props.formula)
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载时，只监听变化的 watch 一次
  // 都不会跑，表单会是空的
  { immediate: true },
)

function resetTo(formula: DatasetFormulaDef | null): void {
  const next = formStateOf(formula, nextRowId)
  errors.value = NO_ERRORS
  rejected.value = ''
  failure.value = null
  code.value = next.code
  name.value = next.name
  category.value = next.category
  expression.value = next.expression
  description.value = next.description
  params.value = next.params
}

/** 标识被占用是一句**指向某一格**的话，公式写不通同理。 */
function showFailure(caught: unknown): void {
  if (caught instanceof BizError) {
    if (caught.code === ERROR_CODES.datasetFormulaCodeTaken) {
      errors.value = { ...errors.value, code: '这个标识已被占用，换一个' }
      return
    }
    if (caught.code === ERROR_CODES.datasetFormulaInvalid) {
      rejected.value = caught.message
      return
    }
  }
  failure.value = describeError(caught)
}

async function save(): Promise<void> {
  const target = props.formula
  if (target === null) {
    const created = await formulas.createDatasetFormula(
      toCreateInput(state.value),
    )
    emit(
      'saved',
      `库公式「${created.name}」已创建，台账列里写 @${created.code}(…) 调用它`,
    )
    return
  }
  const updated = await formulas.updateDatasetFormula(
    target.id,
    toPatchInput(state.value),
  )
  emit(
    'saved',
    savedMessage(updated.usages, isSemanticChange(target, state.value)),
  )
}

async function onSubmit(): Promise<void> {
  const found = validateFormulaForm(state.value, isEdit.value)
  errors.value = found
  if (hasError(found)) return
  busy.value = true
  rejected.value = ''
  failure.value = null
  try {
    await save()
    emit('update:modelValue', false)
  } catch (caught) {
    showFailure(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    :dirty="isDirty"
    :title="isEdit ? `编辑库公式 ${props.formula?.code}` : '新建库公式'"
    description="公式在这里定义一次，台账列里写 @标识(实参) 就能调用"
    width="46rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <DtNotice v-if="isEdit" intent="warning" icon="alert-triangle">
        改动即刻对所有引用它的台账列生效，历史行要等各自的台账重算之后才跟上。
        改之前先看一眼「引用」。
      </DtNotice>

      <div class="grid grid-cols-2 gap-3">
        <DtInput
          v-model="name"
          label="名称"
          required
          :error="errors.name"
          :maxlength="NAME_MAX"
        />
        <DtInput
          v-model="code"
          label="调用标识"
          required
          :disabled="isEdit"
          :error="errors.code"
          :maxlength="CODE_MAX"
          :hint="
            isEdit
              ? '建后不可改：每一处 @标识(…) 都照着它解析'
              : '公式里写作 @标识(实参)，全局唯一；中文可用'
          "
        />
        <DtSelect
          :model-value="category"
          label="分类"
          :options="categoryList"
          hint="列表按分类分组"
          @update:model-value="category = $event"
        />
      </div>

      <FormulaParamRows
        :params="params"
        :error="errors.params"
        :disabled="busy"
        @update="params = $event"
        @add="params = [...params, blankParam(nextRowId())]"
      />

      <DtTextarea
        v-model="expression"
        label="公式体"
        mono
        required
        :rows="3"
        :error="errors.expression || rejected"
        :maxlength="EXPRESSION_MAX"
        hint="只能引用上面声明的形参，写作 {形参名}；不能写死某张台账的列"
      />

      <!-- 缺默认值的报错指向的是校验用的样例调用，不是公式体——不说这一句，
           用户会照着报错去改一个没有错的地方 -->
      <DtNotice v-if="rejected && hasValueParam" intent="info">
        报错若指向时间窗或期数必须是字面量，多半是某个取值形参没填默认值：
        校验拿默认值代入样例调用，缺了就走不到公式本身。
      </DtNotice>

      <DtTextarea
        v-model="description"
        label="说明"
        :maxlength="DESCRIPTION_MAX"
        hint="这条公式算的是什么、口径来源"
      />

      <DtNotice v-if="failure" intent="danger">{{ failure }}</DtNotice>
    </form>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton :loading="busy" @click="onSubmit">保存</DtButton>
    </template>
  </DtModal>
</template>
