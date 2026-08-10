<script setup lang="ts">
/**
 * @fileoverview 路由规则（闸 1）的管理面。改动即改变全系统鉴权矩阵。
 *
 * ⚠ 列表按**判定顺序**排（priority 降 → 模式长度降），因为「首条命中即终局」：
 * 命中但权限不足不会继续找更宽松的规则，所以顺序本身就是语义。
 * 因此这张表**一列都不可排序**——按别的列排会让人对着一份看不出判定结果的表
 * 做决定。卡片视图同理按同一顺序铺开。
 */
import { onMounted, ref } from 'vue'
import type { DtDataColumn, RouteRule } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtIcon,
  DtInput,
  DtTag,
  useConfirm,
  useToast,
} from '@dt/ui'

import * as admin from '@/api/admin'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import SystemTabs from '../components/SystemTabs.vue'
import RuleFormDialog from './components/RuleFormDialog.vue'
import RuleMatcher from './components/RuleMatcher.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'priority', label: '优先级', width: '5rem' },
  { key: 'method', label: '方法', width: '6rem', card: 'meta' },
  { key: 'pattern', label: '路径模式', card: 'title' },
  { key: 'codes', label: '权限码' },
  { key: 'status', label: '状态', width: '9rem' },
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

const keyword = ref('')
const view = useViewMode('system-route-rules')

const list = useAsyncList<RouteRule>((query) =>
  admin.listRouteRules({ q: keyword.value || undefined, ...query }),
)

const editing = ref<RouteRule | null>(null)
const formOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}

function openEdit(rule: RouteRule): void {
  editing.value = rule
  formOpen.value = true
}

async function afterWrite(message: string): Promise<void> {
  toast.success(message)
  await list.reload()
}

async function removeRule(rule: RouteRule): Promise<void> {
  const ok = await confirm.ask({
    title: '删除路由规则',
    message: `删除「${rule.http_method} ${rule.path_pattern}」后，该路径会落到更宽的规则上，没有更宽的则直接被拒。这会立即改变全系统的鉴权结果。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await admin.deleteRouteRule(rule.id)
    await afterWrite('规则已删除')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function toggleEnabled(rule: RouteRule): Promise<void> {
  try {
    await admin.updateRouteRule(rule.id, { is_enabled: !rule.is_enabled })
    await afterWrite(rule.is_enabled ? '规则已停用' : '规则已启用')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

onMounted(() => {
  void list.reload()
})
</script>

<template>
  <AppShell title="路由规则" subtitle="闸 1 的鉴权矩阵 · 按判定顺序排列">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.routeRuleManage]">
        <DtButton size="sm" icon="plus" @click="openCreate">新增规则</DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <SystemTabs />

      <RuleMatcher :rules="list.items.value" />

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        min-width="60rem"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #toolbar>
          <DtInput
            v-model="keyword"
            class="w-72"
            size="sm"
            placeholder="搜索路径模式"
            @enter="list.reloadFromFirstPage()"
          >
            <template #leading><DtIcon name="search" :size="14" /></template>
          </DtInput>
          <DtButton
            variant="outline"
            size="sm"
            @click="list.reloadFromFirstPage()"
          >
            查询
          </DtButton>
        </template>

        <template #summary>共 {{ list.total.value }} 条</template>

        <template #cell-priority="{ row }">
          <span class="font-mono text-accent-secondary">{{
            row.priority
          }}</span>
        </template>

        <template #cell-method="{ row }">
          <DtTag mono>{{ row.http_method }}</DtTag>
        </template>

        <template #cell-pattern="{ row }">
          <code :class="{ 'opacity-50': !row.is_enabled }">
            {{ row.path_pattern }}
          </code>
          <p
            v-if="row.description"
            class="m-0 mt-1 text-2xs text-text-disabled"
          >
            {{ row.description }}
          </p>
        </template>

        <template #cell-codes="{ row }">
          <!-- 空码不是「匿名放行」，是「任意已登录用户」——写清楚，
               否则运维会以为这条规则等于没有 -->
          <span v-if="row.permission_codes.length === 0">任意登录用户</span>
          <div v-else class="flex flex-wrap items-center gap-1.5">
            <DtTag v-for="code in row.permission_codes" :key="code" mono>
              {{ code }}
            </DtTag>
            <DtTag v-if="row.match_mode === 'any'" intent="info">任一</DtTag>
          </div>
        </template>

        <template #cell-status="{ row }">
          <div class="flex items-center gap-1.5">
            <DtTag :intent="row.is_enabled ? 'success' : 'danger'">
              {{ row.is_enabled ? '启用' : '停用' }}
            </DtTag>
            <DtTag v-if="row.is_builtin" intent="primary">内置</DtTag>
          </div>
        </template>

        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end gap-1">
            <PermGuard :codes="[PERMISSION_CODES.routeRuleManage]">
              <DtButton
                variant="ghost"
                intent="neutral"
                size="sm"
                icon="pencil"
                aria-label="编辑规则"
                title="编辑规则"
                @click="openEdit(row)"
              />
              <DtButton
                variant="ghost"
                intent="neutral"
                size="sm"
                :icon="row.is_enabled ? 'toggle-right' : 'toggle-left'"
                :aria-label="row.is_enabled ? '停用' : '启用'"
                :title="row.is_enabled ? '停用' : '启用'"
                @click="toggleEnabled(row)"
              />
              <DtButton
                variant="ghost"
                intent="danger"
                size="sm"
                icon="trash"
                aria-label="删除规则"
                title="删除规则"
                @click="removeRule(row)"
              />
            </PermGuard>
          </div>
        </template>
      </DtDataView>
    </div>

    <RuleFormDialog
      v-model="formOpen"
      :rule="editing"
      @saved="afterWrite($event)"
    />
  </AppShell>
</template>
