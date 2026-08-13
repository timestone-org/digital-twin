<script setup lang="ts">
/**
 * @fileoverview OPC UA 服务端实例列表。
 *
 * ⚠ 停止与重启会**断开该实例上全部上位机会话**，所以这两个动作一律二次确认
 * 并把后果写进确认文案里——现场的 SCADA 掉线不是一句「操作成功」能交代的。
 */
import { computed, onMounted, ref } from 'vue'
import type { DtDataColumn, OpcuaInstance } from '@dt/contracts'
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

import * as opcua from '@/api/opcua'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import InstanceFormDialog from './components/InstanceFormDialog.vue'
import InstanceStatusTag from './components/InstanceStatusTag.vue'
import { pendingSummary } from './pendingFields'

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

const toast = useToast()
const confirm = useConfirm()

const keyword = ref('')
const view = useViewMode('tools-opcua-servers')

const list = useAsyncList<OpcuaInstance>((query) =>
  opcua.listInstances({ q: keyword.value || undefined, ...query }),
)

const formOpen = ref(false)
const editing = ref<OpcuaInstance | null>(null)

const pendingCount = computed(
  () => list.items.value.filter((item) => item.has_pending_restart).length,
)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}

function openEdit(instance: OpcuaInstance): void {
  editing.value = instance
  formOpen.value = true
}

async function afterWrite(message: string): Promise<void> {
  formOpen.value = false
  toast.success(message)
  await list.reload()
}

async function create(
  input: Parameters<typeof opcua.createInstance>[0],
): Promise<void> {
  try {
    await opcua.createInstance(input)
    await afterWrite('实例已创建')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function update(
  input: Parameters<typeof opcua.updateInstance>[1],
): Promise<void> {
  const target = editing.value
  if (target === null) return
  try {
    const saved = await opcua.updateInstance(target.id, input)
    await afterWrite(
      saved.pending_fields.length > 0
        ? pendingSummary(saved.pending_fields)
        : '实例已保存',
    )
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

/** 起停。⚠ 停与重启的确认文案必须说清「会断开全部上位机会话」。 */
async function act(
  instance: OpcuaInstance,
  verb: 'start' | 'stop' | 'restart',
): Promise<void> {
  if (verb !== 'start') {
    const ok = await confirm.ask({
      title: verb === 'stop' ? '停止实例' : '重启实例',
      message:
        `「${instance.name}」上当前有 ${instance.session_count} 个上位机会话，` +
        '这些连接会全部断开，需要对方自行重连。',
      confirmText: verb === 'stop' ? '停止' : '重启',
      danger: true,
    })
    if (!ok) return
  }
  try {
    await opcua.actOnInstance(instance.id, verb)
    toast.success(
      { start: '实例已启动', stop: '实例已停止', restart: '实例已重启' }[verb],
    )
    await list.reload()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function remove(instance: OpcuaInstance): Promise<void> {
  const ok = await confirm.ask({
    title: '删除实例',
    message:
      `删除「${instance.name}」会一并删掉它的 ${instance.node_count} 个节点、` +
      '接入凭据与信任证书，且端口会退回池中。此操作不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await opcua.deleteInstance(instance.id)
    toast.success('实例已删除')
    await list.reload()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

onMounted(() => {
  void list.reload()
})
</script>

<template>
  <AppShell title="OPC UA 服务端" subtitle="对上位系统暴露的 opc.tcp 端点">
    <template #actions>
      <div class="flex items-center gap-2">
        <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
          <DtButton size="sm" icon="plus" @click="openCreate">
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
                @click="act(row, 'start')"
              >
                启动
              </DtButton>
              <DtButton
                v-else
                size="sm"
                variant="ghost"
                @click="act(row, 'stop')"
              >
                停止
              </DtButton>
            </PermGuard>
            <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
              <DtButton size="sm" variant="ghost" @click="openEdit(row)">
                编辑
              </DtButton>
              <DtButton
                size="sm"
                variant="ghost"
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

    <InstanceFormDialog
      v-model="formOpen"
      :instance="editing"
      @create="create"
      @update="update"
    />
  </AppShell>
</template>
