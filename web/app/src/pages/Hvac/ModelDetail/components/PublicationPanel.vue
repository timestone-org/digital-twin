<script setup lang="ts">
/**
 * @fileoverview 点位绑定页签：往哪台实例、哪些点位下发。
 *
 * ⚠ 版面上只有**一张绑定表**：区域推荐点位与各组合的时间点位是同一件事
 * （一个目标 → 一个点位），差别只在数据类型。拆成两块的话，同一件事在页面上
 * 有两种排布，眼睛得来回换一次坐标系。
 * ⚠ **「没绑齐就不发布」必须在这里说出来**：后端确实会跳过，但页面上开关是
 * 开的、点位是空的，没有任何地方讲过它其实没在发。
 * ⚠ 节点选择器只列类型对得上、且可写的那些：让用户点了保存才被拒，等于让他
 * 猜哪个点位能用。
 */
import { computed } from 'vue'
import type { DtSelectOption } from '@dt/contracts'
import {
  DtButton,
  DtNotice,
  DtSelect,
  DtSpinner,
  DtSwitch,
  DtTag,
} from '@dt/ui'

import {
  PUBLISH_STATUS_VIEW,
  boundCount,
  durationOptions,
  orphanedBindings,
  recommendationOptions,
} from '@/features/hvac/publication'
import { formatSince } from '@/utils/datetime'
import PublishResultList from './PublishResultList.vue'
import type { PublicationController } from '../usePublication'

/** 区域推荐那一行的行键。⚠ 与任何 set_key 都不会撞：组合键里没有空格。 */
const REGION_ROW = ' region '

const props = defineProps<{ publication: PublicationController }>()
const emit = defineEmits<{ saved: []; unbound: []; published: [] }>()

const state = computed(() => props.publication)

const instanceOptions = computed<DtSelectOption[]>(() =>
  state.value.instances.value.map((instance) => ({
    value: instance.id,
    label: instance.name,
  })),
)

/** 一行绑定：绑什么、只能绑什么类型、现在绑到了哪个点位。 */
interface BindingRow {
  key: string
  target: string
  dataType: string
  options: DtSelectOption[]
  nodeId: string
}

const rows = computed<BindingRow[]>(() => {
  const region: BindingRow = {
    key: REGION_ROW,
    target: '区域推荐',
    dataType: 'string',
    options: recommendationOptions(state.value.nodes.value),
    nodeId: state.value.draft.value.recommendationNodeId,
  }
  const durations = durationOptions(state.value.nodes.value)
  return [
    region,
    ...state.value.servingKeys.value.map((key) => ({
      key,
      target: key,
      dataType: 'double',
      options: durations,
      nodeId: state.value.draft.value.setNodes[key] ?? '',
    })),
  ]
})

const orphans = computed(() => orphanedBindings(state.value.saved.value))
const bound = computed(() =>
  boundCount(state.value.draft.value, state.value.servingKeys.value),
)
const total = computed(() => state.value.servingKeys.value.length)
const lastStatus = computed(() => {
  const status = state.value.saved.value?.last_status
  return status ? PUBLISH_STATUS_VIEW[status] : null
})
const lastSince = computed(() => {
  const at = state.value.saved.value?.last_published_at
  return at ? formatSince(at) : '还没下发过'
})
/** 选中实例此刻在不在跑——不在跑时写值会整条失败。 */
const isInstanceStopped = computed(() => {
  const chosen = state.value.instances.value.find(
    (instance) => instance.id === state.value.draft.value.instanceId,
  )
  return chosen !== undefined && !chosen.is_running
})

function pick(key: string, nodeId: string): void {
  if (key === REGION_ROW) state.value.selectRecommendationNode(nodeId)
  else state.value.selectSetNode(key, nodeId)
}

async function save(): Promise<void> {
  if (await state.value.save()) emit('saved')
}

async function unbind(): Promise<void> {
  if (await state.value.unbind()) emit('unbound')
}

