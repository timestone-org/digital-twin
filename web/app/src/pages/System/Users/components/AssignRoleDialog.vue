<script setup lang="ts">
/**
 * @fileoverview 改派角色。这是提权入口，后端会挡「授予超过自身」与
 * 「目标高于自身」，前端只负责把拒绝的原因原样显示出来。
 */
import { ref, watch } from 'vue'
import type { RoleSummary, UserBase } from '@dt/contracts'
import { DtButton, DtModal, DtNotice, DtSelect } from '@dt/ui'

import * as admin from '@/api/admin'
import { describeError } from '@/composables/useAsyncList'

const props = defineProps<{ user: UserBase | null; roles: RoleSummary[] }>()
const emit = defineEmits<{ close: []; saved: [message: string] }>()

const roleId = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.user,
  (user) => {
    roleId.value = user?.role.id ?? ''
    error.value = null
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载（深链、或标记与挂载同一 tick）
  // 时，只监听变化的 watch 一次都不会跑，表单会是空的。
  { immediate: true },
)

async function onSubmit(): Promise<void> {
  const user = props.user
  if (!user) return
  busy.value = true
  error.value = null
  try {
    await admin.assignRole(user.id, roleId.value)
    emit('saved', '角色已改派')
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
    :model-value="user !== null"
    title="改派角色"
    :description="user ? `目标账号：${user.username}` : undefined"
    @update:model-value="emit('close')"
  >
    <DtSelect
      v-model="roleId"
      label="角色"
      :options="roles.map((role) => ({ value: role.id, label: role.name }))"
      hint="改派后该账号的权限立刻按新角色计算"
    />
    <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>

    <template #footer>
      <DtButton variant="ghost" intent="neutral" @click="emit('close')">
        取消
      </DtButton>
      <DtButton :loading="busy" @click="onSubmit">改派</DtButton>
    </template>
  </DtModal>
</template>
