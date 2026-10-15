<script setup lang="ts">
/**
 * @fileoverview 自动漫游检查器：开关、轨迹站点、时长、逐段覆盖，外加一个当场
 * 试看的预览。
 *
 * ⚠ 面板上的时长一律是**秒**，落库仍是毫秒——换算在这里做。
 * ⚠ 编辑视口不会自己开播漫游：只有点了「预览」才飞，飞的时候一碰镜头就停。
 * 配置的时候镜头一直在飘，锚点根本摆不准。
 */
import {
  DEFAULT_ROAM_TOUR_IDLE_DELAY_MS,
  DEFAULT_ROAM_TOUR_PAUSE_MS,
  DEFAULT_ROAM_TOUR_SEGMENT_MS,
  MAX_ROAM_TOUR_IDLE_DELAY_MS,
  MAX_ROAM_TOUR_PAUSE_MS,
  MAX_ROAM_TOUR_SEGMENT_MS,
  MIN_ROAM_TOUR_STOPS,
  roamTourStops,
  type TwinCamera,
  type TwinRoamTour,
} from '@dt/twin-config'
import { DtButton, DtNotice, DtNumberInput, DtSwitch } from '@dt/ui'
import { computed } from 'vue'

import {
  ROAM_SECONDS_STEP,
  roamMs,
  roamSeconds,
} from '../../scripts/roamTiming'
import InspectorSection from '../fields/InspectorSection.vue'
import RoamSegmentFields from '../fields/RoamSegmentFields.vue'
import RoamStopList from '../fields/RoamStopList.vue'

const props = defineProps<{
  modelValue: TwinRoamTour
  cameras: readonly TwinCamera[]
  /** 视口里正在飞预览；按钮据此在「预览」与「停止」之间换。 */
  previewing: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [TwinRoamTour]
  preview: []
  stopPreview: []
}>()

const MS_PER_S = 1000
const flySecondsMax = MAX_ROAM_TOUR_SEGMENT_MS / MS_PER_S
const holdSecondsMax = MAX_ROAM_TOUR_PAUSE_MS / MS_PER_S
const idleSecondsMax = MAX_ROAM_TOUR_IDLE_DELAY_MS / MS_PER_S

const FLY_RANGE = { min: 0, max: flySecondsMax, step: ROAM_SECONDS_STEP }
const HOLD_RANGE = { min: 0, max: holdSecondsMax, step: ROAM_SECONDS_STEP }
const IDLE_RANGE = { min: 1, max: idleSecondsMax, step: 1 }

/** 轨迹上真正飞得到的站点数；悬空 id 不算。 */
const stopCount = computed(
  () => roamTourStops(props.cameras, props.modelValue).length,
)
const canFly = computed(() => stopCount.value >= MIN_ROAM_TOUR_STOPS)

const flySeconds = computed(() => roamSeconds(props.modelValue.segmentMs))
const holdSeconds = computed(() => roamSeconds(props.modelValue.pauseMs))
const idleSeconds = computed(() =>
  roamSeconds(props.modelValue.idleAutoplayDelayMs),
)

const previewLabel = computed(() =>
  props.previewing ? '停止预览' : '预览漫游',
)

