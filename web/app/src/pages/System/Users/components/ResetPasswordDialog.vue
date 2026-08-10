<script setup lang="ts">
/**
 * @fileoverview 重置他人密码。后端会挡「目标权限高于自己」——
 * 没有那条约束，持 user:manage 的账号可以直接接管全权管理员。
 */
import { ref, watch } from 'vue'
import type { UserBase } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice } from '@dt/ui'

import * as admin from '@/api/admin'
import { describeError } from '@/composables/useAsyncList'

const props = defineProps<{ user: UserBase | null }>()
const emit = defineEmits<{ close: []; saved: [message: string] }>()

const password = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.user,
  () => {
    password.value = ''
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
    await admin.resetUserPassword(user.id, password.value)
    emit('saved', '密码已重置')
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
    title="重置密码"
    :description="user ? `目标账号：${user.username}` : undefined"
    @update:model-value="emit('close')"
  >
    <DtInput
      v-model="password"
      label="新密码"
      type="password"
      hint="至少 10 位，且同时包含字母与数字"
      autocomplete="new-password"
    />
    <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>

    <template #footer>
      <DtButton variant="ghost" intent="neutral" @click="emit('close')">
        取消
      </DtButton>
      <DtButton intent="danger" :loading="busy" @click="onSubmit">
        重置
      </DtButton>
    </template>
  </DtModal>
</template>
