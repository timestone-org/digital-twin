<script setup lang="ts">
/**
 * @fileoverview 用户列表的筛选条：关键词、角色、状态三个条件与一个查询按钮。
 * 抽出来是给页面主体腾行数，取值仍由页面持有。
 */
import { computed } from 'vue'
import type { DtSelectOption, RoleSummary } from '@dt/contracts'
import { DtButton, DtIcon, DtInput, DtSelect } from '@dt/ui'

const props = defineProps<{
  q: string
  roleId: string
  active: string
  roles: readonly RoleSummary[]
}>()

const emit = defineEmits<{
  'update:q': [value: string]
  'update:roleId': [value: string]
  'update:active': [value: string]
  search: []
}>()

/** 状态筛选的三档 */
const STATUS_OPTIONS: readonly DtSelectOption[] = [
  { value: '', label: '全部状态' },
  { value: 'yes', label: '已启用' },
  { value: 'no', label: '已停用' },
]

const roleOptions = computed<readonly DtSelectOption[]>(() => [
  { value: '', label: '全部角色' },
  ...props.roles.map((role) => ({ value: role.id, label: role.name })),
])

/**
 * 下拉一改就重查：挑一个筛选值本身就是「我要看这一批」，再点一次按钮是多余的。
 * @param value 选中的角色 id，空串表示全部
 */
function pickRole(value: string): void {
  emit('update:roleId', value)
  emit('search')
}

/**
 * 同上，按启停状态筛。
 * @param value `yes` / `no` / 空串
 */
function pickActive(value: string): void {
  emit('update:active', value)
  emit('search')
}
</script>

<template>
  <DtInput
    class="w-60"
    :model-value="props.q"
    placeholder="搜索用户名 / 邮箱 / 姓名"
    size="sm"
    @update:model-value="emit('update:q', $event)"
    @enter="emit('search')"
  >
    <template #leading><DtIcon name="search" :size="14" /></template>
  </DtInput>
  <DtSelect
    class="w-40"
    :model-value="props.roleId"
    size="sm"
    aria-label="按角色筛选"
    :options="roleOptions"
    @update:model-value="pickRole"
  />
  <DtSelect
    class="w-32"
    :model-value="props.active"
    size="sm"
    aria-label="按状态筛选"
    :options="STATUS_OPTIONS"
    @update:model-value="pickActive"
  />
  <DtButton variant="outline" size="sm" @click="emit('search')">查询</DtButton>
</template>
