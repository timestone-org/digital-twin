<script setup lang="ts">
/**
 * @fileoverview 新建样式：先定「这条样式管哪一层」，再取个名。
 *
 * ⚠ 归属定了就不能改：改了内芯那一整段键就整片作废——一个模块的观感键写到
 * 另一个模块上，既不报错也不生效。要换归属就复制一份，所以这一步单独问一次。
 */
import type { DtRadioOption } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtRadioGroup } from '@dt/ui'
import { computed, ref, watch } from 'vue'

/** 通用外壳那一档在单选里的取值。⚠ 空串不行：单选组按值比较，空串等于没选。 */
const GENERIC = 'generic'

const props = defineProps<{
  modelValue: boolean
  /** 可选的模块归属：`{ value: 模块类型, label: 中文名 }`。 */
  moduleOptions: readonly { value: string; label: string }[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  create: [moduleType: string | null, name: string]
}>()

const scope = ref(GENERIC)
const name = ref('')

const options = computed<DtRadioOption[]>(() => [
  { value: GENERIC, label: '通用外壳样式' },
  ...props.moduleOptions.map((one) => ({ value: one.value, label: one.label })),
])

/** 选中那一档的一句话。⚠ 单选项自己放不下说明，放这里比不说强。 */
const scopeHint = computed(() =>
  scope.value === GENERIC
    ? '只写外壳（边框 / 四角 / 标题条 / 字体），套到任何模块上都生效'
    : '外壳 + 这个模块自己的观感，只能套回同类型的节点',
)

const canCreate = computed(() => name.value.trim() !== '')

// 每次打开都从头问：留着上一次的选择，用户会以为自己已经选过了
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    scope.value = GENERIC
    name.value = ''
  },
)

function submit(): void {
  if (!canCreate.value) return
  emit(
    'create',
    scope.value === GENERIC ? null : scope.value,
    name.value.trim(),
  )
  emit('update:modelValue', false)
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    title="新建样式"
    description="归属定了就不能改——要换归属请复制一份"
    width="26rem"
    :dirty="canCreate"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtRadioGroup
        v-model="scope"
        label="这条样式管哪一层"
        :hint="scopeHint"
        :options="options"
      />
      <DtInput v-model="name" label="样式名称" size="sm" required />
    </div>
    <template #footer>
      <DtButton variant="ghost" @click="emit('update:modelValue', false)">
        取消
      </DtButton>
      <DtButton :disabled="!canCreate" @click="submit">新建</DtButton>
    </template>
  </DtModal>
</template>
