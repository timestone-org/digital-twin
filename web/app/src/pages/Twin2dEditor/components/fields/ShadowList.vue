<script setup lang="ts">
/**
 * @fileoverview 多层阴影的编辑面：每层一行（内外、偏移、模糊、扩散、颜色），可增删与调序。
 *
 * ⚠ 每层的 `id` 不许补也不许重：它是 `v-for` 的 key，也是归一化去重的依据——拿下标当
 *   key，改一层顺序就会让整列重建、输入焦点当场丢掉。
 * ⚠ 新层给的是一组**看得见**的初值而不是归一化缺省：缺省是全 0，加一层等于什么都没
 *   发生，用户只会以为按钮坏了。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { DtButton, DtCheckbox, DtNumberInput } from '@dt/ui'
import type { Twin2dShadow } from '@dt/twin2d'

import { TWIN_2D_PX_RANGE } from '../../scripts/inspectorFields'
import { freshTwin2dId, orderList } from '../../scripts/nodeOps'
import ColorField from './ColorField.vue'

const props = defineProps<{
  modelValue: readonly Twin2dShadow[]
  /** 空态那一行的说明；不给就只显示一个新增键。 */
  hint?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [readonly Twin2dShadow[]]
  blur: []
}>()

/** 阴影层 id 的前缀。 */
const ROW_PREFIX = 'shadow'

/** 与 `colorOr` 的兜底同一档：空串会让浏览器按 initial 取黑，看着像主题没生效。 */
const INHERITED_COLOR = 'currentColor'

/** 一层新阴影：一道朝下的软阴影，落地就看得见。 */
const NEW_SHADOW: Omit<Twin2dShadow, 'id'> = Object.freeze({
  inset: false,
  x: 0,
  y: 2,
  blur: 6,
  spread: 0,
  color: INHERITED_COLOR,
})

const BLUR_RANGE = { min: 0, step: 1 }

function write(next: readonly Twin2dShadow[]): void {
  emit('update:modelValue', next)
}

function patchRow(id: string, patch: Partial<Twin2dShadow>): void {
  write(
    props.modelValue.map((row) => (row.id === id ? { ...row, ...patch } : row)),
  )
}

function addRow(): void {
  const taken = new Set(props.modelValue.map((row) => row.id))
  write([
    ...props.modelValue,
    { ...NEW_SHADOW, id: freshTwin2dId(ROW_PREFIX, taken) },
  ])
}

function removeRow(id: string): void {
  write(props.modelValue.filter((row) => row.id !== id))
}

/** 往表头挪（画得更靠下）或往表尾挪（盖在别层上头）。 */
function moveRow(id: string, up: boolean): void {
  write(orderList(props.modelValue, [id], up ? 'backward' : 'forward'))
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <p
      v-if="modelValue.length === 0 && hint"
      class="text-xs text-text-disabled"
    >
      {{ hint }}
    </p>

    <div
      v-for="(row, index) in modelValue"
      :key="row.id"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      :data-test="`shadow-row-${row.id}`"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          第 {{ index + 1 }} 层
        </span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-up"
          :disabled="index === 0"
          aria-label="上移这一层"
          title="上移这一层"
          :data-test="`shadow-up-${row.id}`"
          @click="moveRow(row.id, true)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="chevron-down"
          :disabled="index === modelValue.length - 1"
          aria-label="下移这一层"
          title="下移这一层"
          :data-test="`shadow-down-${row.id}`"
          @click="moveRow(row.id, false)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除这一层"
          title="删除这一层"
          :data-test="`shadow-remove-${row.id}`"
          @click="removeRow(row.id)"
        />
      </div>

      <DtCheckbox
        :model-value="row.inset"
        label="内阴影"
        :data-test="`shadow-inset-${row.id}`"
        @update:model-value="patchRow(row.id, { inset: $event })"
      />

      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="row.x"
          :range="TWIN_2D_PX_RANGE"
          label="横偏移"
          unit="px"
          size="sm"
          :steppers="false"
          :data-test="`shadow-x-${row.id}`"
          @update:model-value="patchRow(row.id, { x: $event ?? 0 })"
        />
        <DtNumberInput
          :model-value="row.y"
          :range="TWIN_2D_PX_RANGE"
          label="纵偏移"
          unit="px"
          size="sm"
          :steppers="false"
          :data-test="`shadow-y-${row.id}`"
          @update:model-value="patchRow(row.id, { y: $event ?? 0 })"
        />
        <DtNumberInput
          :model-value="row.blur"
          :range="BLUR_RANGE"
          label="模糊"
          unit="px"
          size="sm"
          :steppers="false"
          :data-test="`shadow-blur-${row.id}`"
          @update:model-value="patchRow(row.id, { blur: $event ?? 0 })"
        />
        <DtNumberInput
          :model-value="row.spread"
          :range="TWIN_2D_PX_RANGE"
          label="扩散"
          unit="px"
          size="sm"
          :steppers="false"
          :data-test="`shadow-spread-${row.id}`"
          @update:model-value="patchRow(row.id, { spread: $event ?? 0 })"
        />
      </div>

      <ColorField
        :model-value="row.color"
        :fallback="INHERITED_COLOR"
        label="颜色"
        @update:model-value="patchRow(row.id, { color: $event })"
      />
    </div>

    <DtButton
      size="sm"
      variant="soft"
      intent="neutral"
      icon="plus"
      block
      data-test="shadow-add"
      @click="addRow"
    >
      新增一层阴影
    </DtButton>
  </div>
</template>
