<script setup lang="ts">
/**
 * @fileoverview 角色管理：列表、建改删、覆盖式设置角色权限。
 *
 * ⚠ 内置角色的**名称与权限集不可改**（描述仍可改），由后端拦。界面不因此
 * 抽掉入口——权限入口对所有角色都在，只是内置角色打开的是只读视图，并给出
 * 「以此为模板新建」这条出路；判定一律据 `is_builtin` 而不是硬编码角色名。
 *
 * 默认卡片视图：角色数量少、每个都带一串权限码，铺开比挤在单元格里好读。
 */
import { computed, onMounted, ref } from 'vue'
import type { DtDataColumn, RoleSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtTag, useConfirm, useToast } from '@dt/ui'

import * as admin from '@/api/admin'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { useAuthStore } from '@/stores/auth'
import CodeChips from '../components/CodeChips.vue'
import { sortCodes } from '../components/codes'
import SystemTabs from '../components/SystemTabs.vue'
import { suggestCloneName } from './cloneName'
import type { RoleFormTask } from './roleFormTask'
import RoleCard from './components/RoleCard.vue'
import RoleCodesViewDialog from './components/RoleCodesViewDialog.vue'
import RoleFormDialog from './components/RoleFormDialog.vue'
import RolePermissionsDialog from './components/RolePermissionsDialog.vue'
import RoleRowActions from './components/RoleRowActions.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '角色', width: '12rem', card: 'title' },
  { key: 'description', label: '描述', card: 'meta' },
  { key: 'permissions', label: '权限码' },
  { key: 'users', label: '账号数', width: '6rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '11rem',
    card: 'actions',
  },
]

const toast = useToast()
const confirm = useConfirm()
const auth = useAuthStore()

const view = useViewMode('system-roles', 'card')
const list = useAsyncList<RoleSummary>((query) => admin.listRoles(query))

const formTask = ref<RoleFormTask | null>(null)
const codesFor = ref<RoleSummary | null>(null)

const existingNames = computed(() => list.items.value.map((row) => row.name))

/** 导航级闸，与 PermGuard 同一口径；能不能授予永远由后端说了算。 */
const codesEditable = computed(
  () =>
    codesFor.value !== null &&
    !codesFor.value.is_builtin &&
    auth.can([PERMISSION_CODES.roleManage]),
)

function openCreate(): void {
  formTask.value = { mode: 'create', name: '', description: '', codes: [] }
}

function openEdit(role: RoleSummary): void {
  formTask.value = { mode: 'edit', role }
}

/** 克隆 = 带种子的新建，不是第三种表单形态。 */
function openClone(role: RoleSummary): void {
  formTask.value = {
    mode: 'create',
    name: suggestCloneName(role.name, existingNames.value),
    description: role.description ?? '',
    codes: role.permissions,
    seededFrom: role.name,
  }
}

async function afterWrite(message: string): Promise<void> {
  toast.success(message)
  await list.reload()
}

async function removeRole(role: RoleSummary): Promise<void> {
  // ⚠ 删不成就别问：一个注定被拒的请求换不来任何信息，只换来一条报错
  if (role.user_count > 0) {
    toast.warning(
      `角色「${role.name}」下还有 ${role.user_count} 个账号，` +
        '先把它们改派到别的角色才能删这个角色。',
    )
    return
  }
  const ok = await confirm.ask({
    title: '删除角色',
    message: `将删除角色「${role.name}」，且不可恢复。`,
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
      <PermGuard :codes="[PERMISSION_CODES.roleManage]" explain>
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
        :layout="{ minWidth: '52rem', cardColumns: 3, cardMinWidth: '20rem' }"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #summary>共 {{ list.total.value }} 个角色</template>

        <template #card="{ row }">
          <RoleCard
            :role="row"
            @codes="codesFor = $event"
            @clone="openClone($event)"
            @edit="openEdit($event)"
            @remove="removeRole($event)"
          />
        </template>

        <template #cell-name="{ row }">
          <span class="truncate">{{ row.name }}</span>
          <DtTag v-if="row.is_builtin" intent="primary">内置</DtTag>
        </template>

        <template #cell-description="{ row }">
          {{ row.description || '未填写描述' }}
        </template>

        <template #cell-permissions="{ row }">
          <CodeChips
            :codes="sortCodes(row.permissions)"
            empty="尚未配置权限码"
          />
        </template>

        <template #cell-users="{ row }">{{ row.user_count }}</template>

        <template #cell-actions="{ row }">
          <RoleRowActions
            :role="row"
            @codes="codesFor = $event"
            @clone="openClone($event)"
            @edit="openEdit($event)"
            @remove="removeRole($event)"
          />
        </template>
      </DtDataView>
    </div>

    <RoleFormDialog
      :task="formTask"
      @close="formTask = null"
      @saved="afterWrite($event)"
    />
    <RolePermissionsDialog
      :role="codesEditable ? codesFor : null"
      @close="codesFor = null"
      @saved="afterWrite($event)"
    />
    <RoleCodesViewDialog
      :role="codesEditable ? null : codesFor"
      @close="codesFor = null"
      @clone="openClone($event)"
    />
  </AppShell>
</template>
