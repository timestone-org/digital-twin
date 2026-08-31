<script setup lang="ts">
/**
 * @fileoverview 部件的从属：挂在哪个部件下面，以及它自己收着哪几个。
 *
 * ⚠ 上级下拉里**不列自己、也不列自己的后代**：环在这里就配不出来。诊断那几条
 * 是给手改 JSON 与导入配置兜底的，不是主路径。
 * ⚠ 层级与大纲的文件夹是两回事：文件夹是编辑器里的收纳，层级是运行态里父件
 * 详情弹窗左栏的那份装配清单。两者互不影响，也不互相校验。
 */
import type { TwinPart } from '@dt/twin-config'
import { partAssembly, partChildren } from '@dt/twin-config'
import { DtButton, DtField, DtNotice, DtSelect } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  /** 当前这个部件。 */
  modelValue: TwinPart
  /** 全部部件；候选与子件清单都从它来。 */
  parts: readonly TwinPart[]
}>()

const emit = defineEmits<{
  'update:modelValue': [TwinPart]
  /** 跳到另一个部件。 */
  selectPart: [partId: string]
}>()

/** 名字空着退回 id：一行没有任何标识比显示 id 更糟。 */
function labelOf(part: TwinPart): string {
  return part.name === '' ? part.id : part.name
}

/** 自己与自己的后代都不能当上级，否则就成环了。 */
const banned = computed(
  () =>
    new Set(
      partAssembly(props.parts, props.modelValue.id).map(
        (node) => node.part.id,
      ),
    ),
)

const parentOptions = computed(() => [
  { value: '', label: '（顶层）' },
  ...props.parts
    .filter((part) => !banned.value.has(part.id))
    .map((part) => ({ value: part.id, label: labelOf(part) })),
])

const children = computed(() => partChildren(props.parts, props.modelValue.id))

/** 上级指到一个不存在的部件：运行态当顶层，配置里却明明写着。 */
const dangling = computed(() => {
  const parentId = props.modelValue.parentId
  if (parentId === '') return false
  return !props.parts.some((part) => part.id === parentId)
})

/** 收着子件，自己却不弹详情：这些子件在运行态点不出来。 */
const childrenUnreachable = computed(
  () => children.value.length > 0 && props.modelValue.click.near !== 'detail',
)

const unreachableText = computed(
  () =>
    `这个部件收着 ${children.value.length} 个子件，但它自己的近距点击不弹详情，装配栏在运行态点不出来。`,
)
</script>

<template>
  <div class="flex flex-col gap-3">
    <DtField
      label="上级部件"
      size="sm"
      hint="挂上之后，点开上级的详情能在左栏切到这一个。"
    >
      <DtSelect
        :model-value="modelValue.parentId"
        :options="parentOptions"
        aria-label="上级部件"
        size="sm"
        @update:model-value="
          emit('update:modelValue', { ...modelValue, parentId: $event })
        "
      />
    </DtField>
    <DtNotice v-if="dangling" intent="danger" icon="alert-circle">
      找不到部件 {{ modelValue.parentId }}，这个部件会当顶层处理。
    </DtNotice>

    <DtField
      v-if="children.length > 0"
      :label="`子件（${children.length}）`"
      size="sm"
    >
      <div class="flex flex-wrap gap-1">
        <DtButton
          v-for="child in children"
          :key="child.id"
          variant="soft"
          size="xs"
          :data-test="`part-child-${child.id}`"
          @click="emit('selectPart', child.id)"
        >
          {{ labelOf(child) }}
        </DtButton>
      </div>
    </DtField>
    <DtNotice v-if="childrenUnreachable" intent="warning" icon="alert-triangle">
      {{ unreachableText }}
    </DtNotice>
    <p v-if="children.length === 0" class="text-xs text-text-disabled">
      还没有部件挂在它下面。挂法是选中那个部件，把它的「上级部件」指到这里。
    </p>
  </div>
</template>
