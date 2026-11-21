<script setup lang="ts">
/**
 * @fileoverview 浏览实例的地址空间，管理节点与配置。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type {
  OpcuaInstance,
  OpcuaNode,
  OpcuaNodeCreateInput,
  OpcuaNodeUpdateInput,
} from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCard,
  DtEmpty,
  DtIcon,
  DtInput,
  DtPageState,
  DtResizableLayout,
  DtSpinner,
  useConfirm,
  useToast,
  DtIconButton,
} from '@dt/ui'

import * as opcua from '@/api/opcua'
import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { pendingSummary } from '../../scripts/pendingFields'
import {
  ancestorIds,
  buildNodeTree,
  expandableIds,
  filterNodeTree,
  visibleRows,
} from '../scripts/nodeTree'
import NodeDetailPanel from './NodeDetailPanel.vue'
import NodeFormDialog from './NodeFormDialog.vue'
import NodeTree from './NodeTree.vue'

const props = defineProps<{ instance: OpcuaInstance }>()
const emit = defineEmits<{ 'configuration-changed': [] }>()

const toast = useToast()
const confirm = useConfirm()
const raced = useRacedFetch()

const NODE_PAGE_SIZE = 200

const nodes = ref<OpcuaNode[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const formOpen = ref(false)
const editing = ref<OpcuaNode | null>(null)
const mutating = ref(false)
const keyword = ref('')
const expanded = ref<ReadonlySet<string>>(new Set())
let active = true

const instanceId = computed(() => props.instance.id)
const roots = computed(() => buildNodeTree(nodes.value))
const searching = computed(() => keyword.value.trim() !== '')
const filtered = computed(() => filterNodeTree(roots.value, keyword.value))
const rows = computed(() =>
  visibleRows(filtered.value, expanded.value, searching.value),
)
const matchCount = computed(
  () => visibleRows(filtered.value, new Set(), true).length,
)
const selected = computed(
  () => nodes.value.find((node) => node.id === selectedId.value) ?? null,
)
const parentName = computed(() => {
  const parentId = selected.value?.parent_id ?? null
  if (parentId === null) return null
  return nodes.value.find((node) => node.id === parentId)?.browse_name ?? null
})

function expandAll(): void {
  expanded.value = new Set(expandableIds(roots.value))
}

function collapseAll(): void {
  expanded.value = new Set()
}

function toggle(nodeId: string): void {
  const next = new Set(expanded.value)
  if (next.has(nodeId)) next.delete(nodeId)
  else next.add(nodeId)
  expanded.value = next
}

function setExpanded(nodeId: string, open: boolean): void {
  const next = new Set(expanded.value)
  if (open) next.add(nodeId)
  else next.delete(nodeId)
  expanded.value = next
}

// 选中深处的节点后要把这条路展开，否则选中了却看不见它在哪
watch(selectedId, (id) => {
  if (id === null) return
  const trail = ancestorIds(roots.value, id)
  if (trail.length === 0) return
  const next = new Set(expanded.value)
  for (const ancestor of trail) next.add(ancestor)
  expanded.value = next
})

class AddressSpaceReadError extends Error {}

const CHANGED_TREE_MESSAGE = '节点列表在读取期间发生变化，请刷新后重试。'

/** 逐页读取节点，保持树与父节点选择覆盖完整地址空间。 */
async function listAddressSpace(
  id: string,
  signal: AbortSignal,
): Promise<OpcuaNode[]> {
  const first = await opcua.listNodes(
    id,
    { page: 1, size: NODE_PAGE_SIZE },
    signal,
  )
  const all = new Map(first.items.map((node) => [node.id, node]))
  const lastPage = Math.ceil(first.total / first.size)
  if (lastPage > 1 && !first.revision) {
    throw new AddressSpaceReadError(
      '服务端需支持同版本分页才能读取完整地址空间。',
    )
  }
  for (let page = 2; page <= lastPage; page += 1) {
    signal.throwIfAborted()
    const next = await opcua.listNodes(
      id,
      { page, size: NODE_PAGE_SIZE },
      signal,
    )
    if (
      next.revision !== first.revision ||
      next.total !== first.total ||
      next.page !== page ||
      next.size !== first.size
    ) {
      throw new AddressSpaceReadError(CHANGED_TREE_MESSAGE)
    }
    for (const node of next.items) all.set(node.id, node)
  }
  if (all.size !== first.total)
    throw new AddressSpaceReadError(CHANGED_TREE_MESSAGE)
  return [...all.values()]
}

async function loadNodes(preferredId?: string): Promise<void> {
  loading.value = true
  error.value = null
  const id = instanceId.value
  await raced.run((signal) => listAddressSpace(id, signal), {
    ok: (items) => {
      nodes.value = items
      expanded.value = new Set(expandableIds(buildNodeTree(items)))
      const wanted = preferredId ?? selectedId.value
      selectedId.value =
        items.find((node) => node.id === wanted)?.id ?? items[0]?.id ?? null
    },
    fail: (caught) => {
      error.value =
        caught instanceof AddressSpaceReadError
          ? caught.message
          : describeError(caught)
      nodes.value = []
    },
    settled: () => (loading.value = false),
  })
}

/** 保证确认和配置请求在同一时间只执行一次。@param change 节点操作 */
async function changeConfiguration(
  change: (id: string) => Promise<void>,
): Promise<void> {
  if (mutating.value) return
  mutating.value = true
  try {
    await change(instanceId.value)
  } catch (caught) {
    toast.error(describeError(caught))
  } finally {
    mutating.value = false
  }
}

