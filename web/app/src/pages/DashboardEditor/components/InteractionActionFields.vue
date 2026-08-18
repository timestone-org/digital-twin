<script setup lang="ts">
/**
 * @fileoverview 按动作类型出编辑面：显隐三档给目标多选，互斥切换给「值 + 目标」
 * 的组列表，弹窗给内容节点与标题，两档跳转给大屏选择器，关闭弹窗没有字段。
 * 改完整条动作上抛。
 *
 * ⚠ 跳转的目标只能从**本项目的大屏**里挑（`dashboard-ref` 控件），不是一个能填
 * 任意地址的框：能配 URL 的大屏等于一个站内跳板（开放重定向）。
 */
import { computed } from 'vue'
import type {
  DtSelectOption,
  InteractionAction,
  InteractionNavigateByValueAction,
} from '@dt/contracts'
import { DtButton, DtField, DtInput, DtNotice, DtSelect } from '@dt/ui'

import DashboardRefControl from '@/features/dashboard/controls/DashboardRefControl.vue'
import InteractionTargetPicker from './InteractionTargetPicker.vue'
import InteractionValueRoutes from './InteractionValueRoutes.vue'
import { NAVIGATE_TARGET_FIELD } from '../scripts/interactionOptions'
import { useRowKeys } from '../scripts/rowKeys'

type ActiveGroup = { value: string; targets: string[] }
type ValueRoute = InteractionNavigateByValueAction['routes'][number]

const props = defineProps<{
  action: InteractionAction
  targetOptions: readonly DtSelectOption[]
}>()

const emit = defineEmits<{ update: [action: InteractionAction] }>()

const targets = computed<readonly string[]>(() =>
  'targets' in props.action ? props.action.targets : [],
)

const groups = computed<readonly ActiveGroup[]>(() =>
  props.action.type === 'setActive' ? props.action.groups : [],
)

const routes = computed<readonly ValueRoute[]>(() =>
  props.action.type === 'navigateByValue' ? props.action.routes : [],
)

const modalTarget = computed(() =>
  props.action.type === 'openModal' ? props.action.target : '',
)

const modalTitle = computed(() =>
  props.action.type === 'openModal' ? (props.action.title ?? '') : '',
)

const navigateTarget = computed(() =>
  props.action.type === 'navigate' ? props.action.target : '',
)

const groupKeys = useRowKeys(() => groups.value.length)

const groupRows = computed(() =>
  groups.value.map((group, index) => ({
    key: groupKeys.keys.value[index] ?? `group-${index}`,
    group,
  })),
)

function setTargets(next: string[]): void {
  const type = props.action.type
  if (type !== 'show' && type !== 'hide' && type !== 'toggle') return
  emit('update', { type, targets: next })
}

function writeGroups(next: ActiveGroup[]): void {
  emit('update', { type: 'setActive', groups: next })
}

function addGroup(): void {
  writeGroups([...groups.value, { value: '', targets: [] }])
}

function removeGroup(key: string): void {
  const index = groupKeys.indexOf(key)
  if (index < 0) return
  groupKeys.removeAt(index)
  writeGroups(groups.value.filter((_group, at) => at !== index))
}

function patchGroup(key: string, patch: Partial<ActiveGroup>): void {
  const index = groupKeys.indexOf(key)
  if (index < 0) return
  writeGroups(
    groups.value.map((group, at) =>
      at === index ? { ...group, ...patch } : group,
    ),
  )
}

function onGroupValue(key: string, value: string): void {
  patchGroup(key, { value })
}

function onGroupTargets(key: string, next: string[]): void {
  patchGroup(key, { targets: next })
}

function writeRoutes(next: ValueRoute[]): void {
  emit('update', { type: 'navigateByValue', routes: next })
}

function onModalTarget(target: string): void {
  if (props.action.type !== 'openModal') return
  emit('update', { ...props.action, target })
}

/** 标题留空 = 不渲染标题栏，故整个键删掉而不是存空串。 */
function onModalTitle(raw: string): void {
  if (props.action.type !== 'openModal') return
  const title = raw.trim()
  emit('update', {
    type: 'openModal',
    target: props.action.target,
    ...(title === '' ? {} : { title }),
  })
}

function onNavigateTarget(raw: unknown): void {
  emit('update', {
    type: 'navigate',
    target: typeof raw === 'string' ? raw : '',
  })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <InteractionTargetPicker
      v-if="
        action.type === 'show' ||
        action.type === 'hide' ||
        action.type === 'toggle'
      "
      label="目标节点"
      :targets="targets"
      :options="targetOptions"
      @update:targets="setTargets"
    />
    <template v-else-if="action.type === 'setActive'">
      <div
        v-for="row in groupRows"
        :key="row.key"
        class="flex flex-col gap-1"
        data-test="ix-group"
      >
        <div class="flex items-end gap-2">
          <DtInput
            size="sm"
            label="选中值"
            :model-value="row.group.value"
            placeholder="控件上抛的值"
            data-test="ix-group-value"
            @update:model-value="onGroupValue(row.key, $event)"
          />
          <DtButton
            size="sm"
            variant="ghost"
            intent="danger"
            icon="trash"
            aria-label="删除这一组"
            data-test="ix-group-remove"
            @click="removeGroup(row.key)"
          />
        </div>
        <InteractionTargetPicker
          label="选中时显示"
          :targets="row.group.targets"
          :options="targetOptions"
          @update:targets="onGroupTargets(row.key, $event)"
        />
      </div>
      <DtButton
        size="sm"
        variant="outline"
        icon="plus"
        data-test="ix-group-add"
        @click="addGroup"
      >
        添加一组
      </DtButton>
    </template>
    <template v-else-if="action.type === 'openModal'">
      <DtSelect
        size="sm"
        label="弹窗内容节点"
        :model-value="modalTarget"
        :options="targetOptions"
        aria-label="弹窗内容节点"
        @update:model-value="onModalTarget"
      />
      <DtInput
        size="sm"
        label="弹窗标题"
        :model-value="modalTitle"
        placeholder="留空则不显示标题栏"
        data-test="ix-modal-title"
        @update:model-value="onModalTitle"
      />
    </template>
    <template v-else-if="action.type === 'navigate'">
      <DtField label="目标大屏" size="sm">
        <DashboardRefControl
          :field="NAVIGATE_TARGET_FIELD"
          :value="navigateTarget"
          data-test="ix-navigate-target"
          @update="onNavigateTarget"
        />
      </DtField>
      <DtNotice
        v-if="navigateTarget === ''"
        intent="warning"
        icon="alert-triangle"
      >
        还没挑目标，这条规则点了不会跳。
      </DtNotice>
    </template>
    <InteractionValueRoutes
      v-else-if="action.type === 'navigateByValue'"
      :routes="routes"
      @update="writeRoutes"
    />
    <p v-else class="m-0 text-2xs text-text-disabled">
      关闭当前弹窗，不需要额外字段。
    </p>
  </div>
</template>
