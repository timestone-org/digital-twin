<script setup lang="ts">
/** @fileoverview 紧凑点位卡：名称、实时读数与采样时间优先，配置操作集中在底部。 */
import { computed } from 'vue'
import type { CollectPoint, PointSample } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtCheckbox, DtSwitch } from '@dt/ui'
import PermGuard from '@/components/PermGuard.vue'
import { useAuthStore } from '@/stores/auth'
import { formatTimestampMs } from '@/utils/datetime'
import { formatSample } from '../scripts/liveFormat'

const props = defineProps<{
  point: CollectPoint
  sample: PointSample | undefined
  stale: boolean
  selected: boolean
  archiveBusy: boolean
  error?: string | undefined
}>()
const emit = defineEmits<{
  detail: []
  select: [selected: boolean]
  archive: [enabled: boolean]
  write: []
  edit: []
  remove: []
}>()
const auth = useAuthStore()
const canManage = computed(() =>
  auth.can([PERMISSION_CODES.collectManage], 'all'),
)
const look = computed(() => formatSample(props.sample, null))
const status = computed(() =>
  props.stale && props.sample ? '陈旧' : (look.value.badge ?? '正常'),
)
const tone = computed(() =>
  props.stale && props.sample ? 'warning' : look.value.intent,
)
const unit = computed(() =>
  props.sample?.state === 'ok' && typeof props.sample.value === 'number'
    ? props.point.unit
    : null,
)
const fullTime = computed(() =>
  props.sample?.state === 'ok'
    ? formatTimestampMs(props.sample.timestampMs)
    : '',
)
</script>

<template>
  <DtCard
    padding="sm"
    class="point-card"
    :class="{ 'is-selected': selected }"
    :aria-label="point.name"
  >
    <div class="point-card__head">
      <DtButton
        variant="ghost"
        intent="neutral"
        size="sm"
        class="point-card__name"
        :title="point.name"
        @click="emit('detail')"
      >
        <span class="point-card__name-text">{{ point.name }}</span>
      </DtButton>
      <DtCheckbox
        v-if="canManage"
        :model-value="selected"
        :aria-label="`选择 ${point.name}`"
        @update:model-value="emit('select', $event)"
      />
    </div>
    <div class="point-card__identity">
      <span class="point-card__code" :title="point.code">{{ point.code }}</span>
      <span class="point-card__type">{{ point.data_type }}</span>
    </div>
    <div class="point-card__reading">
      <div class="point-card__value" :title="look.text">
        <span class="point-card__number">{{ look.text }}</span>
        <span v-if="unit" class="point-card__unit">{{ unit }}</span>
      </div>
      <div class="point-card__sample">
        <span class="point-card__status" :data-tone="tone">{{ status }}</span>
        <span
          v-if="look.at"
          class="point-card__time"
          :title="`采样时间：${fullTime}`"
          >{{ look.at }}</span
        >
      </div>
    </div>
    <p v-if="look.reason || error" class="point-card__error">
      {{ error || look.reason }}
    </p>
    <div class="point-card__footer">
      <div class="point-card__archive">
        <DtSwitch
          size="sm"
          :model-value="point.archive_enabled"
          :disabled="archiveBusy || !canManage"
          :aria-label="`记录历史：${point.name}`"
          @update:model-value="emit('archive', $event)"
        />
        <span>历史</span>
      </div>
      <div class="point-card__actions">
        <PermGuard :codes="[PERMISSION_CODES.collectOperate]">
          <DtButton variant="ghost" size="xs" @click="emit('write')"
            >写值</DtButton
          >
        </PermGuard>
        <PermGuard :codes="[PERMISSION_CODES.collectManage]">
          <DtButton
            variant="ghost"
            intent="neutral"
            size="xs"
            icon="settings-2"
            aria-label="点位设置"
            title="点位设置"
            @click="emit('edit')"
          />
          <DtButton
            variant="ghost"
            intent="danger"
            size="xs"
            icon="trash"
            aria-label="删除点位"
            title="删除点位"
            @click="emit('remove')"
          />
        </PermGuard>
      </div>
    </div>
  </DtCard>
</template>

<style scoped lang="scss">
.point-card {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &.is-selected {
    border-color: var(--accent-primary);
  }

  &__head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  &__name {
    flex: 1;
    min-width: 0;
    height: auto;
    min-height: 2.7em;
    justify-content: flex-start;
    padding: 0;
    white-space: normal;
    text-align: left;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--text-primary);
  }

  &__name-text {
    display: -webkit-box;
    overflow: hidden;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  &__identity {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 11px;
    color: var(--text-secondary);
  }

  &__code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
  }

  &__type {
    flex-shrink: 0;
    font-size: 10px;
    opacity: 0.75;
  }

  &__reading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 36px;
  }

  &__value {
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
    color: var(--text-primary);
  }

  &__number {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 24px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }

  &__unit {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }

  &__sample {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    flex-shrink: 0;
    font-size: 11px;
  }

  &__status {
    color: var(--text-secondary);

    &[data-tone='success'] {
      color: var(--state-success);
    }
    &[data-tone='warning'] {
      color: var(--state-warning);
    }
    &[data-tone='danger'] {
      color: var(--state-danger);
    }
  }

  &__time {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: auto;
    border-top: 1px solid var(--border-subtle);
    padding-top: 7px;
  }

  &__archive,
  &__actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__archive {
    font-size: 11px;
    color: var(--text-secondary);
  }

  &__error {
    margin: 0;
    overflow-wrap: anywhere;
    font-size: 11px;
    line-height: 1.4;
    color: var(--state-danger);
  }
}
</style>