function openForm(node: OpcuaNode | null): void {
  editing.value = node
  formOpen.value = true
}

function showSuccess(fields: readonly string[], message: string): void {
  toast.success(fields.length > 0 ? pendingSummary(fields) : message)
  emit('configuration-changed')
}

async function createNode(input: OpcuaNodeCreateInput): Promise<void> {
  await changeConfiguration(async (id) => {
    const result = await opcua.createNode(id, input)
    if (!active || id !== instanceId.value) return
    formOpen.value = false
    showSuccess(
      result.pending_fields,
      props.instance.is_running
        ? '节点已创建，上位机当前即可浏览到'
        : '节点已创建',
    )
    await loadNodes(result.node.id)
  })
}

async function updateNode(
  node: OpcuaNode,
  input: OpcuaNodeUpdateInput,
): Promise<void> {
  await changeConfiguration(async (id) => {
    const result = await opcua.updateNode(id, node.id, input)
    if (!active || id !== instanceId.value) return
    formOpen.value = false
    nodes.value = nodes.value.map((item) =>
      item.id === node.id ? result.node : item,
    )
    showSuccess(result.pending_fields, '节点配置已保存')
  })
}

async function removeNode(node: OpcuaNode): Promise<void> {
  await changeConfiguration(async (id) => {
    const ok = await confirm.ask({
      title: '删除节点',
      message: `删除「${node.browse_name}」会一并移除它的子节点。删除后，上位机将无法浏览或读取这些节点。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok || !active || id !== instanceId.value) return
    await opcua.deleteNode(id, node.id)
    if (!active || id !== instanceId.value) return
    if (selectedId.value === node.id) selectedId.value = node.parent_id
    showSuccess([], '节点已删除')
    await loadNodes()
  })
}

watch(
  instanceId,
  () => {
    formOpen.value = false
    selectedId.value = null
    nodes.value = []
    void loadNodes()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  active = false
  raced.cancel()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <DtResizableLayout
      class="min-h-0 flex-1"
      storage-key="dt.opcua-node-explorer.layout"
      :stack-at="800"
      :panes="[
        { id: 'tree', label: '地址空间', size: 35, minSize: 240 },
        { id: 'detail', label: '节点详情', size: 65, minSize: 280 },
      ]"
    >
      <template #tree>
        <DtCard class="flex min-h-0 flex-1 flex-col">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="m-0 text-sm font-medium">地址空间</h3>
            <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
              <DtIconButton
                size="sm"
                variant="outline"
                intent="primary"
                icon="plus"
                label="新建节点"
                :disabled="mutating || loading"
                @click="openForm(null)"
              />
            </PermGuard>
          </div>

          <div class="mb-2 flex items-center gap-1">
            <DtInput
              v-model="keyword"
              class="flex-1"
              size="sm"
              aria-label="搜索节点"
              placeholder="搜 BrowseName / 标识 / NodeId"
            >
              <template #leading><DtIcon name="search" :size="14" /></template>
            </DtInput>
            <DtButton
              size="sm"
              variant="ghost"
              aria-label="全部展开"
              @click="expandAll"
            >
              <DtIcon name="chevron-down" :size="14" />
            </DtButton>
            <DtButton
              size="sm"
              variant="ghost"
              aria-label="全部折叠"
              @click="collapseAll"
            >
              <DtIcon name="chevron-up" :size="14" />
            </DtButton>
          </div>

          <DtSpinner v-if="loading" />
          <DtPageState
            v-else-if="error"
            :error="error"
            :empty="false"
            @retry="loadNodes()"
          />
          <DtEmpty
            v-else-if="nodes.length === 0"
            title="还没有节点"
            hint="建一个变量节点，上位机就能读到它"
          />
          <DtEmpty
            v-else-if="rows.length === 0"
            title="没有匹配的节点"
            hint="换个关键词，或按标识、NodeId 搜"
          />
          <NodeTree
            v-else
            class="min-h-0 flex-1"
            :rows="rows"
            :selected-id="selectedId"
            @select="selectedId = $event"
            @toggle="toggle"
            @expand="setExpanded($event, true)"
            @collapse="setExpanded($event, false)"
          />

          <p
            v-if="!loading && !error"
            class="m-0 mt-2 text-2xs text-text-disabled"
          >
            <span v-if="searching"
              >命中 {{ matchCount }} / {{ nodes.length }} 个节点</span
            >
            <span v-else>共 {{ nodes.length }} 个节点</span>
          </p>
        </DtCard>
      </template>
      <template #detail>
        <DtCard class="min-h-0 flex-1 overflow-auto">
          <DtEmpty
            v-if="selected === null"
            title="选一个节点"
            hint="左侧点一个，或用方向键在树里走"
          />
          <NodeDetailPanel
            v-else
            :instance-id="instance.id"
            :is-running="instance.is_running"
            :has-pending-restart="instance.has_pending_restart"
            :node="selected"
            :parent-name="parentName"
            :config-busy="mutating || loading"
            @edit="openForm"
            @remove="removeNode"
          />
        </DtCard>
      </template>
    </DtResizableLayout>
    <NodeFormDialog
      v-model="formOpen"
      :nodes="nodes"
      :edit-node="editing"
      :busy="mutating"
      @create="createNode"
      @update="updateNode"
    />
  </div>
</template>
