<script setup lang="ts">
/**
 * @fileoverview 选中节点的当前值与写值。
 *
 * ⚠ 写值改的是**上位系统读到的现场数据**，不是本地草稿。
 * ⚠ 取值走可替换的 `useNodeValue`：现在是轮询，PR-7 换成 WebSocket 时
 * 这个组件一行不用改。
 */
import { ref, toRef } from 'vue'
import type { OpcuaNode } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtInput, DtNotice, useToast } from '@dt/ui'

import * as opcua from '@/api/opcua'
import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import { useNodeValue } from '../useNodeValue'

const props = defineProps<{ instanceId: string; node: OpcuaNode }>()
const emit = defineEmits<{ remove: [node: OpcuaNode] }>()

const toast = useToast()
const draft = ref('')

const live = useNodeValue(
  toRef(props, 'instanceId'),
  toRef(() => props.node.id),
)

/** 按原样送出的数据类型：转成数字会改变上位机拿到的类型。 */
const TEXTUAL_TYPES = new Set<string>([
  'string',
  'guid',
  'datetime',
  'byte_string',
])

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

/** 值的展示形式。undefined 与 null 要能区分开。 */
function displayValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  // 数组与结构体：JSON 化，别落到 '[object Object]'
  return JSON.stringify(value) ?? '—'
}

async function write(): Promise<void> {
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
  <div class="flex flex-col gap-4">
    <div>
      <h3 class="m-0 text-sm font-medium">{{ node.browse_name }}</h3>
      <p class="m-0 mt-1 font-mono text-2xs text-text-disabled">
        {{ node.node_id }}
      </p>
    </div>

    <dl class="m-0 grid grid-cols-2 gap-2 text-xs">
      <div>
        <dt class="text-text-disabled">数据类型</dt>
        <dd class="m-0 font-mono">{{ node.data_type ?? '—' }}</dd>
      </div>
      <div>
        <dt class="text-text-disabled">节点类别</dt>
        <dd class="m-0 font-mono">{{ node.node_class }}</dd>
      </div>
    </dl>

    <DtNotice
      v-if="live.value.value && !live.value.value.is_live"
      intent="info"
      icon="alert-circle"
    >
      实例未运行，这里显示的是库里的初值。实例的节点值不落库，重启后回到初值。
    </DtNotice>

    <div>
      <span class="text-xs text-text-disabled">当前值</span>
      <p class="m-0 font-mono text-lg">
        <span v-if="live.error.value" class="text-sm text-state-danger">
          {{ live.error.value }}
        </span>
        <span v-else>{{ displayValue(live.value.value?.value) }}</span>
      </p>
    </div>

    <PermGuard :codes="[PERMISSION_CODES.opcuaOperate]">
      <div class="flex flex-col gap-2">
        <DtNotice intent="warning" icon="alert-triangle">
          写值会立刻改变上位系统读到的现场数据。
        </DtNotice>
        <div class="flex items-center gap-2">
          <DtInput
            v-model="draft"
            class="flex-1"
            size="sm"
            placeholder="要写入的值"
          />
          <DtButton size="sm" @click="write">写入</DtButton>
        </div>
      </div>
    </PermGuard>

    <PermGuard :codes="[PERMISSION_CODES.opcuaManage]">
      <div>
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
