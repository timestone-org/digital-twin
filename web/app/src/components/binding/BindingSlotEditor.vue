<script setup lang="ts">
/**
 * @fileoverview 一个绑定槽的一行：选来源、填取值、解绑。
 * ⚠ 换来源要把上一种来源的取值一起清掉：留着的话服务端看到的是「opcua 绑定却
 * 带着 compute_json」，那是一条它无从判断该信哪个的记录。
 */
import type {
  BindingPayload,
  BindingSourceKind,
  DtSelectOption,
} from '@dt/contracts'
import { BINDING_SOURCE_KINDS } from '@dt/contracts'
import { DtButton, DtField, DtSelect } from '@dt/ui'

import type { BindingSlotRow } from '@/features/dashboard/bindingSlots'
import BindingSourceEditor from './BindingSourceEditor.vue'

const props = defineProps<{
  row: BindingSlotRow
  binding: BindingPayload | null
  /** 同节点内其它槽的 fieldKey，派生绑定从中挑输入。 */
  siblingKeys: readonly string[]
}>()

const emit = defineEmits<{
  write: [binding: BindingPayload]
  drop: [fieldKey: string]
  bind: [fieldKey: string]
  pick: [fieldKey: string]
}>()

/** 五种来源的中文名。⚠ 逐档铺满：漏一档这份 Record 编译不过。 */
const SOURCE_LABELS: Record<BindingSourceKind, string> = {
  opcua: '实时点位',
  static: '常量',
  computed: '派生',
  archive: '点位历史',
  dataset: '数据台账',
}

const SOURCE_OPTIONS: readonly DtSelectOption[] = BINDING_SOURCE_KINDS.map(
  (kind) => ({ value: kind, label: SOURCE_LABELS[kind] }),
)

function changeKind(raw: string): void {
  const current = props.binding
  const kind = BINDING_SOURCE_KINDS.find((item) => item === raw)
  if (current === null || kind === undefined) return
  emit('write', {
    ...current,
    sourceKind: kind,
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
  })
}
</script>

<template>
  <DtField :label="row.fieldKey" :hint="row.spec.label" size="sm">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <template v-if="binding">
          <!-- 宽度钉死：跟着「常量」/「历史序列」的字数伸缩的话，
               换一次来源整行控件就横着跳一次 -->
          <DtSelect
            class="w-28 shrink-0"
            :model-value="binding.sourceKind"
            :options="SOURCE_OPTIONS"
            size="sm"
            aria-label="数据来源"
            @update:model-value="changeKind"
          />
          <DtButton
            class="ml-auto"
            size="sm"
            variant="ghost"
            intent="danger"
            icon="trash"
            aria-label="解除绑定"
            @click="emit('drop', row.fieldKey)"
          />
        </template>
        <DtButton
          v-else
          size="sm"
          variant="outline"
          icon="plus"
          @click="emit('bind', row.fieldKey)"
        >
          绑定
        </DtButton>
      </div>
      <BindingSourceEditor
        v-if="binding"
        :spec="row.spec"
        :binding="binding"
        :sibling-keys="siblingKeys"
        @write="emit('write', $event)"
        @pick="emit('pick', row.fieldKey)"
      />
    </div>
  </DtField>
</template>
