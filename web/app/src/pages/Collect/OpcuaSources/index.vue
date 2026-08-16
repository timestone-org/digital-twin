<script setup lang="ts">
/**
 * @fileoverview OPC UA 采集数据源列表：去连现场设备的那一侧。
 *
 * ⚠ 与「工具 / OPC UA 服务端」方向相反：那边本平台是服务端、被上位机连；
 * 这边本平台是客户端、去连 PLC（docs/COLLECT_DESIGN.md §1）。
 *
 * ⚠ 每行同时显示「配置启用」与「采集运行态」两件事，不合成一个灯：停用的源
 * 与启用但连不上的源，处置完全不同。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import type { CollectSource, DtDataColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtIcon,
  DtInput,
  DtNotice,
  DtTag,
  useConfirm,
  useToast,
} from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import SourceFormDialog from './components/SourceFormDialog.vue'
import SourceStateTag from './components/SourceStateTag.vue'
import { missingPoints } from './sourceState'

/** 运行态刷新周期。⚠ 只刷列表这一页，不随数据源数量增长。 */
const REFRESH_MS = 10_000

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', card: 'title' },
  { key: 'endpoint', label: '端点', width: '18rem' },
  { key: 'state', label: '采集状态', width: '11rem' },
  { key: 'points', label: '点位', width: '8rem', card: 'meta' },
  { key: 'read', label: '读取方式', width: '9rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '15rem',
    card: 'actions',
  },
]

const toast = useToast()
const confirm = useConfirm()

const keyword = ref('')
const view = useViewMode('collect-opcua-sources')

const list = useAsyncList<CollectSource>((query) =>
  collect.listSources({ q: keyword.value || undefined, ...query }),
)

const formOpen = ref(false)
const editing = ref<CollectSource | null>(null)
/** 正在做连通性测试的数据源 id。 */
const testing = ref<string | null>(null)

/** 有几个源配了点位却没在采。它是「配了没人读」最外层的一道提示。 */
const stalledCount = computed(
  () =>
    list.items.value.filter(
      (item) =>
        item.is_enabled &&
        item.point_count > 0 &&
        item.runtime.state !== 'online',
    ).length,
)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}

function openEdit(source: CollectSource): void {
  editing.value = source
  formOpen.value = true
}

async function afterWrite(message: string): Promise<void> {
  formOpen.value = false
  toast.success(message)
  await list.reload()
}

async function create(
  input: Parameters<typeof collect.createSource>[0],
): Promise<void> {
  try {
    await collect.createSource(input)
    await afterWrite('数据源已创建')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function update(
  input: Parameters<typeof collect.updateSource>[1],
): Promise<void> {
  const target = editing.value
  if (target === null) return
  try {
    await collect.updateSource(target.id, input)
    await afterWrite('数据源已保存')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

/** 连通性测试。⚠ 连不上也是成功返回，结论在 `is_reachable` 里。 */
async function test(source: CollectSource): Promise<void> {
  testing.value = source.id
  try {
    const result = await collect.testSource(source.id)
    if (result.is_reachable) toast.success(`「${source.name}」连得上`)
    else toast.error(result.detail ?? `「${source.name}」连不上`)
  } catch (caught) {
    toast.error(describeError(caught))
  } finally {
    testing.value = null
  }
}

async function remove(source: CollectSource): Promise<void> {
  const ok = await confirm.ask({
    title: '删除数据源',
    message:
      source.point_count > 0
        ? `「${source.name}」下还有 ${source.point_count} 个点位，需要先把点位删干净——` +
          '点位一走，绑着它的大屏会悄悄失去数据源，所以不做级联删除。'
        : `删除「${source.name}」不可恢复。它的历史归档会保留，按编码归档。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await collect.deleteSource(source.id)
    toast.success('数据源已删除')
    await list.reload()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void list.reload()
  // ⚠ 运行态来自另一个服务，只能靠轮询刷新；卸载时必须清掉，否则切走的页面
  // 还在打接口并更新已经不在的状态
  timer = setInterval(() => void list.reload(), REFRESH_MS)
})

onUnmounted(() => {
  if (timer !== null) clearInterval(timer)
  timer = null
})
</script>

<template>
  <AppShell title="OPC UA 采集" subtitle="去连现场设备的数据源与点位">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.collectManage]">
        <DtButton size="sm" icon="plus" @click="openCreate">
          新建数据源
        </DtButton>
      </PermGuard>
    </template>

    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="stalledCount > 0" intent="warning" icon="alert-triangle">
        有 {{ stalledCount }}
        个已启用的数据源当前不在采集，它们的点位不会产生任何数据。
      </DtNotice>

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :layout="{ minWidth: '68rem', cardColumns: 3, cardMinWidth: '22rem' }"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #toolbar>
          <DtInput
            v-model="keyword"
            class="w-72"
            size="sm"
            placeholder="搜索名称或编码"
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

        <template #summary>共 {{ list.total.value }} 个数据源</template>

        <template #cell-name="{ row }">
          <RouterLink
            class="font-medium text-accent-on-surface"
            :to="`/collect/opcua/${row.id}`"
          >
            {{ row.name }}
          </RouterLink>
          <DtTag class="ml-2" mono size="sm">{{ row.code }}</DtTag>
        </template>

        <template #cell-endpoint="{ row }">
          <span class="font-mono text-xs break-all">{{ row.endpoint }}</span>
        </template>

        <template #cell-state="{ row }">
          <SourceStateTag :runtime="row.runtime" :is-enabled="row.is_enabled" />
        </template>

        <template #cell-points="{ row }">
          <div class="flex flex-col">
            <span>{{ row.point_count }}</span>
            <span
              v-if="missingPoints(row.point_count, row.runtime) !== null"
              class="text-xs text-warning"
            >
              {{ missingPoints(row.point_count, row.runtime) }} 个没订上
            </span>
          </div>
        </template>

        <template #cell-read="{ row }">
          <span class="text-sm">
            {{ row.read_mode === 'poll' ? '轮询' : '订阅' }}
          </span>
          <span class="ml-1 text-xs text-muted">
            {{ row.poll_interval_ms }}ms
          </span>
        </template>

        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end gap-1">
            <PermGuard :codes="[PERMISSION_CODES.collectOperate]">
              <DtButton
                variant="ghost"
                size="sm"
                :loading="testing === row.id"
                @click="test(row)"
              >
                测试
              </DtButton>
            </PermGuard>
            <PermGuard :codes="[PERMISSION_CODES.collectManage]">
              <DtButton variant="ghost" size="sm" @click="openEdit(row)">
                编辑
              </DtButton>
              <DtButton
                variant="ghost"
                size="sm"
                intent="danger"
                @click="remove(row)"
              >
                删除
              </DtButton>
            </PermGuard>
          </div>
        </template>
      </DtDataView>
    </div>

    <SourceFormDialog
      v-model="formOpen"
      :source="editing"
      @create="create"
      @update="update"
    />
  </AppShell>
</template>
