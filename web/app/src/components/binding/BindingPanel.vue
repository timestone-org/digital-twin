<script setup lang="ts">
/**
 * @fileoverview 绑点面板：读模块清单的 `bindings` 自动摆槽位，数组槽摆成 N 行，
 * 行名可由调用方按 `fieldKey` 指定。
 * ⚠ 面板里没有任何模块类型字面量——槽位完全来自清单声明，
 * 新增模块自动获得绑点面板（DASHBOARD_DESIGN §5.2）。
 */
import type {
  BindingPayload,
  BindingSpec,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { DtButton, DtEmpty, DtTag } from '@dt/ui'
import { computed } from 'vue'

import {
  arrayRowCount,
  slotGroups,
  type BindingSlotGroup,
} from '@/features/dashboard/bindingSlots'
import BindingSlotEditor from './BindingSlotEditor.vue'

const props = defineProps<{
  node: DashboardNodePayload | null
  manifest: ModuleManifest | undefined
  /**
   * 数组槽每一行的显示名，键是该行第一个子槽的 `fieldKey`。
   * 不给就退回「第 N 行」。
   */
  rowLabels?: Readonly<Record<string, string>>
}>()

const emit = defineEmits<{
  write: [binding: BindingPayload]
  drop: [fieldKey: string]
  bind: [fieldKey: string]
  pick: [fieldKey: string]
  addRow: [slotKey: string]
  removeRow: [slotKey: string, rowIndex: number]
}>()

interface SlotSection {
  spec: BindingSpec
  groups: readonly BindingSlotGroup[]
}

const specs = computed<readonly BindingSpec[]>(
  () => props.manifest?.bindings ?? [],
)

const bindings = computed<readonly BindingPayload[]>(
  () => props.node?.bindings ?? [],
)

/**
 * 一组的标题：调用方给了这一行的名字就用它，取不到才回落「第 N 行」。
 * @param group 一个数组槽的一行（普通槽无标题）
 */
function titleOf(group: BindingSlotGroup): string | null {
  if (group.title === null) return null
  const first = group.rows[0]
  const named =
    first === undefined ? undefined : props.rowLabels?.[first.fieldKey]
  return named ?? group.title
}

const sections = computed<SlotSection[]>(() =>
  specs.value.map((spec) => ({
    spec,
    groups: slotGroups(spec, arrayRowCount(bindings.value, spec.key)).map(
      (group) => ({ ...group, title: titleOf(group) }),
    ),
  })),
)

const siblingKeys = computed(() =>
  bindings.value.map((binding) => binding.fieldKey),
)

function bindingOf(fieldKey: string): BindingPayload | null {
  return bindings.value.find((item) => item.fieldKey === fieldKey) ?? null
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
    <DtEmpty
      v-if="!node"
      icon="activity"
      title="没有选中节点"
      hint="选中一个节点后在这里绑数据"
    />
    <DtEmpty
      v-else-if="specs.length === 0"
      icon="activity"
      title="这个模块不取数"
      hint="它的清单里没有声明绑定槽"
    />
    <template v-else>
      <section
        v-for="section in sections"
        :key="section.spec.key"
        class="flex flex-col gap-2 rounded border border-border-subtle p-2"
      >
        <header class="flex items-center gap-2">
          <span class="flex-1 truncate text-xs text-text-primary">
            {{ section.spec.label }}
          </span>
          <DtTag v-if="section.spec.isRequired" size="sm" intent="warning">
            必绑
          </DtTag>
          <DtButton
            v-if="section.spec.isArray"
            size="sm"
            variant="outline"
            icon="plus"
            @click="emit('addRow', section.spec.key)"
          >
            新增一行
          </DtButton>
        </header>

        <div
          v-for="group in section.groups"
          :key="group.rowIndex ?? section.spec.key"
          class="flex flex-col gap-2"
        >
          <!-- ⚠ 判 `!== null` 不判真假：行名给成空串时按真假判会把删除键一起藏掉，
               那一行就再也删不掉了 -->
          <div
            v-if="group.title !== null"
            class="flex items-center justify-between"
          >
            <span class="text-2xs text-text-disabled">{{ group.title }}</span>
            <DtButton
              size="sm"
              variant="ghost"
              intent="danger"
              icon="trash"
              aria-label="删除这一行"
              @click="emit('removeRow', section.spec.key, group.rowIndex ?? 0)"
            />
          </div>
          <BindingSlotEditor
            v-for="row in group.rows"
            :key="row.fieldKey"
            :row="row"
            :binding="bindingOf(row.fieldKey)"
            :sibling-keys="siblingKeys"
            @write="emit('write', $event)"
            @drop="emit('drop', $event)"
            @bind="emit('bind', $event)"
            @pick="emit('pick', $event)"
          />
        </div>
      </section>
    </template>
  </div>
</template>
