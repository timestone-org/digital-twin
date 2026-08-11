<script setup lang="ts">
/**
 * @fileoverview 建角色 / 改角色。新建形态可以顺手带上一整组权限码，
 * 免得「建完再配」这一步在开箱状态下无处可去。
 *
 * ⚠ 内置角色只允许改描述：`name` 是种子的幂等键，改名后种子只会新建一个
 * 空壳而不是修复它。名称输入框因此对内置角色禁用。
 * ⚠ 编辑态一个码都不渲染：`PATCH /roles/{id}` 不收 codes，摆一个提交不出去
 * 的选择器是纯误导；改自定义角色的码走 RolePermissionsDialog。
 */
import { computed, ref, watch } from 'vue'
import type { RoleSummary } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice } from '@dt/ui'

import * as admin from '@/api/admin'
import { describeError } from '@/composables/useAsyncList'
import type { RoleFormTask } from '../roleFormTask'
import RolePermissionsField from './RolePermissionsField.vue'

const props = defineProps<{ task: RoleFormTask | null }>()
const emit = defineEmits<{ close: []; saved: [message: string] }>()

const form = ref({ name: '', description: '' })
const codes = ref<Set<string>>(new Set())
const codesReady = ref(true)
const busy = ref(false)
const error = ref<string | null>(null)

const isEdit = computed(() => props.task?.mode === 'edit')
const nameLocked = computed(
  () => props.task?.mode === 'edit' && props.task.role.is_builtin,
)

const description = computed(() => {
  const task = props.task
  if (nameLocked.value) return '内置角色的名称与权限集由种子维护，只能改描述'
  if (task === null || task.mode !== 'create' || task.codes.length === 0) {
    return undefined
  }
  const source = task.seededFrom
  const from = source === undefined ? '' : `来自「${source}」的`
  return `已预填 ${task.codes.length} 个${from}权限码，提交前可增删`
})

watch(
  () => props.task,
  (task) => {
    error.value = null
    codesReady.value = true
    if (task === null) return
    if (task.mode === 'edit') {
      form.value = {
        name: task.role.name,
        description: task.role.description ?? '',
      }
      codes.value = new Set()
      return
    }
    form.value = { name: task.name, description: task.description }
    // ⚠ new 一份：直接持有源角色的 permissions 会让勾选反写进列表数据
    codes.value = new Set(task.codes)
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载（深链、或标记与挂载同一 tick）
  // 时，只监听变化的 watch 一次都不会跑，表单会是空的。
  { immediate: true },
)

/** 内置角色不下发 name：后端会拒，前端也不该发一个必被拒的字段。 */
async function saveEdit(role: RoleSummary): Promise<void> {
  const changes = nameLocked.value
    ? { description: form.value.description }
    : { name: form.value.name, description: form.value.description }
  await admin.updateRole(role.id, changes)
  emit('saved', '角色已更新')
}

/** 建角色，顺带把勾好的码一次授予。 */
async function saveCreate(): Promise<void> {
  // ⚠ 排序：Set 的迭代序是插入序，不排序的话同一集合会因勾选顺序给出不同数组
  const picked = [...codes.value].sort()
  await admin.createRole({
    name: form.value.name,
    description: form.value.description || undefined,
    codes: picked,
  })
  emit(
    'saved',
    picked.length > 0
      ? `角色已创建，并授予 ${picked.length} 个权限码`
      : '角色已创建，接着给它配权限',
  )
}

async function onSubmit(): Promise<void> {
  const task = props.task
  if (task === null) return
  if (task.mode === 'create' && !codesReady.value) return
  busy.value = true
  error.value = null
  try {
    if (task.mode === 'edit') await saveEdit(task.role)
    else await saveCreate()
    emit('close')
  } catch (caught) {
    // 弹窗不关、勾选不清：错误里点名了哪几个码超限，人要能就地取消勾选再存
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="task !== null"
    :title="isEdit ? '编辑角色' : '新建角色'"
    :description="description"
    width="34rem"
    @update:model-value="emit('close')"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <DtInput
        v-model="form.name"
        label="角色名"
        :disabled="nameLocked"
        required
        hint="小写字母、数字与下划线，如 ops_engineer"
      />
      <DtInput v-model="form.description" label="描述" />

      <section v-if="!isEdit">
        <h3 class="m-0 mb-2 text-xs font-semibold text-text-secondary">
          权限码
        </h3>
        <RolePermissionsField v-model="codes" @ready="codesReady = $event" />
      </section>

      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
    </form>

    <template #footer>
      <DtButton variant="ghost" intent="neutral" @click="emit('close')">
        取消
      </DtButton>
      <DtButton
        :loading="busy"
        :disabled="!isEdit && !codesReady"
        @click="onSubmit"
      >
        保存
      </DtButton>
    </template>
  </DtModal>
</template>
