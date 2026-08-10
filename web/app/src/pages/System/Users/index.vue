<script setup lang="ts">
/**
 * @fileoverview 用户管理：列表、建号、改资料、启停、重置密码、改派角色、写直权。
 *
 * ⚠ 每个写按钮都套 PermGuard：无权限时元素**不存在于 DOM**，而不是禁用。
 * 但这只是闸 3，后端仍会拦——这里少一个 PermGuard 不构成安全问题，
 * 多一个也换不来安全。
 *
 * ⚠ 排序抛给后端做：列表是服务端分页的，只排当前页等于按页各排各的。
 * `SORT_FIELDS` 必须落在后端 `USER_SORTABLE` 白名单内，多写一个就是 400。
 */
import { computed, onMounted, ref } from 'vue'
import type {
  DtDataColumn,
  DtTableSort,
  RoleSummary,
  UserListItem,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtIcon,
  DtInput,
  DtSelect,
  DtTag,
  useConfirm,
  useToast,
} from '@dt/ui'

import * as admin from '@/api/admin'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import SystemTabs from '../components/SystemTabs.vue'
import UserFormDialog from './components/UserFormDialog.vue'
import AssignRoleDialog from './components/AssignRoleDialog.vue'
import DirectPermissionsDialog from './components/DirectPermissionsDialog.vue'
import ResetPasswordDialog from './components/ResetPasswordDialog.vue'
import UserRowActions from './components/UserRowActions.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'account', label: '账号', sortable: true, card: 'title' },
  { key: 'role', label: '角色', width: '9rem' },
  { key: 'direct', label: '直权', width: '6rem' },
  { key: 'status', label: '状态', width: '7rem' },
  { key: 'lastLogin', label: '最近登录', sortable: true, width: '12rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '14rem',
    card: 'actions',
  },
]

/** 列 key → 后端排序字段。 */
const SORT_FIELDS: Record<string, string> = {
  account: 'username',
  lastLogin: 'last_login_at',
}

const toast = useToast()
const confirm = useConfirm()

const filters = ref({ q: '', roleId: '', active: '' })
const roles = ref<RoleSummary[]>([])
const view = useViewMode('system-users')
const sort = ref<DtTableSort>({ key: 'lastLogin', desc: true })

const list = useAsyncList<UserListItem>((query) => {
  const field = SORT_FIELDS[sort.value.key] ?? 'created_at'
  return admin.listUsers({
    q: filters.value.q || undefined,
    role_id: filters.value.roleId || undefined,
    is_active:
      filters.value.active === '' ? undefined : filters.value.active === 'yes',
    ...query,
    sort: `${sort.value.desc ? '-' : ''}${field}`,
  })
})

const roleOptions = computed(() => [
  { value: '', label: '全部角色' },
  ...roles.value.map((role) => ({ value: role.id, label: role.name })),
])

const editing = ref<UserListItem | null>(null)
const formOpen = ref(false)
const roleDialogFor = ref<UserListItem | null>(null)
const permDialogFor = ref<UserListItem | null>(null)
const resetDialogFor = ref<UserListItem | null>(null)

async function loadRoles(): Promise<void> {
  try {
    roles.value = (await admin.listRoles({ size: 200 })).items
  } catch {
    // 角色列表只用于筛选与建号下拉，拉不到不该让整页红
    roles.value = []
  }
}

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}

function openEdit(user: UserListItem): void {
  editing.value = user
  formOpen.value = true
}

async function onSort(next: DtTableSort): Promise<void> {
  sort.value = next
  // ⚠ 换排序要回第一页：留在第 7 页换个排序，看到的是新顺序下的第 7 页，
  // 而用户的心智是「从头看一遍」
  await list.reloadFromFirstPage()
}

async function afterWrite(message: string): Promise<void> {
  toast.success(message)
  await list.reload()
}

