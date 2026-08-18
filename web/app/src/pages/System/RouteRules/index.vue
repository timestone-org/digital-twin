<script setup lang="ts">
/**
 * @fileoverview 路由规则（闸 1）的管理面。改动即改变全系统鉴权矩阵。
 *
 * ⚠ 列表按**判定顺序**排（priority 降 → 模式长度降），因为「首条命中即终局」：
 * 命中但权限不足不会继续找更宽松的规则，所以顺序本身就是语义。
 * 因此这张表**一列都不可排序**——按别的列排会让人对着一份看不出判定结果的表
 * 做决定。⚠ 卡片视图按宽度铺成多列，位置本身表达不了判定序，
 * 该语义**全靠每张卡上的 `#n`**（`orderOf` 算的全局序，不是页内下标）。
 */
import { computed, onMounted, ref } from 'vue'
import type { DtDataColumn, RouteRule } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtIcon,
  DtInput,
  DtNotice,
  useConfirm,
  useToast,
} from '@dt/ui'

import * as admin from '@/api/admin'
import { listEmptyState } from '@/utils/listEmpty'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import SystemTabs from '../components/SystemTabs.vue'
import MethodTag from './components/MethodTag.vue'
import RuleBadges from './components/RuleBadges.vue'
import RuleCard from './components/RuleCard.vue'
import RuleCodes from './components/RuleCodes.vue'
import RuleFormDialog from './components/RuleFormDialog.vue'
import RuleMatcher from './components/RuleMatcher.vue'
import RulePattern from './components/RulePattern.vue'
import RuleRowActions from './components/RuleRowActions.vue'

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

// ⚠ 搜不到与「一条规则都没有」是两回事：后者要引导去建，前者只该让人改词
const emptyState = computed(() =>
  listEmptyState({
    isFiltered: keyword.value.trim() !== '',
    subject: '规则',
    keyword: keyword.value,
    blank: {
      title: '还没有路由规则',
      hint: '规则决定边缘按什么顺序判定一条请求该不该放行。',
    },
  }),
)
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

/**
 * 判定序 = 页偏移 + 页内下标。这是「第几个被检查」，不是「第几条生效规则」。
 * @param index 卡片在当前页里的下标
 */
function orderOf(index: number): number {
  const pager = list.pager.value
  return (pager.page - 1) * pager.size + index + 1
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
      <!-- 自成一组：顶栏的 gap 是给「操作区 ↔ 时钟」的，直接铺进去两颗钮会松得
           看不出它们是一组 -->
      <div class="flex items-center gap-2">
        <!-- 试算不改数据，故不套 PermGuard：能看这张表的人就该能试 -->
        <RuleMatcher :rules="list.items.value" />
        <PermGuard :codes="[PERMISSION_CODES.routeRuleManage]" explain>
          <DtButton size="sm" icon="plus" @click="openCreate">
            新增规则
          </DtButton>
        </PermGuard>
      </div>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <SystemTabs />

      <!-- 两种视图下都在：它说的是数据语义，不是卡片装饰 -->
      <!-- ⚠ 措辞对两种视图都得成立：表格是自上而下，卡片按宽度铺成多列，
           所以只说「按列表顺序」，具体第几个由卡上的 #n 讲 -->
      <DtNotice intent="info" icon="alert-circle">
        按列表顺序依次判定，首条命中即终局——命中但权限不足不会再往下找更宽的规则；停用的规则整条跳过。
      </DtNotice>

      <DtDataView
        v-model:view="view"
        :empty="emptyState"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :layout="{ minWidth: '60rem', cardColumns: 3, cardMinWidth: '22rem' }"
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
          <MethodTag :method="row.http_method" />
        </template>

        <template #cell-pattern="{ row }">
          <RulePattern :rule="row" />
          <!-- 表格行的次要行可以消失；卡片那边补 `—` 是为了每张卡等高 -->
          <p
            v-if="row.description"
            class="m-0 mt-1 text-2xs text-text-disabled"
          >
            {{ row.description }}
          </p>
        </template>

        <template #cell-codes="{ row }">
          <RuleCodes :codes="row.permission_codes" :mode="row.match_mode" />
        </template>

        <template #cell-status="{ row }">
          <RuleBadges :rule="row" />
        </template>

        <template #cell-actions="{ row }">
          <RuleRowActions
            :rule="row"
            @edit="openEdit"
            @toggle-enabled="toggleEnabled"
            @remove="removeRule"
          />
        </template>

        <template #card="{ row, index }">
          <RuleCard
            :rule="row"
            :order="orderOf(index)"
            @edit="openEdit"
            @toggle-enabled="toggleEnabled"
            @remove="removeRule"
          />
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
