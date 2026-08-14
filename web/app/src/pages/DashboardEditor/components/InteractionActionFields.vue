<script setup lang="ts">
/**
 * @fileoverview 按动作类型出编辑面：显隐三档给目标多选，互斥切换给「值 + 目标」
 * 的组列表，弹窗给内容节点与标题，关闭弹窗没有字段。改完整条动作上抛。
 */
import { computed, ref, watch } from 'vue'
import type { DtSelectOption, InteractionAction } from '@dt/contracts'
import { DtButton, DtInput, DtSelect } from '@dt/ui'

import { newClientUuid } from '@/api/idempotency'
import InteractionTargetPicker from './InteractionTargetPicker.vue'

type ActiveGroup = { value: string; targets: string[] }

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

const modalTarget = computed(() =>
  props.action.type === 'openModal' ? props.action.target : '',
)

const modalTitle = computed(() =>
  props.action.type === 'openModal' ? (props.action.title ?? '') : '',
)

/**
 * 组行的稳定 key：落库的组只有 `{ value, targets }` 没有 id，拿 value 当 key
 * 会在改名的那一刻整行重挂、输入框当场丢焦点；故本地另存一份与组等长的 uid。
 * ⚠ 删中间一组必须连着 splice 掉它那把 uid：只靠下面按长度补齐的话，尾部会被
 * 截掉，余下各行拿到的是前一行的 key，本地状态整体错位。
 */
const groupKeys = ref<string[]>([])

function syncGroupKeys(count: number): void {
  const keys = groupKeys.value
  while (keys.length < count) keys.push(newClientUuid())
  if (keys.length > count) keys.splice(count)
}

watch(() => groups.value.length, syncGroupKeys, { immediate: true })

const groupRows = computed(() =>
  groups.value.map((group, index) => ({
    key: groupKeys.value[index] ?? `group-${index}`,
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

function indexOfKey(key: string): number {
  return groupKeys.value.indexOf(key)
}

function addGroup(): void {
  writeGroups([...groups.value, { value: '', targets: [] }])
}

function removeGroup(key: string): void {
  const index = indexOfKey(key)
  if (index < 0) return
  groupKeys.value.splice(index, 1)
  writeGroups(groups.value.filter((_group, at) => at !== index))
}

function patchGroup(key: string, patch: Partial<ActiveGroup>): void {
  const index = indexOfKey(key)
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
    <p v-else class="m-0 text-2xs text-text-disabled">
      关闭当前弹窗，不需要额外字段。
    </p>
  </div>
</template>