async function publishNow(): Promise<void> {
  if (await state.value.publishNow()) emit('published')
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <DtNotice v-if="state.error.value" intent="danger">
      {{ state.error.value }}
    </DtNotice>

    <!-- 下发目标：实例、开关与心跳收在一条里，它们回答的是同一个问题 -->
    <section
      class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border-subtle p-3"
    >
      <label class="flex items-center gap-2">
        <span class="shrink-0 text-xs text-text-disabled">实例</span>
        <DtSelect
          class="w-56"
          size="sm"
          :model-value="state.draft.value.instanceId"
          :options="instanceOptions"
          aria-label="OPC UA 实例"
          :display="{ placeholder: '选择一台服务器' }"
          @update:model-value="state.selectInstance($event)"
        />
      </label>

      <label class="flex items-center gap-2">
        <DtSwitch
          :model-value="state.draft.value.isEnabled"
          @update:model-value="state.setEnabled($event)"
        />
        <span class="text-xs text-text-secondary">自动下发 · 每 60 秒</span>
      </label>

      <div class="ml-auto flex items-center gap-2">
        <DtSpinner v-if="state.isLoading.value" :size="12" />
        <DtTag v-if="lastStatus" size="sm" :intent="lastStatus.intent">
          {{ lastStatus.label }}
        </DtTag>
        <span class="text-2xs text-text-disabled">{{ lastSince }}</span>
      </div>
    </section>

    <DtNotice v-if="isInstanceStopped" intent="warning" icon="alert-triangle">
      这台实例没在运行，下发会整条失败——先在「OPC UA 服务端」把它起起来。
    </DtNotice>
    <DtNotice v-if="state.saved.value?.last_error" intent="danger">
      {{ state.saved.value.last_error }}
    </DtNotice>

    <!-- 绑定表。⚠ 三列用 grid 而不是每行各自 flex：只有共享列宽，
         目标、类型与选择器在行与行之间才对得齐 -->
    <section
      v-if="state.draft.value.instanceId"
      class="flex flex-col gap-2 rounded-md border border-border-subtle p-3"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-text-disabled">点位绑定</span>
        <span
          class="text-2xs"
          :class="
            state.isFullyBound.value
              ? 'text-text-disabled'
              : 'text-state-warning'
          "
        >
          {{ bound }} / {{ total }} 个组合已绑
          {{ state.isFullyBound.value ? '' : '· 绑齐之前不会自动下发' }}
        </span>
      </div>

      <DtNotice v-if="total === 0" intent="warning">
        这个模型没有服务组合，没有可下发的数。
      </DtNotice>

      <div
        v-else
        class="grid items-center gap-x-3 gap-y-1.5"
        style="grid-template-columns: max-content max-content 18rem"
      >
        <template v-for="row in rows" :key="row.key">
          <span class="truncate font-mono text-xs text-text-primary">
            {{ row.target }}
          </span>
          <DtTag mono size="sm">{{ row.dataType }}</DtTag>
          <DtSelect
            size="sm"
            :model-value="row.nodeId"
            :options="row.options"
            :aria-label="`${row.target} 的点位`"
            :display="{
              placeholder: '未绑定',
              emptyText: `这台实例上没有可写的 ${row.dataType} 点位`,
            }"
            @update:model-value="pick(row.key, $event)"
          />
        </template>
      </div>

      <p
        v-if="state.isNodeListTruncated.value"
        class="m-0 text-2xs text-text-disabled"
      >
        这台实例的节点太多，上面只列出了前 200 个。
      </p>
    </section>

    <section
      v-if="orphans.length > 0"
      class="flex flex-col gap-1 rounded-md border border-border-subtle p-3"
    >
      <span class="text-xs text-state-warning">
        已落空的绑定
        <span class="ml-1 text-2xs font-normal text-text-disabled">
          模型改过服务组合，这些键已不在其中；保存一次即可清掉
        </span>
      </span>
      <span
        v-for="item in orphans"
        :key="item.set_key"
        class="font-mono text-2xs text-text-disabled"
      >
        {{ item.set_key }} → {{ item.identifier }}
      </span>
    </section>

    <div class="flex flex-wrap items-center gap-2">
      <DtButton
        size="sm"
        :disabled="
          !state.isDirty.value ||
          state.isSaving.value ||
          state.draft.value.instanceId === ''
        "
        @click="save"
      >
        保存绑定
      </DtButton>
      <DtButton
        size="sm"
        variant="outline"
        :disabled="
          state.saved.value === null ||
          !state.saved.value.is_fully_bound ||
          state.isPublishing.value
        "
        @click="publishNow"
      >
        <DtSpinner v-if="state.isPublishing.value" :size="12" />
        立刻下发一次
      </DtButton>
      <DtButton
        class="ml-auto"
        size="sm"
        variant="ghost"
        danger
        :disabled="state.saved.value === null || state.isSaving.value"
        @click="unbind"
      >
        解绑
      </DtButton>
    </div>

    <PublishResultList
      v-if="state.publishResult.value"
      :result="state.publishResult.value"
    />
  </div>
</template>
