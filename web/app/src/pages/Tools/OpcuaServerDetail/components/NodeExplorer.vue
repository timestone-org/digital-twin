<script setup lang="ts">
/**
 * @fileoverview 地址空间：左侧节点树，右侧交给 NodeValuePanel。
 *
 * ⚠ 加/删节点是热生效的（实例在跑时立即对上位机可见），改 BrowseName、
 * 数据类型这些要重启——两者的回执分别处理，不能都说「已保存」。
 */
import { computed, onMounted, ref } from 'vue'
import type { OpcuaInstance, OpcuaNode } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCard,
  DtEmpty,
  DtNotice,
  DtSpinner,
  useConfirm,
  useToast,
} from '@dt/ui'

import * as opcua from '@/api/opcua'
import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { pendingSummary } from '../../OpcuaServers/pendingFields'
import { buildNodeTree, flattenNodeTree } from '../nodeTree'
import NodeFormDialog from './NodeFormDialog.vue'
import NodeTreeList from './NodeTreeList.vue'
import NodeValuePanel from './NodeValuePanel.vue'

const props = defineProps<{ instance: OpcuaInstance }>()

const toast = useToast()
const confirm = useConfirm()
const raced = useRacedFetch()

const nodes = ref<OpcuaNode[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const formOpen = ref(false)

const instanceId = computed(() => props.instance.id)
const rows = computed(() => flattenNodeTree(buildNodeTree(nodes.value)))
const selected = computed(
  () => nodes.value.find((node) => node.id === selectedId.value) ?? null,
)

async function loadNodes(): Promise<void> {
  loading.value = true
  error.value = null
  await raced.run(() => opcua.listNodes(instanceId.value, { size: 200 }), {
    ok: (page) => {
      nodes.value = page.items
      if (selectedId.value === null && page.items.length > 0) {
        selectedId.value = page.items[0]?.id ?? null
      }
    },
    fail: (caught) => {
      error.value = describeError(caught)
      nodes.value = []
    },
    settled: () => (loading.value = false),
  })
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
  <div class="grid gap-4 lg:grid-cols-[minmax(18rem,1fr)_1.4fr]">
    <DtCard class="min-h-0">
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

      <DtSpinner v-if="loading" />
      <DtNotice v-else-if="error" intent="danger" icon="alert-triangle">
        {{ error }}
      </DtNotice>
      <DtEmpty
        v-else-if="rows.length === 0"
        title="还没有节点"
        hint="建一个变量节点，上位机就能读到它"
      />
      <NodeTreeList
        v-else
        :rows="rows"
        :selected-id="selectedId"
        @select="selectedId = $event"
      />
    </DtCard>

    <DtCard>
      <DtEmpty v-if="selected === null" title="选一个节点" hint="左侧点一个" />
      <NodeValuePanel
        v-else
        :instance-id="instance.id"
        :node="selected"
        @remove="removeNode"
      />
    </DtCard>

    <NodeFormDialog v-model="formOpen" :nodes="nodes" @create="createNode" />
  </div>
</template>
