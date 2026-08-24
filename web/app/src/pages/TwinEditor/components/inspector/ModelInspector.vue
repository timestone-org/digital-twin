<script setup lang="ts">
/**
 * @fileoverview 模型检查器：模型素材、摆放、外观、内置动画与场景特效。
 *
 * ⚠ 落库的是素材引用 `asset:<uuid>` 不是 URL：URL 换一次部署就 404，而配置里
 * 存的那一份没有任何一处会报错，表现只是这张屏上的模型不见了。
 * ⚠ 收整份 `TwinModelRef`、回整份：就地改 props 的那次界面照常刷新，
 * 但上层按引用比对时会当成「没变」，撤销栈里前后两帧指向同一个对象。
 * ⚠ 不给配「保留原始材质」：本项目从不做统一提亮，一律用 GLB 自带的 PBR，
 * 那个开关关掉也没有另一档行为。字段本身留着，存量数据照常读得出来。
 */
import type { TwinModelRef, Vec3 } from '@dt/twin-config'
import { TWIN_COORD_FRAMES } from '@dt/twin-config'
import {
  DtButton,
  DtColorInput,
  DtField,
  DtIcon,
  DtNumberInput,
  DtSegmented,
  DtSwitch,
} from '@dt/ui'
import { computed, ref } from 'vue'

import AssetPickerDialog from '@/components/assets/AssetPickerDialog.vue'

import ModelVariantPicker from './ModelVariantPicker.vue'

import { COORD_FRAME_OPTIONS, coordText } from '../../scripts/coordFrame'

import InspectorSection from '../fields/InspectorSection.vue'
import NodePicker from '../fields/NodePicker.vue'
import SceneEffectsFields from '../fields/SceneEffectsFields.vue'
import Vec3Field from '../fields/Vec3Field.vue'

const props = defineProps<{
  modelValue: TwinModelRef
  /**
   * 当前基准的原点（世界坐标），视口算出来的。
   * ⚠ 不在这里自己算：`center` 那一档要模型的世界包围盒，只有视口手上有。
   */
  frameOrigin: Vec3
}>()

const emit = defineEmits<{ 'update:modelValue': [TwinModelRef] }>()

/** 与归一化的钳制一致；越界值会被存回时静默改写，界面上先拦住。 */
const SCALE_RANGE = { min: 0.001, max: 1000, step: 0.1 } as const
const ROTATION_STEP = 5
/** 动画速度：0 = 定格，负数倒放。 */
const SPEED_RANGE = { min: -4, max: 4, step: 0.05 } as const

const pickerOpen = ref(false)
/** 刚挑过的素材名，纯显示用；只有引用能落库。 */
const pickedName = ref('')

const assetLabel = computed(() => {
  if (props.modelValue.asset === '') return '未选择模型'
  return pickedName.value === '' ? props.modelValue.asset : pickedName.value
})