async function toggleActive(user: UserListItem): Promise<void> {
  try {
    await admin.setUserActive(user.id, !user.is_active)
    await afterWrite(user.is_active ? '账号已停用' : '账号已启用')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function removeUser(user: UserListItem): Promise<void> {
  const ok = await confirm.ask({
    title: '删除用户',
    message: `将删除账号「${user.username}」及其全部直权，且不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await admin.deleteUser(user.id)
    await afterWrite('用户已删除')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

onMounted(async () => {
  await Promise.all([loadRoles(), list.reload()])
})
</script>

<template>
  <AppShell title="用户管理" subtitle="账号、角色与直权">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.userManage]">
        <DtButton size="sm" icon="plus" @click="openCreate">新建用户</DtButton>
      </PermGuard>
    </template>

    <!-- ⚠ h-full + min-h-0：AppShell 的 main 不再滚动，页面根节点不吃满高度的话
         表格拿不到有界高度，超出的行会被裁掉且滚不到 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <SystemTabs />

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :sort="sort"
        :pagination="list.pager.value"
        min-width="64rem"
        empty-hint="换个筛选条件试试，或新建一个账号"
        @update:sort="onSort"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #toolbar>
          <DtInput
            v-model="filters.q"
            class="w-60"
            placeholder="搜索用户名 / 邮箱 / 姓名"
            size="sm"
            @enter="list.reloadFromFirstPage()"
          >
            <template #leading><DtIcon name="search" :size="14" /></template>
          </DtInput>
          <DtSelect
            v-model="filters.roleId"
            class="w-40"
            size="sm"
            aria-label="按角色筛选"
            :options="roleOptions"
            @update:model-value="list.reloadFromFirstPage()"
          />
          <DtSelect
            v-model="filters.active"
            class="w-32"
            size="sm"
            aria-label="按状态筛选"
            :options="[
              { value: '', label: '全部状态' },
              { value: 'yes', label: '已启用' },
              { value: 'no', label: '已停用' },
            ]"
            @update:model-value="list.reloadFromFirstPage()"
          />
          <DtButton
            variant="outline"
            size="sm"
            @click="list.reloadFromFirstPage()"
          >
            查询
          </DtButton>
        </template>

        <template #summary>共 {{ list.total.value }} 个账号</template>

        <template #cell-account="{ row }">
          <p class="m-0 text-text-primary">{{ row.username }}</p>
          <p class="m-0 text-2xs text-text-disabled">
            {{ row.full_name || '—' }} · {{ row.email }}
          </p>
        </template>

        <template #cell-role="{ row }">
          <DtTag :intent="row.role.is_builtin ? 'primary' : 'neutral'">
            {{ row.role.name }}
          </DtTag>
        </template>

        <template #cell-direct="{ row }">
          <!-- 列表只知道条数：权限码要点「设置直权」拉详情才有 -->
          <span v-if="row.direct_permission_count === 0">—</span>
          <DtTag v-else intent="info" mono>
            +{{ row.direct_permission_count }}
          </DtTag>
        </template>

        <template #cell-status="{ row }">
          <DtTag :intent="row.is_active ? 'success' : 'danger'">
            {{ row.is_active ? '已启用' : '已停用' }}
          </DtTag>
        </template>

        <template #cell-lastLogin="{ row }">
          {{ formatDateTime(row.last_login_at, '从未登录') }}
        </template>

        <template #cell-actions="{ row }">
          <UserRowActions
            :user="row"
            @edit="openEdit"
            @toggle-active="toggleActive"
            @reset-password="resetDialogFor = $event"
            @assign-role="roleDialogFor = $event"
            @set-permissions="permDialogFor = $event"
            @remove="removeUser"
          />
        </template>
      </DtDataView>
    </div>

    <UserFormDialog
      v-model="formOpen"
      :user="editing"
      :roles="roles"
      @saved="afterWrite($event)"
    />
    <AssignRoleDialog
      :user="roleDialogFor"
      :roles="roles"
      @close="roleDialogFor = null"
      @saved="afterWrite($event)"
    />
    <DirectPermissionsDialog
      :user="permDialogFor"
      @close="permDialogFor = null"
      @saved="afterWrite($event)"
    />
    <ResetPasswordDialog
      :user="resetDialogFor"
      @close="resetDialogFor = null"
      @saved="afterWrite($event)"
    />
  </AppShell>
</template>
