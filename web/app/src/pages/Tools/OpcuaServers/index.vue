<script setup lang="ts">
/**
 * @fileoverview OPC UA 服务端实例列表。
 *
 * ⚠ 停止与重启会**断开该实例上全部上位机会话**，所以这两个动作一律二次确认
 * 并把后果写进确认文案里——现场的 SCADA 掉线不是一句「操作成功」能交代的。
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import type { DtDataColumn, OpcuaInstance } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtIcon, DtInput, DtNotice, DtTag } from '@dt/ui'

import * as opcua from '@/api/opcua'
import { listEmptyState } from '@/utils/listEmpty'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import InstanceFormDialog from './components/InstanceFormDialog.vue'
import InstanceStatusTag from './components/InstanceStatusTag.vue'
import { useInstanceOps } from './scripts/useInstanceOps'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', card: 'title' },
  { key: 'endpoint', label: '端点' },
  { key: 'port', label: '端口', width: '6rem', card: 'meta' },
  { key: 'status', label: '状态', width: '11rem' },
  { key: 'counts', label: '节点 / 会话', width: '9rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '14rem',
    card: 'actions',
  },
]

const keyword = ref('')

// ⚠ 搜不到与「一台都没建过」是两回事：合成一种的话，关键词打错一个字，
// 界面就在劝人再建一个实例（见 utils/listEmpty）
const emptyState = computed(() =>
  listEmptyState({
    isFiltered: keyword.value.trim() !== '',
    subject: '实例',
    keyword: keyword.value,
    blank: {
      title: '还没有实例',
      hint: '建一个实例，把选中的点位按 opc.tcp 端点暴露给上位系统。',
    },
  }),
)
const view = useViewMode('tools-opcua-servers')

const list = useAsyncList<OpcuaInstance>((query) =>
  opcua.listInstances({ q: keyword.value || undefined, ...query }),
)

const ops = useInstanceOps(() => list.reload())

const pendingCount = computed(
  () => list.items.value.filter((item) => item.has_pending_restart).length,
)

onMounted(() => {
  void list.reload()
})
</script>

<template>
  <AppShell title="OPC UA 服务端" subtitle="对上位系统暴露的 opc.tcp 端点">
    <template #actions>
      <div class="flex items-center gap-2">
        <PermGuard :codes="[PERMISSION_CODES.opcuaManage]" explain>
          <DtButton size="sm" icon="plus" @click="ops.openCreate">
            新建实例
          </DtButton>
        </PermGuard>
      </div>
    </template>

    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="pendingCount > 0" intent="warning" icon="alert-triangle">
        有
        {{ pendingCount }}
        个实例存在已保存但未生效的改动，需重启后才对上位机可见。
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
        :layout="{ minWidth: '64rem', cardColumns: 3, cardMinWidth: '22rem' }"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #toolbar>
          <DtInput
            v-model="keyword"
            class="w-72"
            size="sm"
            placeholder="搜索实例名称"
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

        <template #summary>共 {{ list.total.value }} 个实例</template>

        <template #cell-name="{ row }">
          <RouterLink
            class="font-medium text-accent-on-surface"
            :to="`/tools/opcua-servers/${row.id}`"
          >
            {{ row.name }}
          </RouterLink>
          <p
            v-if="row.description"
            class="m-0 mt-1 text-2xs text-text-disabled"
          >
            {{ row.description }}
          </p>
        </template>

        <template #cell-endpoint="{ row }">
          <span class="font-mono text-xs text-text-secondary">
            {{ row.endpoint_url }}
          </span>
        </template>

        <template #cell-port="{ row }">
          <span class="font-mono">{{ row.port }}</span>
        </template>

        <template #cell-status="{ row }">
          <div class="flex flex-wrap items-center gap-1">
            <InstanceStatusTag
              :is-running="row.is_running"
              :desired-state="row.desired_state"
            />
            <DtTag v-if="row.has_pending_restart" intent="warning" size="sm">
              待重启生效
            </DtTag>
            <DtTag v-if="row.is_autostart" intent="info" size="sm">自启</DtTag>
          </div>
        </template>

        <template #cell-counts="{ row }">
          <span class="font-mono text-xs">
            {{ row.node_count }} / {{ row.session_count }}
          </span>
        </template>

        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end gap-1">
            <PermGuard :codes="[PERMISSION_CODES.opcuaOperate]">
              <DtButton
                v-if="!row.is_running"
                size="sm"
                variant="ghost"
                @click="ops.act(row, 'start')"
              >
                启动
              </DtButton>
              <DtButton
                v-else
                size="sm"
                variant="ghost"
                @click="ops.act(row, 'stop')"
              >
                停止
              </DtButton>
            </PermGuard>
            <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
              <DtButton size="sm" variant="ghost" @click="ops.openEdit(row)">
                编辑
              </DtButton>
              <DtButton
                size="sm"
                variant="ghost"
                intent="danger"
                @click="ops.remove(row)"
              >
                删除
              </DtButton>
            </PermGuard>
          </div>
        </template>
      </DtDataView>
    </div>

    <InstanceFormDialog
      v-model="ops.formOpen.value"
      :instance="ops.editing.value"
      @create="ops.create"
      @update="ops.update"
    />
  </AppShell>
</template>
