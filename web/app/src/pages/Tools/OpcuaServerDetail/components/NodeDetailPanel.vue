<script setup lang="ts">
/**
 * @fileoverview 选中节点的全部信息、当前值与写值。
 *
 * 排版顺序照着人来这里要做的事：**先看值**，再写值，最后才是不常看的元数据。
 * 把「当前值」压在一堆字段下面，等于让最常用的信息最难找。
 *
 * ⚠ 写值改的是**上位系统读到的现场数据**，不是本地草稿，所以要二次确认。
 * ⚠ 取值走可替换的 `useNodeValue`：现在是轮询，PR-7 换成 WebSocket 时
 * 这个组件一行不用改。
 */
import { computed, ref, toRef, watch } from 'vue'

import type { OpcuaNode } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtIcon,
  DtInput,
  DtNotice,
  DtSpinner,
  DtTag,
  useConfirm,
  useToast,
} from '@dt/ui'

import * as opcua from '@/api/opcua'
import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import { copyText } from '@/utils/clipboard'
import {
  accessLabels,
  displayValue,
  isWritable,
  valueRankLabel,
} from '../nodeFacts'
import { useNodeValue } from '../useNodeValue'

const props = defineProps<{
  instanceId: string
  node: OpcuaNode
  /** 父节点的 BrowseName，根节点为 null。仅用于展示。 */
  parentName: string | null
}>()
const emit = defineEmits<{ remove: [node: OpcuaNode] }>()

const toast = useToast()
const confirm = useConfirm()
const draft = ref('')

const live = useNodeValue(
  toRef(props, 'instanceId'),
  toRef(() => props.node.id),
  toRef(() => props.node.identifier),
)

// 换节点时清掉上一个节点的草稿，否则会把 A 的输入误写进 B
watch(
  () => props.node.id,
  () => (draft.value = ''),
)

const isVariableLike = computed(() => props.node.node_class !== 'object')
const canWrite = computed(
  () => isVariableLike.value && isWritable(props.node.access_level),
)

/** 按原样送出的数据类型：转成数字会改变上位机拿到的类型。 */
const TEXTUAL_TYPES = new Set<string>([
  'string',
  'guid',
  'datetime',
  'byte_string',
])

/**
 * ⚠ 空输入不许下发：数值类型下 `Number('')` 是 0，那会是一次真实的写值，
 * 上位机立刻读到 0。切换节点会清掉草稿，此时按钮必须是灰的。
 */
const canSubmitDraft = computed(() => draft.value !== '')

/**
 * 把输入框里的字符串还原成该节点数据类型对应的值。
 * ⚠ 不做「看起来像数字就转成数字」的猜测：字符串节点写 `"12"` 与数值节点
 * 写 `12` 是两件事，猜错了上位机拿到的类型就不对。
 */
function parseDraft(): unknown {
  const raw = draft.value
  const type = props.node.data_type
  if (type === 'boolean') return raw === 'true' || raw === '1'
  if (type === null || TEXTUAL_TYPES.has(type)) return raw
  const parsed = Number(raw)
  return Number.isNaN(parsed) ? raw : parsed
}

async function copyNodeId(): Promise<void> {
  const ok = await copyText(props.node.node_id)
  if (ok) toast.success('NodeId 已复制')
  else toast.error('复制不了，请手动选中这段 NodeId')
}

