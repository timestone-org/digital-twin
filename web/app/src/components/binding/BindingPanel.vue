<script setup lang="ts">
/**
 * @fileoverview 绑点面板：按绑定槽声明自动摆槽位，数组槽摆成 N 行，
 * 行名与行 id 可由调用方按 `fieldKey` 指定。
 *
 * ⚠ 面板里没有任何模块类型字面量，也不认识「大屏节点」——入参只有
 * 「槽声明 + 当前绑定」两样。所以它既服务大屏编辑器的右栏，也服务孪生
 * 子编辑器的绑定页；将来任何一个自己持有绑定的编辑面都能直接装上
 * （DASHBOARD_DESIGN §5.2）。
 *
 * 数组槽有两种行数来源：不给 `rowCounts` 时行由用户手工增删（大屏右栏的老口径），
 * 给了就是**行与实体一一对应**，增删跟着实体走、面板上不摆增删键。
 */
import type {
  BindingPayload,
  BindingRowLabel,
  BindingSpec,
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
  /** 要摆哪些槽位；空数组 = 这个面不取数。 */
  specs: readonly BindingSpec[]
  /** 当前这一份绑定。 */
  bindings: readonly BindingPayload[]
  /**
   * 数组槽每一行的名字与 id，键是该行第一个子槽的 `fieldKey`。
   * 不给就退回「第 N 行」。
   */
  rowLabels?: Readonly<Record<string, BindingRowLabel>> | undefined
  /**
   * 某个数组槽应有几行，键是槽键。给了就表示行与实体一一对应。
   * ⚠ 仍会把**超出这个行数**的存量绑定摆出来并标成孤行：藏起来的话，
   * 那几条绑定既看不见也删不掉，而它们永远喂不到任何东西。
   */
  rowCounts?: Readonly<Record<string, number>> | undefined
}>()

const emit = defineEmits<{
  write: [binding: BindingPayload]
  drop: [fieldKey: string]
  bind: [fieldKey: string]
  pick: [fieldKey: string]
  addRow: [slotKey: string]
  removeRow: [slotKey: string, rowIndex: number]
}>()

/** 面板上的一组：标题、给人核对用的 id，与组内各行。 */
interface PanelGroup extends BindingSlotGroup {
  /** 与实体清单里逐字相同的标识；空串 = 这一组没有可核对的 id。 */
  entityId: string
  /** 这一行没有对应实体：绑了也喂不到任何东西，只能删。 */
  isOrphan: boolean
  /** 这一行摆不摆删除键。 */
  canRemove: boolean
}

interface SlotSection {
  spec: BindingSpec
  /** 行数跟着实体走，面板上不摆「新增一行」。 */
  isPinned: boolean
  groups: readonly PanelGroup[]
}

/** 一组对应的行标识；组的键是这一组第一个子槽的 `fieldKey`。 */
function labelOf(group: BindingSlotGroup): BindingRowLabel | undefined {
  const first = group.rows[0]
  return first === undefined ? undefined : props.rowLabels?.[first.fieldKey]
}

/** 一个数组槽摆几行：钉死的行数与存量绑定的行数取大者。 */
function rowCountOf(spec: BindingSpec, pinned: number | undefined): number {
  const loose = arrayRowCount(props.bindings, spec.key)
  return pinned === undefined ? loose : Math.max(pinned, loose)
}

/** 普通槽只有一组、没有组标题，也就没有行名、行 id 与增删。 */
const PLAIN_ROW = { entityId: '', isOrphan: false, canRemove: false } as const

function groupOf(
  group: BindingSlotGroup,
  pinned: number | undefined,
): PanelGroup {
  if (group.title === null) return { ...group, ...PLAIN_ROW }
  const label = labelOf(group)
  const isOrphan = pinned !== undefined && (group.rowIndex ?? 0) >= pinned
  return {
    ...group,
    // 调用方给了这一行的名字就用它，取不到才回落「第 N 行」
    title: label?.title ?? group.title,
    entityId: label?.id ?? '',
    isOrphan,
    // 行跟着实体走时只有孤行能删：删一行正常行只会让它后面的整体前移，
    // 于是那之后的每一条绑定都改喂前一个实体，而界面上看不出来
    canRemove: pinned === undefined || isOrphan,
  }
}

function groupsOf(spec: BindingSpec, pinned: number | undefined): PanelGroup[] {
  return slotGroups(spec, rowCountOf(spec, pinned)).map((group) =>
    groupOf(group, pinned),
  )
}

const sections = computed<SlotSection[]>(() =>
  props.specs.map((spec) => {
    const pinned = props.rowCounts?.[spec.key]
    return {
      spec,
      isPinned: pinned !== undefined,
      groups: groupsOf(spec, pinned),
    }
  }),
)

const siblingKeys = computed(() =>
  props.bindings.map((binding) => binding.fieldKey),
)

function bindingOf(fieldKey: string): BindingPayload | null {
  return props.bindings.find((item) => item.fieldKey === fieldKey) ?? null
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
    <DtEmpty
      v-if="specs.length === 0"
      icon="activity"
      title="这个面不取数"
      hint="它没有声明任何绑定槽"
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
            v-if="section.spec.isArray && !section.isPinned"
            size="sm"
            variant="outline"
            icon="plus"
            @click="emit('addRow', section.spec.key)"
          >
            新增一行
          </DtButton>
        </header>

        <p
          v-if="section.spec.isArray && section.groups.length === 0"
          class="text-2xs text-text-disabled"
        >
          还没有可绑的行。
        </p>

        <div
          v-for="group in section.groups"
          :key="group.rowIndex ?? section.spec.key"
          class="flex flex-col gap-2"
        >
          <!-- ⚠ 判 `!== null` 不判真假：行名给成空串时按真假判会把删除键一起藏掉，
               那一行就再也删不掉了 -->
          <div
            v-if="group.title !== null"
            class="flex items-start justify-between gap-2"
          >
            <div class="flex min-w-0 flex-col">
              <span class="truncate text-2xs text-text-disabled">
                {{ group.title }}
              </span>
              <!-- 与实体清单上显示的 id 逐字相同：绑第 7 行时靠它确认绑的是谁 -->
              <span
                v-if="group.entityId !== ''"
                class="truncate font-mono text-2xs text-text-disabled"
                :title="group.entityId"
              >
                {{ group.entityId }}
              </span>
              <span v-if="group.isOrphan" class="text-2xs text-state-danger">
                没有对应的实体，这一行喂不到任何东西
              </span>
            </div>
            <DtButton
              v-if="group.canRemove"
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
