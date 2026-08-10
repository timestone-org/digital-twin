<script setup lang="ts">
/**
 * @fileoverview 建角色 / 改角色。
 * ⚠ 内置角色只允许改描述：`name` 是种子的幂等键，改名后种子只会新建一个
 * 空壳而不是修复它。名称输入框因此对内置角色禁用。
 */
import { computed, ref, watch } from 'vue'
import type { RoleSummary } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice } from '@dt/ui'

import * as admin from '@/api/admin'
import { describeError } from '@/composables/useAsyncList'

const props = defineProps<{ modelValue: boolean; role: RoleSummary | null }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [message: string]
}>()

const form = ref({ name: '', description: '' })
const busy = ref(false)
const error = ref<string | null>(null)

const isEdit = computed(() => props.role !== null)
const nameLocked = computed(() => props.role?.is_builtin ?? false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = null
    form.value = {
      name: props.role?.name ?? '',
      description: props.role?.description ?? '',
    }
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载（深链、或标记与挂载同一 tick）
  // 时，只监听变化的 watch 一次都不会跑，表单会是空的。
  { immediate: true },
)

async function onSubmit(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    if (props.role) {
      // 内置角色不下发 name：后端会拒，前端也不该发一个必被拒的字段
      const changes = nameLocked.value
        ? { description: form.value.description }
        : { name: form.value.name, description: form.value.description }
      await admin.updateRole(props.role.id, changes)
      emit('saved', '角色已更新')
    } else {
      await admin.createRole({
        name: form.value.name,
        description: form.value.description || undefined,
        codes: [],
      })
      emit('saved', '角色已创建，接着给它配权限')
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
    :title="isEdit ? '编辑角色' : '新建角色'"
    :description="
      nameLocked ? '内置角色的名称与权限集由种子维护，只能改描述' : undefined
    "
    @update:model-value="emit('update:modelValue', $event)"
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
