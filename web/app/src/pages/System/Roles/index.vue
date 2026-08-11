<script setup lang="ts">
/**
 * @fileoverview 角色管理：列表、建改删、覆盖式设置角色权限。
 *
 * ⚠ 内置角色的**名称与权限集不可改**（描述仍可改），由后端拦；界面据
 * `is_builtin` 隐藏对应入口，而不是硬编码角色名——种子改名不该让界面失灵。
 *
 * 默认卡片视图：角色数量少、每个都带一串权限码，铺开比挤在单元格里好读。
 */
import { onMounted, ref } from 'vue'
import type { DtDataColumn, RoleSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtTag, useConfirm, useToast } from '@dt/ui'

import * as admin from '@/api/admin'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import SystemTabs from '../components/SystemTabs.vue'
import RoleFormDialog from './components/RoleFormDialog.vue'
import RolePermissionsDialog from './components/RolePermissionsDialog.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '角色', width: '12rem', card: 'title' },
  { key: 'description', label: '描述', card: 'meta' },
  { key: 'permissions', label: '权限码' },
  { key: 'users', label: '账号数', width: '6rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '9rem',
    card: 'actions',
  },
]

const toast = useToast()
const confirm = useConfirm()

const view = useViewMode('system-roles', 'card')
const list = useAsyncList<RoleSummary>((query) => admin.listRoles(query))

const editing = ref<RoleSummary | null>(null)
const formOpen = ref(false)
const permDialogFor = ref<RoleSummary | null>(null)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}

function openEdit(role: RoleSummary): void {
  editing.value = role
  formOpen.value = true
}

async function afterWrite(message: string): Promise<void> {
  toast.success(message)
  await list.reload()
}

async function removeRole(role: RoleSummary): Promise<void> {
  const ok = await confirm.ask({
    title: '删除角色',
    message:
      role.user_count > 0
        ? `角色「${role.name}」下还有 ${role.user_count} 个账号，删除会被后端拒绝。`
        : `将删除角色「${role.name}」，且不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await admin.deleteRole(role.id)
    await afterWrite('角色已删除')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

onMounted(() => {
  void list.reload()
})
</script>

<template>
  <AppShell title="角色管理" subtitle="岗位与它持有的权限码">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.roleManage]">
        <DtButton size="sm" icon="plus" @click="openCreate">新建角色</DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <SystemTabs />

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :layout="{ minWidth: '52rem' }"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #summary>共 {{ list.total.value }} 个角色</template>

        <template #cell-name="{ row }">
          <span class="truncate">{{ row.name }}</span>
          <DtTag v-if="row.is_builtin" intent="primary">内置</DtTag>
        </template>

        <template #cell-description="{ row }">
          {{ row.description || '未填写描述' }}
        </template>

        <template #cell-permissions="{ row }">
          <div class="flex flex-wrap gap-1.5">
            <DtTag v-for="code in row.permissions" :key="code" mono>
              {{ code }}
            </DtTag>
            <span v-if="row.permissions.length === 0">没有任何权限码</span>
          </div>
        </template>

        <template #cell-users="{ row }">{{ row.user_count }}</template>

        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end gap-1">
            <PermGuard :codes="[PERMISSION_CODES.roleManage]">
              <DtButton
                variant="ghost"
                intent="neutral"
                size="sm"
                icon="pencil"
                aria-label="编辑角色"
                title="编辑角色"
                @click="openEdit(row)"
              />
              <DtButton
                v-if="!row.is_builtin"
                variant="ghost"
                intent="neutral"
                size="sm"
                icon="list-checks"
                aria-label="设置权限"
                title="设置权限"
                @click="permDialogFor = row"
              />
              <DtButton
                v-if="!row.is_builtin"
                variant="ghost"
                intent="danger"
                size="sm"
                icon="trash"
                aria-label="删除角色"
                title="删除角色"
                @click="removeRole(row)"
              />
            </PermGuard>
          </div>
        </template>
      </DtDataView>
    </div>

    <RoleFormDialog
      v-model="formOpen"
      :role="editing"
      @saved="afterWrite($event)"
    />
    <RolePermissionsDialog
      :role="permDialogFor"
      @close="permDialogFor = null"
      @saved="afterWrite($event)"
    />
  </AppShell>
</template>
