<script setup lang="ts">
/**
 * @fileoverview 覆盖式设置角色权限。
 * ⚠ 这是整套 RBAC 的提权入口：后端会挡「授予超过自身」与「被改角色当前的
 * 码集超过操作者」。前端只把拒绝原因原样显示，不自己判——两处判定必然漂移。
 */
import { ref, watch } from 'vue'
import type { RoleSummary } from '@dt/contracts'
import { DtButton, DtModal, DtNotice } from '@dt/ui'

import * as admin from '@/api/admin'
import { describeError } from '@/composables/useAsyncList'
import PermissionCodePicker from '@/features/permissions/PermissionCodePicker.vue'
import { usePermissionCatalog } from '@/features/permissions/usePermissionCatalog'

const props = defineProps<{ role: RoleSummary | null }>()
const emit = defineEmits<{ close: []; saved: [message: string] }>()

const catalog = usePermissionCatalog()
const selected = ref<Set<string>>(new Set())
const busy = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.role,
  async (role) => {
    error.value = null
    if (!role) return
    selected.value = new Set(role.permissions)
    await catalog.ensure()
    error.value = catalog.error.value
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载（深链、或标记与挂载同一 tick）
  // 时，只监听变化的 watch 一次都不会跑，表单会是空的。
  { immediate: true },
)

async function onSubmit(): Promise<void> {
  const role = props.role
  if (!role) return
  busy.value = true
  error.value = null
  try {
    // ⚠ 排序：Set 的迭代序是插入序，同一集合会因勾选顺序给出不同数组
    await admin.setRolePermissions(role.id, [...selected.value].sort())
    emit('saved', '角色权限已更新')
    emit('close')
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="role !== null"
    title="设置角色权限"
    width="34rem"
    :description="
      role ? `${role.name}。提交的即为最终集合，未勾选的会被移除` : undefined
    "
    @update:model-value="emit('close')"
  >
    <PermissionCodePicker v-model="selected" :groups="catalog.groups.value" />
    <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>

    <template #footer>
      <DtButton variant="ghost" intent="neutral" @click="emit('close')">
        取消
      </DtButton>
      <DtButton :loading="busy" @click="onSubmit">保存</DtButton>
    </template>
  </DtModal>
</template>
