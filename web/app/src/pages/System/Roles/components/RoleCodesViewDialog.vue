<script setup lang="ts">
/**
 * @fileoverview 只读地看一个角色持有的权限码，并说清这里为什么改不了。
 *
 * ⚠ 目录取数失败不留白：读路径没有破坏性提交，码已经在手上却拒绝显示是纯
 * 损失，故降级成扁平 chips 并把失败原因一并显示。
 */
import { computed, ref, watch } from 'vue'
import type { RoleSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtModal, DtNotice, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import PermissionCodeList from '@/features/permissions/PermissionCodeList.vue'
import { usePermissionCatalog } from '@/features/permissions/usePermissionCatalog'
import { sortCodes } from '../../scripts/codes'

const props = defineProps<{ role: RoleSummary | null }>()
const emit = defineEmits<{ close: []; clone: [role: RoleSummary] }>()

const catalog = usePermissionCatalog()
const error = ref<string | null>(null)

const codes = computed(() => sortCodes(props.role?.permissions ?? []))
const description = computed(() =>
  props.role === null
    ? undefined
    : `${props.role.name} 当前持有 ${props.role.permissions.length} 个权限码`,
)

watch(
  () => props.role,
  async (role) => {
    error.value = null
    if (role === null) return
    await catalog.ensure()
    error.value = catalog.error.value
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载时，只监听变化的 watch 一次都不跑
  { immediate: true },
)

/** 内置角色改不了的出路：把这一组码带去新建一个自定义角色。 */
function cloneIt(): void {
  const role = props.role
  if (role === null) return
  emit('clone', role)
  emit('close')
}
</script>

<template>
  <DtModal
    :model-value="role !== null"
    title="角色权限"
    width="34rem"
    :description="description"
    @update:model-value="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <DtNotice v-if="role?.is_builtin" intent="info">
        内置角色「{{
          role?.name
        }}」的权限集由系统种子维护，这里只读。即便绕过界面改掉，下一次服务启动的种子同步也会把它覆盖回种子里的定义。需要一套不同的权限，请以此为模板新建一个角色。
      </DtNotice>
      <DtNotice v-else intent="info">
        你没有「管理角色与角色权限」（role:manage），只能查看这个角色的权限码。
      </DtNotice>

      <DtNotice v-if="error" intent="warning">{{ error }}</DtNotice>
      <div v-if="error" class="flex flex-wrap gap-1.5">
        <DtTag v-for="code in codes" :key="code" mono>{{ code }}</DtTag>
      </div>
      <PermissionCodeList
        v-else
        :codes="codes"
        :groups="catalog.groups.value"
      />
    </div>

    <template #footer>
      <DtButton variant="ghost" intent="neutral" @click="emit('close')">
        关闭
      </DtButton>
      <PermGuard v-if="role?.is_builtin" :codes="[PERMISSION_CODES.roleManage]">
        <DtButton @click="cloneIt">以此为模板新建角色</DtButton>
      </PermGuard>
    </template>
  </DtModal>
</template>