/** ⚠ 写值有真实副作用，先确认再写。 */
async function write(): Promise<void> {
  const ok = await confirm.ask({
    title: '写入节点值',
    message:
      `「${props.node.browse_name}」的值会立刻变成 ${displayValue(parseDraft())}，` +
      '正在读它的上位机下一次采样就会拿到新值。',
    confirmText: '写入',
    danger: true,
  })
  if (!ok) return
  try {
    await opcua.writeNodeValue(props.instanceId, props.node.id, parseDraft())
    toast.success('值已写入')
    await live.refresh()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-auto">
    <header class="flex flex-col gap-1.5">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="m-0 text-base font-medium">{{ node.browse_name }}</h3>
        <DtTag size="sm">{{ node.node_class }}</DtTag>
        <DtTag v-if="node.data_type" mono size="sm">
          {{ node.data_type }}
        </DtTag>
      </div>
      <div class="flex items-center gap-1">
        <code class="font-mono text-2xs text-text-disabled">
          {{ node.node_id }}
        </code>
        <!-- 上位机组态里要粘的就是这一段，让它一键可取 -->
        <DtButton
          size="sm"
          variant="ghost"
          aria-label="复制 NodeId"
          @click="copyNodeId"
        >
          <DtIcon name="copy" :size="12" />
        </DtButton>
      </div>
      <p v-if="node.description" class="m-0 text-xs text-text-secondary">
        {{ node.description }}
      </p>
    </header>

    <section
      class="flex flex-col gap-2 rounded-md border border-border-subtle p-3"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-text-disabled">当前值</span>
        <DtButton
          size="sm"
          variant="ghost"
          :disabled="live.loading.value"
          @click="live.refresh()"
        >
          <DtSpinner v-if="live.loading.value" :size="12" />
          <DtIcon v-else name="refresh-cw" :size="12" />
          刷新
        </DtButton>
      </div>

      <p class="m-0 break-all font-mono text-xl">
        <span v-if="live.error.value" class="text-sm text-state-danger">
          {{ live.error.value }}
        </span>
        <span v-else>{{ displayValue(live.value.value?.value) }}</span>
      </p>

      <DtNotice
        v-if="live.value.value && !live.value.value.is_live"
        intent="info"
        icon="alert-circle"
      >
        实例未运行，这里显示的是库里的初值。实例的节点值不落库，重启后回到初值。
      </DtNotice>
    </section>

    <PermGuard v-if="canWrite" :codes="[PERMISSION_CODES.opcuaOperate]">
      <section class="flex flex-col gap-2">
        <DtNotice intent="warning" icon="alert-triangle">
          写值会立刻改变上位系统读到的现场数据。
        </DtNotice>
        <div class="flex items-center gap-2">
          <DtInput
            v-model="draft"
            class="flex-1"
            size="sm"
            aria-label="要写入的值"
            placeholder="要写入的值"
          />
          <DtButton size="sm" :disabled="!canSubmitDraft" @click="write">
            写入
          </DtButton>
        </div>
      </section>
    </PermGuard>
    <DtNotice v-else-if="isVariableLike" intent="info" icon="alert-circle">
      该节点的访问级别不含「可写」，上位机与这里都只能读。
    </DtNotice>

    <dl class="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
      <div>
        <dt class="text-text-disabled">标识</dt>
        <dd class="m-0 break-all font-mono">{{ node.identifier }}</dd>
      </div>
      <div>
        <dt class="text-text-disabled">标识种类</dt>
        <dd class="m-0 font-mono">{{ node.identifier_kind }}</dd>
      </div>
      <div>
        <dt class="text-text-disabled">父节点</dt>
        <dd class="m-0">{{ parentName ?? '（根）' }}</dd>
      </div>
      <div>
        <dt class="text-text-disabled">访问级别</dt>
        <dd class="m-0">{{ accessLabels(node.access_level).join(' · ') }}</dd>
      </div>
      <template v-if="isVariableLike">
        <div>
          <dt class="text-text-disabled">值维度</dt>
          <dd class="m-0">{{ valueRankLabel(node.value_rank) }}</dd>
        </div>
        <div>
          <dt class="text-text-disabled">数组维长</dt>
          <dd class="m-0 font-mono">
            {{ node.array_dimensions?.join(' × ') ?? '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-text-disabled">初值</dt>
          <dd class="m-0 break-all font-mono">
            {{ displayValue(node.initial_value) }}
          </dd>
        </div>
      </template>
    </dl>

    <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
      <div class="mt-auto pt-2">
        <DtButton
          size="sm"
          variant="ghost"
          intent="danger"
          @click="emit('remove', node)"
        >
          删除节点
        </DtButton>
      </div>
    </PermGuard>
  </div>
</template>
