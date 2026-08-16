<script setup lang="ts">
/**
 * @fileoverview 覆盖式写用户直权。角色带来的码只读展示，直权叠在它之上。
 *
 * ⚠ 现有直权**必须现拉详情**：入参是列表项，它只有直权条数、没有码。
 * 拿列表项去 `new Set(user.direct_permissions)` 得到的是空集，而空集提交上去
 * 就是把这个人的直权全清掉——不报错、不提示，权限就没了。
 * 因此详情没到位之前，保存按钮一律禁用。
 */
import { ref, watch } from 'vue'
import type { UserBase } from '@dt/contracts'
import { DtButton, DtModal, DtNotice, DtSpinner } from '@dt/ui'

import * as admin from '@/api/admin'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import PermissionCodePicker from '@/features/permissions/PermissionCodePicker.vue'
import { usePermissionCatalog } from '@/features/permissions/usePermissionCatalog'

const props = defineProps<{ user: UserBase | null }>()
const emit = defineEmits<{ close: []; saved: [message: string] }>()

const catalog = usePermissionCatalog()
const roleCodes = ref<Set<string>>(new Set())
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
/** 详情已到位。没到位就提交等于用空集覆盖，故它同时是保存按钮的开关。 */
const ready = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

// ⚠ 竞态防护：连着点两行时，慢的那次后返回会盖掉快的那次的勾选，
// 结果是对着 A 的界面提交 B 的权限集——覆盖式写，错一次就是错到底。
const raced = useRacedFetch()

watch(
  () => props.user,
  async (user) => {
    error.value = null
    ready.value = false
    selected.value = new Set()
    roleCodes.value = new Set()
    if (!user) {
      raced.cancel()
      return
    }
    loading.value = true
    await raced.run(
      () => Promise.all([admin.getUser(user.id), catalog.ensure()]),
      {
        ok: ([detail]) => {
          // ⚠ catalog.ensure() 自己吞了异常只写进 catalog.error，从不 reject——
          // 不显式检查的话目录 500 时弹窗正文是空白的，而保存按钮还是启用的。
          if (catalog.error.value !== null) {
            error.value = catalog.error.value
            return
          }
          selected.value = new Set(detail.direct_permissions)
          roleCodes.value = new Set(detail.role_permissions)
          ready.value = true
        },
        fail: (caught) => (error.value = describeError(caught)),
        settled: () => (loading.value = false),
      },
    )
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载（深链、或标记与挂载同一 tick）
  // 时，只监听变化的 watch 一次都不会跑，表单会是空的。
  { immediate: true },
)

async function onSubmit(): Promise<void> {
  const user = props.user
  if (!user || !ready.value) return
  busy.value = true
  error.value = null
  try {
    await admin.setDirectPermissions(user.id, [...selected.value])
    emit('saved', '直权已更新')
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
    title="设置直权"
    width="34rem"
    :description="
      user
        ? `目标账号：${user.username}。提交的即为最终集合，未勾选的会被移除`
        : undefined
    "
    @update:model-value="emit('close')"
  >
    <div v-if="loading" class="flex justify-center py-8">
      <DtSpinner label="读取当前直权" />
    </div>

    <DtNotice v-else-if="!ready" intent="danger" icon="alert-circle">
      {{ error ?? '读取当前直权失败，关掉重开再试' }}
    </DtNotice>

    <template v-else>
      <PermissionCodePicker
        v-model="selected"
        :groups="catalog.groups.value"
        :locked="roleCodes"
        locked-label="角色已含"
      />
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
    </template>

    <template #footer>
      <DtButton variant="ghost" intent="neutral" @click="emit('close')">
        取消
      </DtButton>
      <DtButton :loading="busy" :disabled="!ready" @click="onSubmit">
        保存
      </DtButton>
    </template>
  </DtModal>
</template>
