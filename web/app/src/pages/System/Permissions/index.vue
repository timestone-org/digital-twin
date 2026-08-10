<script setup lang="ts">
/**
 * @fileoverview 权限目录（只读）。
 *
 * 目录由种子驱动，界面没有写入面：运行时新建的权限码不会被任何端点或
 * 路由规则消费，建了也只是装饰品。分组、档位、内置标记全部读后端字段，
 * 前端**不再维护一张会漂移的映射表**。
 *
 * ⚠ 视图切换器只有页面顶部这一个：每个分组各挂一个的话，切换后各组状态不一致，
 * 而这一页的语义是「同一份目录换个看法」。
 */
import { computed, onMounted, ref } from 'vue'
import type {
  DtDataColumn,
  DtSegmentedOption,
  PermissionCatalog,
  PermissionKind,
} from '@dt/contracts'
import {
  DtCard,
  DtDataView,
  DtIcon,
  DtInput,
  DtPageState,
  DtSegmented,
  DtTag,
} from '@dt/ui'

import { fetchPermissionCatalog } from '@/api/auth'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { useAuthStore } from '@/stores/auth'
import SystemTabs from '../components/SystemTabs.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', width: '14rem', card: 'title' },
  { key: 'code', label: '权限码', width: '14rem', card: 'meta' },
  { key: 'kind', label: '档位', width: '8rem' },
  { key: 'held', label: '我是否持有', width: '8rem' },
  { key: 'description', label: '说明' },
]

const VIEW_OPTIONS: readonly DtSegmentedOption[] = [
  { value: 'table', label: '表格视图', icon: 'table', iconOnly: true },
  { value: 'card', label: '卡片视图', icon: 'layout-grid', iconOnly: true },
]

/** 四档的展示口径：operate 与 admin 打红标，与后端 `kind` 一一对应。 */
const KIND_META: Record<
  PermissionKind,
  { label: string; intent: 'neutral' | 'primary' | 'warning' | 'danger' }
> = {
  view: { label: '查看', intent: 'neutral' },
  manage: { label: '管理', intent: 'primary' },
  operate: { label: '操作', intent: 'warning' },
  admin: { label: '高危', intent: 'danger' },
}

const auth = useAuthStore()

const catalog = ref<PermissionCatalog | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const keyword = ref('')
const view = useViewMode('system-permissions')

const groups = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  const source = catalog.value?.groups ?? []
  if (!query) return source
  return source
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.code.toLowerCase().includes(query) ||
          item.name.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.items.length > 0)
})

const held = computed(() => auth.permissions)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    catalog.value = await fetchPermissionCatalog()
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <AppShell title="权限目录" subtitle="全系统权限码的唯一真源（只读）">
    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <SystemTabs />

      <div class="flex flex-wrap items-center gap-3">
        <DtInput
          v-model="keyword"
          class="w-72"
          size="sm"
          placeholder="搜索权限码或名称"
        >
          <template #leading><DtIcon name="search" :size="14" /></template>
        </DtInput>
        <DtSegmented
          v-model="view"
          class="ml-auto"
          :options="VIEW_OPTIONS"
          aria-label="切换展示方式"
        />
      </div>

      <DtPageState
        class="min-h-0 flex-1"
        :loading="loading"
        :error="error"
        :empty="groups.length === 0"
        empty-hint="没有匹配的权限码"
        @retry="load()"
      >
        <!-- ⚠ 这一页是「若干个分组各一张小表」，滚动归这一层，
             每张小表都按内容高度渲染（fill=false），否则它们会互相抢高度 -->
        <div class="flex h-full min-h-0 flex-col gap-5 overflow-y-auto pr-1">
          <DtCard
            v-for="group in groups"
            :key="group.code"
            :title="group.label"
            :subtitle="`${group.items.length} 个码`"
            padding="sm"
          >
            <DtDataView
              :columns="COLUMNS"
              :rows="group.items"
              :view="view"
              :toggle="false"
              :fill="false"
              min-width="48rem"
              :card-columns="3"
            >
              <template #cell-name="{ row }">{{ row.name }}</template>

              <template #cell-code="{ row }">
                <code class="text-accent-secondary">{{ row.code }}</code>
              </template>

              <template #cell-kind="{ row }">
                <div class="flex items-center gap-1.5">
                  <DtTag :intent="KIND_META[row.kind].intent">
                    {{ KIND_META[row.kind].label }}
                  </DtTag>
                  <DtTag v-if="row.is_builtin">内置</DtTag>
                </div>
              </template>

              <template #cell-held="{ row }">
                <DtTag v-if="held.has(row.code)" intent="success">持有</DtTag>
                <span v-else>—</span>
              </template>

              <template #cell-description="{ row }">
                {{ row.description || '—' }}
              </template>
            </DtDataView>
          </DtCard>
        </div>
      </DtPageState>
    </div>
  </AppShell>
</template>