function write(patch: Partial<TwinRoamTour>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

// ⚠ 清空输入退回缺省而不是 0：0 秒飞行是「瞬移」、0 秒闲置是「一撒手就抢镜头」，
// 两者都不像用户清空一个框时想要的东西
function writeFly(seconds: number | undefined): void {
  write({ segmentMs: roamMs(seconds, DEFAULT_ROAM_TOUR_SEGMENT_MS) })
}

function writeHold(seconds: number | undefined): void {
  write({ pauseMs: roamMs(seconds, DEFAULT_ROAM_TOUR_PAUSE_MS) })
}

function writeIdle(seconds: number | undefined): void {
  write({
    idleAutoplayDelayMs: roamMs(seconds, DEFAULT_ROAM_TOUR_IDLE_DELAY_MS),
  })
}

function togglePreview(): void {
  if (props.previewing) emit('stopPreview')
  else emit('preview')
}
</script>

<template>
  <div class="flex flex-col">
    <InspectorSection title="自动漫游">
      <DtSwitch
        :model-value="modelValue.enabled"
        label="启用自动漫游"
        size="sm"
        @update:model-value="write({ enabled: $event })"
      />
      <template v-if="modelValue.enabled">
        <DtSwitch
          :model-value="modelValue.autoplay"
          label="加载后自动播放"
          size="sm"
          @update:model-value="write({ autoplay: $event })"
        />
        <DtSwitch
          :model-value="modelValue.loop"
          label="循环播放"
          size="sm"
          @update:model-value="write({ loop: $event })"
        />
        <DtSwitch
          :model-value="modelValue.showControls"
          label="大屏上显示播放控件"
          size="sm"
          @update:model-value="write({ showControls: $event })"
        />
        <DtSwitch
          :model-value="modelValue.idleAutoplay"
          label="空闲时自动播放"
          size="sm"
          @update:model-value="write({ idleAutoplay: $event })"
        />
        <DtNumberInput
          v-if="modelValue.idleAutoplay"
          :model-value="idleSeconds"
          :range="IDLE_RANGE"
          label="空闲等待时间（秒）"
          hint="手动操作相机后暂停漫游，并重新计算空闲时间"
          size="sm"
          @update:model-value="writeIdle"
        />
      </template>
    </InspectorSection>

    <InspectorSection title="轨迹">
      <DtNotice v-if="cameras.length === 0" intent="info">
        尚未配置视点。请在左侧新增至少两个视点，调整相机后点击「取当前机位」，再配置漫游轨迹。
      </DtNotice>
      <DtNotice v-else-if="cameras.length < MIN_ROAM_TOUR_STOPS" intent="info">
        当前仅有 1 个视点，漫游至少需要 {{ MIN_ROAM_TOUR_STOPS }} 个视点。
      </DtNotice>

      <RoamStopList
        v-if="cameras.length > 0"
        :tour="modelValue"
        :cameras="cameras"
        @update:tour="emit('update:modelValue', $event)"
      />

      <DtButton
        variant="soft"
        size="sm"
        icon="play"
        block
        :disabled="!canFly"
        @click="togglePreview"
      >
        {{ previewLabel }}
      </DtButton>
      <p class="text-xs text-text-secondary">
        可在预览窗口中选择完整轨迹或单个区段，预览不改变中央编辑视口。
      </p>
      <p class="text-xs text-text-disabled">
        <template v-if="canFly">
          预览直接使用当前配置，无需先保存场景；手动操作预览相机后暂停漫游。
        </template>
        <template v-else>
          轨迹中的有效站点少于 {{ MIN_ROAM_TOUR_STOPS }} 个，暂时无法预览。
        </template>
      </p>
    </InspectorSection>

    <InspectorSection title="时长">
      <DtNumberInput
        :model-value="flySeconds"
        :range="FLY_RANGE"
        label="每段飞行（秒）"
        hint="相邻站点之间的视角过渡时长"
        size="sm"
        @update:model-value="writeFly"
      />
      <DtNumberInput
        :model-value="holdSeconds"
        :range="HOLD_RANGE"
        label="每站停留（秒）"
        hint="到达站点后继续下一段漫游前的停留时长"
        size="sm"
        @update:model-value="writeHold"
      />
    </InspectorSection>

    <InspectorSection title="逐段覆盖（高级）" collapsed>
      <RoamSegmentFields
        :tour="modelValue"
        :cameras="cameras"
        :max-fly-seconds="flySecondsMax"
        :max-hold-seconds="holdSecondsMax"
        @update:tour="emit('update:modelValue', $event)"
      />
    </InspectorSection>
  </div>
</template>
