<script setup lang="ts">
/** @fileoverview 上下游关系浏览、表单连接和连接移除。 */
import { computed, ref, watch } from 'vue'
import {
  DtButton,
  DtEmpty,
  DtIcon,
  DtIconButton,
  DtNotice,
  DtSegmented,
  DtSelect,
} from '@dt/ui'
import type { HierarchyEditor } from '../scripts/useHierarchyDocument'

const props = defineProps<{ editor: HierarchyEditor; readonly: boolean }>()
const emit = defineEmits<{ focus: [id: string] }>()
const direction = ref('downstream')
const targetId = ref('')
const node = computed(() => props.editor.selected.value)
const document = computed(() => props.editor.document.value)
const edge = computed(() =>
  document.value?.edges.find((item) => item.id === props.editor.edgeId.value),
)
const endpoints = computed(() =>
  edge.value
    ? [edge.value.source, edge.value.target].flatMap(
        (id) => document.value?.nodes.filter((item) => item.id === id) ?? [],
      )
    : [],
)
const groups = computed(() => [
  {
    key: 'upstream',
    label: '上游节点',
    icon: 'arrow-up',
    items: relatives(true),
  },
  {
    key: 'downstream',
    label: '下游节点',
    icon: 'arrow-down',
    items: relatives(false),
  },
])
const options = computed(() => {
  const current = node.value
  if (!current) return []
  const connected = new Set(
    relatives(direction.value === 'upstream').map((item) => item.node.id),
  )
  return (document.value?.nodes ?? [])
    .filter(
      (item) =>
        item.id !== current.id &&
        !connected.has(item.id) &&
        !(item.kind === 'junction' && current.kind === 'junction'),
    )
    .map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))
})
const canConnect = computed(() =>
  options.value.some((item) => item.value === targetId.value),
)
watch([() => node.value?.id, direction], () => {
  targetId.value = ''
})

function relatives(upstream: boolean) {
  const current = node.value
  const value = document.value
  if (!current || !value) return []
  return value.edges.flatMap((connection) => {
    const isRelated = upstream
      ? connection.target === current.id
      : connection.source === current.id
    const relative = value.nodes.find(
      (item) => item.id === (upstream ? connection.source : connection.target),
    )
    return isRelated && relative ? [{ id: connection.id, node: relative }] : []
  })
}
function connect() {
  if (props.readonly || !canConnect.value || !node.value) return
  const source = direction.value === 'upstream' ? targetId.value : node.value.id
  const target = direction.value === 'upstream' ? node.value.id : targetId.value
  props.editor.connect(source, target)
  if (
    document.value?.edges.some(
      (item) => item.source === source && item.target === target,
    )
  )
    targetId.value = ''
}
function disconnect(id: string) {
  const current = document.value
  if (!current || props.readonly) return
  props.editor.commit({
    ...current,
    edges: current.edges.filter((item) => item.id !== id),
  })
  if (props.editor.edgeId.value === id) props.editor.select([])
}
</script>

<template>
  <div v-if="edge" class="flex flex-col gap-4">
    <h3 class="text-sm font-semibold">已选择连接</h3>
    <div
      class="flex flex-col items-stretch gap-2 rounded-md bg-surface-sunken p-3"
    >
      <template v-for="(endpoint, index) in endpoints" :key="endpoint.id">
        <DtIcon
          v-if="index"
          name="arrow-down"
          :size="16"
          class="self-center text-text-secondary"
        />
        <DtButton
          size="sm"
          variant="outline"
          @click="emit('focus', endpoint.id)"
        >
          {{ endpoint.code }} · {{ endpoint.name }}
        </DtButton>
      </template>
    </div>
    <p class="text-xs text-text-secondary">
      连接方向由上游指向下游。移除连接会保留两端节点。
    </p>
    <DtButton
      v-if="!readonly"
      size="sm"
      intent="danger"
      variant="outline"
      @click="disconnect(edge.id)"
    >
      移除这条连接
    </DtButton>
  </div>
  <DtNotice v-else-if="editor.selectedIds.value.length > 1"
    >请选择单个节点查看和配置上下游关系。
  </DtNotice>
  <div v-else-if="node" class="flex flex-col gap-5">
    <div class="min-w-0">
      <h3 class="truncate text-sm font-semibold" :title="node.name">
        {{ node.code }} · {{ node.name }}
      </h3>
      <p class="mt-1 text-xs text-text-secondary">
        点击关联节点，可在画布中定位
      </p>
    </div>
    <section
      v-if="!readonly"
      class="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-sunken p-3"
    >
      <h4 class="text-sm font-medium">添加连接</h4>
      <DtSegmented
        v-model="direction"
        :options="[
          { value: 'upstream', label: '添加上游' },
          { value: 'downstream', label: '添加下游' },
        ]"
        block
        aria-label="连接方向"
      />
      <DtSelect
        v-model="targetId"
        :options="options"
        label="连接节点"
        :display="{ searchable: true, placeholder: '搜索并选择节点' }"
      />
      <DtButton
        size="sm"
        variant="outline"
        :disabled="!canConnect"
        @click="connect"
      >
        建立连接
      </DtButton>
      <p class="text-xs leading-relaxed text-text-secondary">
        支持多个上游；循环连接会被阻止。也可在画布中拖动输出端口到输入端口。
      </p>
    </section>
    <section
      v-for="group in groups"
      :key="group.key"
      class="flex flex-col gap-2"
    >
      <h4
        class="flex items-center gap-2 text-xs font-medium text-text-secondary"
      >
        <DtIcon :name="group.icon" :size="14" />{{ group.label
        }}<span class="ml-auto">
          {{ group.items.length }}
        </span>
      </h4>
      <div
        v-for="relative in group.items"
        :key="relative.id"
        class="relation-row"
      >
        <DtButton
          size="sm"
          variant="ghost"
          class="min-w-0 flex-1"
          :title="relative.node.name"
          @click="emit('focus', relative.node.id)"
        >
          <span class="block truncate">
            {{ relative.node.code }} · {{ relative.node.name }}
          </span>
        </DtButton>
        <DtIconButton
          v-if="!readonly"
          icon="close"
          :label="`移除与 ${relative.node.code} 的连接`"
          @click="disconnect(relative.id)"
        />
      </div>
      <p
        v-if="!group.items.length"
        class="rounded-md bg-surface-sunken p-3 text-xs text-text-secondary"
      >
        暂无{{ group.label }}
      </p>
    </section>
  </div>
  <DtEmpty
    v-else
    icon="network"
    title="查看节点之间的关系"
    hint="选择一个节点或一条连接，即可查看上下游。"
  />
</template>

<style scoped lang="scss">
.relation-row {
  display: flex;
  min-width: 0;
  align-items: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 4px;
}
</style>
