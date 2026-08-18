<script setup lang="ts">
/**
 * @fileoverview 建号 / 改资料弹窗。
 * ⚠ 编辑态**不含**角色与直权字段：那两样走各自的授权入口（`user:grant`），
 * 混进资料表单会让「改个手机号」和「提权」共用一个权限码。
 */
import { computed, ref, watch } from 'vue'
import type { RoleSummary, UserBase } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtSelect } from '@dt/ui'
import { useFormDirty } from '@/composables/useFormDirty'

import * as admin from '@/api/admin'
import { describeError } from '@/composables/useAsyncList'

const props = defineProps<{
  modelValue: boolean
  user: UserBase | null
  roles: RoleSummary[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [message: string]
}>()

const BLANK_FORM = {
  username: '',
  email: '',
  password: '',
  full_name: '',
  phone: '',
  role_id: '',
}

/** 打开时把目标账号铺进表单；新建时留空，角色落在第一个可选项上。 */
function toForm(user: UserBase | null, fallbackRoleId: string) {
  if (user === null) return { ...BLANK_FORM, role_id: fallbackRoleId }
  return {
    ...BLANK_FORM,
    username: user.username,
    email: user.email,
    full_name: user.full_name ?? '',
    phone: user.phone ?? '',
    role_id: user.role.id,
  }
}

const form = ref({ ...BLANK_FORM })
const busy = ref(false)
const error = ref<string | null>(null)

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  () => form.value,
  () => props.modelValue,
)

const isEdit = computed(() => props.user !== null)
const roleOptions = computed(() =>
  props.roles.map((role) => ({ value: role.id, label: role.name })),
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = null
    form.value = toForm(props.user, props.roles[0]?.id ?? '')
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载（深链、或标记与挂载同一 tick）
  // 时，只监听变化的 watch 一次都不会跑，表单会是空的。
  { immediate: true },
)

async function onSubmit(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    if (props.user) {
      await admin.updateUser(props.user.id, {
        email: form.value.email,
        full_name: form.value.full_name,
        phone: form.value.phone,
      })
      emit('saved', '资料已更新')
    } else {
      await admin.createUser({
        username: form.value.username,
        email: form.value.email,
        password: form.value.password,
        role_id: form.value.role_id,
        full_name: form.value.full_name || undefined,
        phone: form.value.phone || undefined,
      })
      emit('saved', '用户已创建')
    }
    emit('update:modelValue', false)
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :dirty="isDirty"
    :title="isEdit ? '编辑资料' : '新建用户'"
    :description="isEdit ? '角色与直权请走各自的授权入口' : undefined"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <DtInput
        v-if="!isEdit"
        v-model="form.username"
        label="用户名"
        required
        hint="3–64 位，字母数字与 . _ -"
      />
      <DtInput v-model="form.email" label="邮箱" type="email" required />
      <DtInput
        v-if="!isEdit"
        v-model="form.password"
        label="初始密码"
        type="password"
        required
        hint="至少 10 位，且同时包含字母与数字"
        autocomplete="new-password"
      />
      <DtSelect
        v-if="!isEdit"
        v-model="form.role_id"
        label="角色"
        required
        :options="roleOptions"
      />
      <DtInput v-model="form.full_name" label="姓名" />
      <DtInput v-model="form.phone" label="手机号" />
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
    </form>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton :loading="busy" @click="onSubmit">保存</DtButton>
    </template>
  </DtModal>
</template>