function write(patch: Partial<TwinModelRef>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function onPick(assetRef: string, asset: { name: string }): void {
  pickedName.value = asset.name
  write({ asset: assetRef })
}

function clearAsset(): void {
  pickedName.value = ''
  write({ asset: '' })
}

/** 缩放没有「空」这一档：清空输入框时回到 1。 */
function writeScale(next: number | undefined): void {
  write({ scale: next ?? 1 })
}

function writeSpeed(next: number | undefined): void {
  write({ animations: { ...props.modelValue.animations, speed: next ?? 1 } })
}

function writeClips(clips: string[]): void {
  write({ animations: { ...props.modelValue.animations, clips } })
}

function writeAnimationsEnabled(enabled: boolean): void {
  write({ animations: { ...props.modelValue.animations, enabled } })
}

function writeRotation(rotation: Vec3): void {
  write({ rotation })
}

/** 分段控件给回来的是裸字符串；对不上闭合联合就当没切。 */
function writeCoordFrame(value: string): void {
  const found = TWIN_COORD_FRAMES.find((item) => item === value)
  if (found !== undefined) write({ coordFrame: found })
}

const originText = computed(() => coordText(props.frameOrigin))

/** 背景空串 = 透明；关掉开关就是把它清成空串，不是配一个黑。 */
function toggleBackground(opaque: boolean): void {
  write({ background: opaque ? '#05080f' : '' })
}
</script>

<template>
  <div class="flex flex-col">
    <InspectorSection title="模型素材">
      <div
        class="flex min-w-0 items-center gap-2 rounded-sm border border-border-subtle px-2 py-1.5"
      >
        <DtIcon name="layers" :size="14" class="shrink-0 text-text-secondary" />
        <span
          class="min-w-0 flex-1 truncate text-xs text-text-primary"
          :title="assetLabel"
        >
          {{ assetLabel }}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-1.5">
        <DtButton
          variant="soft"
          size="sm"
          icon="folder-open"
          @click="pickerOpen = true"
        >
          选择模型
        </DtButton>
        <DtButton
          variant="ghost"
          size="sm"
          icon="close"
          :disabled="modelValue.asset === ''"
          @click="clearAsset"
        >
          清除
        </DtButton>
      </div>
      <ModelVariantPicker
        :asset-ref="modelValue.asset"
        :model-value="modelValue.variant"
        @update:model-value="write({ variant: $event })"
      />
      <p class="text-xs text-text-disabled">
        存的是素材引用而不是下载地址；换一次部署地址也不会失效。
      </p>
    </InspectorSection>

    <InspectorSection title="摆放">
      <DtNumberInput
        :model-value="modelValue.scale"
        :range="SCALE_RANGE"
        label="缩放"
        size="sm"
        @update:model-value="writeScale"
      />
      <div class="flex flex-col gap-1.5">
        <!-- 模型自己的位置恒是世界坐标：基准是由它定出来的，跟着基准换算会绕回自身 -->
        <span class="text-xs text-text-secondary">位置（世界坐标）</span>
        <Vec3Field
          :model-value="modelValue.position"
          @update:model-value="write({ position: $event })"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-text-secondary">旋转（度）</span>
        <Vec3Field
          :model-value="modelValue.rotation"
          :step="ROTATION_STEP"
          @update:model-value="writeRotation"
        />
      </div>
      <DtSwitch
        :model-value="modelValue.autoRotate"
        label="自动旋转"
        size="sm"
        @update:model-value="write({ autoRotate: $event })"
      />
    </InspectorSection>

    <InspectorSection title="坐标基准">
      <DtField
        label="摆放坐标以谁为 0"
        hint="只换读数，不挪动任何已摆好的东西"
        size="sm"
      >
        <DtSegmented
          :model-value="modelValue.coordFrame"
          :options="COORD_FRAME_OPTIONS"
          size="sm"
          block
          aria-label="坐标基准"
          @update:model-value="writeCoordFrame"
        />
      </DtField>
      <p class="text-xs text-text-disabled">
        锚点 / 信息牌 / 箭头 /
        视点填的坐标都按它显示；视口里的网格与坐标轴、场景特效的底座与光柱也都以
        这个原点为中心。「模型中心」只把前后左右挪到全部模块的正中心，高度轴仍与
        模型坐标系一致。
      </p>
      <p class="text-xs text-text-disabled">
        当前原点（世界坐标）：{{ originText }}
      </p>
    </InspectorSection>

    <InspectorSection title="外观">
      <DtSwitch
        :model-value="modelValue.background !== ''"
        label="不透明背景"
        size="sm"
        @update:model-value="toggleBackground"
      />
      <DtColorInput
        v-if="modelValue.background !== ''"
        :model-value="modelValue.background"
        label="背景色"
        size="sm"
        @update:model-value="write({ background: $event })"
      />
      <p v-else class="text-xs text-text-disabled">
        背景透明，露出它下面那一层大屏。
      </p>
      <DtSwitch
        :model-value="modelValue.showGroundGrid"
        label="地面网格"
        size="sm"
        @update:model-value="write({ showGroundGrid: $event })"
      />
      <p class="text-xs text-text-disabled">
        大屏与编辑视口共用这一个开关；关掉之后编辑时也没有网格与坐标轴可参照。
      </p>
    </InspectorSection>

    <InspectorSection title="内置动画">
      <DtSwitch
        :model-value="modelValue.animations.enabled"
        label="播放模型动画"
        size="sm"
        @update:model-value="writeAnimationsEnabled"
      />
      <template v-if="modelValue.animations.enabled">
        <span class="text-xs text-text-secondary">要播的 clip</span>
        <NodePicker
          :model-value="modelValue.animations.clips"
          :candidates="[]"
          placeholder="clip 名"
          empty-hint="clip 名来自模型文件，按 GLB 里的名字手填。"
          @update:model-value="writeClips"
        />
        <p class="text-xs text-text-disabled">
          一条都不填 = 全播；填了就只播列出的这几条。
        </p>
        <DtNumberInput
          :model-value="modelValue.animations.speed"
          :range="SPEED_RANGE"
          label="速度倍率"
          hint="0 = 定格，负数倒放"
          size="sm"
          @update:model-value="writeSpeed"
        />
      </template>
    </InspectorSection>

    <SceneEffectsFields
      :model-value="modelValue.sceneEffects"
      @update:model-value="write({ sceneEffects: $event })"
    />

    <AssetPickerDialog
      v-model="pickerOpen"
      kind="model"
      title="选择三维模型"
      @pick="onPick"
    />
  </div>
</template>
