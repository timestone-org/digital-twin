<script setup lang="ts">
/**
 * @fileoverview 地址空间：左树右详情。
 *
 * 这一屏要让「找到某个点 → 看它现在多少 → 改一个值」这条路尽量短，所以
 * 搜索框、树、详情同屏，选中不跳页；搜索时整棵树临时全展开——搜出来却
 * 藏在折叠的分支里等于没搜。
 *
 * ⚠ 加/删节点是热生效的（实例在跑时立即对上位机可见），改 BrowseName、
 * 数据类型这些要重启——两者的回执分别处理，不能都说「已保存」。
 */
import { computed, onMounted, ref, watch } from 'vue'

import type { OpcuaInstance, OpcuaNode } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCard,
  DtEmpty,
  DtIcon,
  DtInput,
  DtNotice,
  DtSpinner,
  useConfirm,
  useToast,
} from '@dt/ui'

import * as opcua from '@/api/opcua'
import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { pendingSummary } from '../../OpcuaServers/scripts/pendingFields'
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

const toast = useToast()
const confirm = useConfirm()
const raced = useRacedFetch()

/** 一次拉多少节点。⚠ 超出这个数的实例，树是不完整的，见下方提示。 */
const NODE_PAGE_SIZE = 200

const nodes = ref<OpcuaNode[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const formOpen = ref(false)
const keyword = ref('')
const expanded = ref<ReadonlySet<string>>(new Set())

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

async function loadNodes(): Promise<void> {
  loading.value = true
  error.value = null
  await raced.run(
    () => opcua.listNodes(instanceId.value, { size: NODE_PAGE_SIZE }),
    {
      ok: (page) => {
        nodes.value = page.items
        // 默认全展开：地址空间是拿来找东西的，进来先看见全貌
        expanded.value = new Set(expandableIds(buildNodeTree(page.items)))
        if (selectedId.value === null && page.items.length > 0) {
          selectedId.value = page.items[0]?.id ?? null
        }
      },
      fail: (caught) => {
        error.value = describeError(caught)
        nodes.value = []
      },
      settled: () => (loading.value = false),
    },
  )
}

async function createNode(
  input: Parameters<typeof opcua.createNode>[1],
): Promise<void> {
  try {
    const result = await opcua.createNode(instanceId.value, input)
    formOpen.value = false
    // 加节点是热生效的；真有未生效字段时照实说，不许一律报「已创建」
    toast.success(
      result.pending_fields.length > 0
        ? pendingSummary(result.pending_fields)
        : '节点已创建，上位机当前即可浏览到',
    )
    await loadNodes()
    selectedId.value = result.node.id
  } catch (caught) {
    // ⚠ 标识冲突只报错，绝不「帮用户改个名重试」——上位系统的组态
    // 硬编码着 NodeId，服务端替它换一个，现场所有组态一起废
    toast.error(describeError(caught))
  }
}

async function removeNode(node: OpcuaNode): Promise<void> {
  const ok = await confirm.ask({
    title: '删除节点',
    message:
      `删除「${node.browse_name}」会连同它的子节点一起从地址空间移除，` +
      '正在读它的上位机会立刻读不到。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await opcua.deleteNode(instanceId.value, node.id)
    if (selectedId.value === node.id) selectedId.value = null
    toast.success('节点已删除')
    await loadNodes()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

onMounted(() => {
  void loadNodes()
})
</script>

<template>
  <div
    class="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(18rem,30rem)_minmax(0,1fr)]"
  >
    <DtCard class="flex min-h-0 flex-col">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h3 class="m-0 text-sm font-medium">地址空间</h3>
        <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
          <DtButton
            size="sm"
            variant="outline"
            icon="plus"
            @click="formOpen = true"
          >
            新建节点
          </DtButton>
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
      <DtNotice v-else-if="error" intent="danger" icon="alert-triangle">
        {{ error }}
      </DtNotice>
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

      <p class="m-0 mt-2 text-2xs text-text-disabled">
        <span v-if="searching"
          >命中 {{ matchCount }} / {{ nodes.length }} 个节点</span
        >
        <span v-else>共 {{ nodes.length }} 个节点</span>
      </p>

      <!-- ⚠ 超出一页的节点其父子关系会被截断，如实说出来，不要让人以为
           地址空间本来就长这样 -->
      <DtNotice
        v-if="nodes.length >= NODE_PAGE_SIZE"
        intent="warning"
        icon="alert-triangle"
      >
        只加载了前 {{ NODE_PAGE_SIZE }} 个节点，更深的层级可能显示不全。
      </DtNotice>
    </DtCard>

    <DtCard class="min-h-0">
      <DtEmpty
        v-if="selected === null"
        title="选一个节点"
        hint="左侧点一个，或用方向键在树里走"
      />
      <NodeDetailPanel
        v-else
        :instance-id="instance.id"
        :node="selected"
        :parent-name="parentName"
        @remove="removeNode"
      />
    </DtCard>

    <NodeFormDialog v-model="formOpen" :nodes="nodes" @create="createNode" />
  </div>
</template>
