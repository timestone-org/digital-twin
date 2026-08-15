<script setup lang="ts">
/**
 * @fileoverview 点位绑定页签：选实例 → 绑区域点位 → 逐个组合绑时间点位。
 *
 * ⚠ **「没绑齐就不发布」必须在这里说出来**：后端确实会跳过，但页面上开关是
 * 开的、点位是空的，没有任何地方讲过它其实没在发。
 * ⚠ 节点选择器只列类型对得上、且可写的那些：让用户点了保存才被拒，等于让他
 * 猜哪个点位能用。
 */
import { computed } from 'vue'
import type { DtSelectOption } from '@dt/contracts'
import { MODEL_NO_PREDICTION } from '@dt/contracts'
import {
  DtButton,
  DtCard,
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
import type { PublicationController } from '../usePublication'

const props = defineProps<{ publication: PublicationController }>()
const emit = defineEmits<{ saved: []; unbound: []; published: [] }>()

const state = computed(() => props.publication)

const instanceOptions = computed<DtSelectOption[]>(() =>
  state.value.instances.value.map((instance) => ({
    value: instance.id,
    label: `${instance.name}${instance.is_running ? '' : '（未运行）'}`,
  })),
)
const regionOptions = computed(() =>
  recommendationOptions(state.value.nodes.value),
)
const durationChoices = computed(() => durationOptions(state.value.nodes.value))
const orphans = computed(() => orphanedBindings(state.value.saved.value))
const bound = computed(() =>
  boundCount(state.value.draft.value, state.value.servingKeys.value),
)
const total = computed(() => state.value.servingKeys.value.length)
const lastStatus = computed(() => {
  const status = state.value.saved.value?.last_status
  return status ? PUBLISH_STATUS_VIEW[status] : null
})
/** 选中实例此刻在不在跑——不在跑时写值会整条失败。 */
const isInstanceStopped = computed(() => {
  const chosen = state.value.instances.value.find(
    (instance) => instance.id === state.value.draft.value.instanceId,
  )
  return chosen !== undefined && !chosen.is_running
})

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

    <DtCard class="min-w-0">
      <div class="flex flex-wrap items-center gap-3">
        <DtSelect
          class="min-w-64"
          label="OPC UA 实例"
          :model-value="state.draft.value.instanceId"
          :options="instanceOptions"
          :display="{ placeholder: '选择一台服务器' }"
          @update:model-value="state.selectInstance($event)"
        />
        <label class="flex items-center gap-2 text-sm text-text-primary">
          <DtSwitch
            :model-value="state.draft.value.isEnabled"
            @update:model-value="state.setEnabled($event)"
          />
          自动下发（每 60 秒一拍）
        </label>
        <div class="ml-auto flex items-center gap-2 text-xs">
          <DtTag v-if="lastStatus" size="sm" :intent="lastStatus.intent">
            {{ lastStatus.label }}
          </DtTag>
          <span class="text-text-secondary">
            {{
              state.saved.value?.last_published_at
                ? `上次下发 ${state.saved.value.last_published_at}`
                : '还没有下发过'
            }}
          </span>
        </div>
      </div>

      <DtNotice
        v-if="state.saved.value?.last_error"
        class="mt-2"
        intent="danger"
      >
        {{ state.saved.value.last_error }}
      </DtNotice>
      <DtNotice v-if="isInstanceStopped" class="mt-2" intent="warning">
        这台实例没在运行，下发会整条失败——先在「OPC UA 服务端」把它起起来。
      </DtNotice>
      <DtNotice
        v-if="state.isNodeListTruncated.value"
        class="mt-2"
        intent="info"
      >
        这台实例的节点太多，下面只列出了前 200 个。
      </DtNotice>
    </DtCard>

    <DtCard v-if="state.draft.value.instanceId" class="min-w-0">
      <h2 class="mb-2 text-sm font-semibold text-text-primary">
        区域推荐点位
        <span class="ml-1 text-xs font-normal text-text-secondary">
          字符串型；每一拍写进第一名那个组合的名字，如「K11+K12+K14」
        </span>
      </h2>
      <DtSelect
        class="max-w-xl"
        :model-value="state.draft.value.recommendationNodeId"
        :options="regionOptions"
        aria-label="区域推荐点位"
        :display="{
          placeholder: '选择一个字符串点位',
          emptyText: '这台实例上没有可写的字符串点位',
        }"
        @update:model-value="state.selectRecommendationNode($event)"
      />
    </DtCard>

    <DtCard v-if="state.draft.value.instanceId" class="min-w-0">
      <h2 class="mb-2 text-sm font-semibold text-text-primary">
        服务组合 → 预测时间点位
        <span class="ml-1 text-xs font-normal text-text-secondary">
          浮点型；每一拍写进这个组合的 p50 达标分钟数
        </span>
      </h2>

      <DtNotice v-if="total === 0" intent="warning">
        这个模型没有服务组合，没有可下发的数。
      </DtNotice>

      <ul v-else class="flex flex-col gap-2">
        <li
          v-for="key in state.servingKeys.value"
          :key="key"
          class="flex flex-wrap items-center gap-2"
        >
          <span class="w-48 shrink-0 font-mono text-xs text-text-primary">
            {{ key }}
          </span>
          <DtSelect
            class="min-w-80 flex-1"
            :model-value="state.draft.value.setNodes[key] ?? ''"
            :options="durationChoices"
            :aria-label="`组合 ${key} 的预测时间点位`"
            :display="{
              placeholder: '未绑定',
              emptyText: '这台实例上没有可写的浮点点位',
            }"
            @update:model-value="state.selectSetNode(key, $event)"
          />
        </li>
      </ul>

      <p
        class="mt-3 text-xs"
        :class="
          state.isFullyBound.value
            ? 'text-text-secondary'
            : 'text-state-warning'
        "
      >
        {{ total }} 个组合已绑 {{ bound }} 个{{
          state.isFullyBound.value ? '' : ' → 绑齐之前不会自动下发'
        }}
      </p>
    </DtCard>

    <DtCard v-if="orphans.length > 0" class="min-w-0">
      <h2 class="mb-2 text-sm font-semibold text-state-warning">
        已落空的绑定
        <span class="ml-1 text-xs font-normal text-text-secondary">
          模型改过服务组合，这些键已经不在其中；保存一次即可清掉它们
        </span>
      </h2>
      <ul class="flex flex-col gap-1 text-xs text-text-secondary">
        <li v-for="item in orphans" :key="item.set_key" class="font-mono">
          {{ item.set_key }} → {{ item.identifier }}
        </li>
      </ul>
    </DtCard>

    <div class="flex flex-wrap items-center gap-2">
      <DtButton
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
        variant="ghost"
        :disabled="
          state.saved.value === null ||
          !state.saved.value.is_fully_bound ||
          state.isPublishing.value
        "
        @click="publishNow"
      >
        立刻下发一次
      </DtButton>
      <DtButton
        variant="ghost"
        danger
        :disabled="state.saved.value === null || state.isSaving.value"
        @click="unbind"
      >
        解绑
      </DtButton>
      <DtSpinner v-if="state.isLoading.value" :size="14" />
    </div>

    <DtCard v-if="state.publishResult.value" class="min-w-0">
      <h2 class="mb-2 text-sm font-semibold text-text-primary">
        这一次下发
        <span class="ml-1 text-xs font-normal text-text-secondary">
          {{ MODEL_NO_PREDICTION }} 表示「这一拍算不出数」——它不是 0， 而 0
          是「多半一开机就达标」
        </span>
      </h2>
      <ul class="flex flex-col gap-1 text-xs">
        <li
          v-for="(item, at) in state.publishResult.value.items"
          :key="`${item.set_key ?? 'region'}-${at}`"
          class="flex flex-wrap items-center gap-2"
        >
          <span class="w-48 shrink-0 font-mono text-text-secondary">
            {{ item.set_key ?? '区域推荐' }}
          </span>
          <span class="font-mono text-text-primary">{{ item.value }}</span>
          <span v-if="!item.is_written" class="text-state-danger">
            {{ item.error }}
          </span>
        </li>
      </ul>
    </DtCard>
  </div>
</template>
