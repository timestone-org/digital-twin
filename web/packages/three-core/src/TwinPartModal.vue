<script setup lang="ts">
/**
 * @fileoverview 部件详情弹窗：近距点击某个部件时弹出来的那一个，里面只有这一个
 * 部件的模型与它自己的读数。
 *
 * ⚠ 弹窗里那块 3D 是**另一套场景**，不是把主画布挪过来：它自己起渲染器、把部件
 * 克隆一份摆在原点。所以「只看这一个」不需要去动主场景的显隐与材质，关掉弹窗
 * 也就没有任何要还原的东西。
 * ⚠ 数据卡片由 `panelCard` 命令式建 DOM 而不是在模板里重画一遍：八种字段画法、
 * 阈值档与迷你图都长在那边，照着抄第二遍必然漂，而漂了以后两边都不报错。
 */
import type { TwinPart, TwinPartFieldValues } from '@dt/twin-config'
import { detailPanelOf } from '@dt/twin-config'
import { DtModal } from '@dt/ui'
import type * as THREE from 'three'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type CSSProperties,
} from 'vue'

import { createFrameClock } from './frameClock'
import {
  buildPanelCard,
  paintPanelField,
  type PanelFieldView,
} from './panelCard'
import { createPartPreview, type PartPreview } from './partPreview'
import type { SceneRendererFactory } from './sceneCore'

const props = defineProps<{
  /** 当前弹出的部件；null = 弹窗关着。 */
  part: TwinPart | null
  /** 详情字段实时值，键是 `<部件 id>::<字段 key>`。 */
  values: TwinPartFieldValues
  /** 取这个部件在模型里的对象；模型没加载时给空数组。 */
  objectsOf: (partId: string) => readonly THREE.Object3D[]
  /** 渲染器工厂；测试里换成 headless 替身。 */
  rendererFactory?: SceneRendererFactory
}>()

const emit = defineEmits<{ close: [] }>()

const stageRef = ref<HTMLDivElement | null>(null)
const cardRef = ref<HTMLDivElement | null>(null)
/** 当前这张卡片的字段落点；换部件时整批换掉。 */
let views: PanelFieldView[] = []
let preview: PartPreview | null = null
let observer: ResizeObserver | null = null
let frameHandle = 0
const clock = createFrameClock()

const isOpen = computed(() => props.part !== null)
const title = computed(() => {
  const part = props.part
  if (part === null) return ''
  return part.detail.title === '' ? part.name : part.detail.title
})

/** 主题色空着就跟随大屏，不在这里塞一个默认色。 */
const bodyStyle = computed<CSSProperties>(() => {
  const detail = props.part?.detail
  if (detail === undefined) return {}
  const accent = detail.accent
  return {
    '--tp-stage-height': `${detail.modelHeight}px`,
    ...(accent === ''
      ? {}
      : {
          '--tp-accent': accent.startsWith('--') ? `var(${accent})` : accent,
        }),
  }
})

const width = computed(() => `${props.part?.detail.width ?? 0}px`)
const showModel = computed(() => props.part?.detail.showModel === true)

function paint(): void {
  for (const view of views) paintPanelField(view, props.values)
}

function clearCard(): void {
  cardRef.value?.replaceChildren()
  views = []
}

function buildCard(): void {
  const host = cardRef.value
  clearCard()
  if (host === null || props.part === null) return
  const card = buildPanelCard(detailPanelOf(props.part))
  views = card.fields
  host.append(card.card)
  paint()
}

function measure(): void {
  const stage = stageRef.value
  if (stage === null) return
  preview?.measure(stage.clientWidth, stage.clientHeight)
}

function tick(now: number): void {
  preview?.frame(clock.tick(now))
  frameHandle = requestAnimationFrame(tick)
}

function stopPreview(): void {
  // ⚠ 没在跑就别叫：`cancelAnimationFrame(0)` 虽然无害，但会让「卸载时到底停了
  //   几个循环」这类断言数不清是谁停的
  if (frameHandle !== 0) cancelAnimationFrame(frameHandle)
  frameHandle = 0
  observer?.disconnect()
  observer = null
  preview?.dispose()
  preview = null
}

function startPreview(): void {
  const stage = stageRef.value
  const part = props.part
  if (stage === null || part === null || !part.detail.showModel) return
  preview = createPartPreview({
    container: stage,
    objects: props.objectsOf(part.id),
    autoRotate: part.detail.autoRotate,
    ...(props.rendererFactory === undefined
      ? {}
      : { renderer: props.rendererFactory }),
  })
  if (preview === null) return
  observer = new ResizeObserver(measure)
  observer.observe(stage)
  measure()
  clock.reset()
  frameHandle = requestAnimationFrame(tick)
}

/**
 * 换部件（或开关弹窗）时整份重来。
 * ⚠ 必须 `flush: 'post'`：弹窗的 DOM 由 `v-if` 建出来，默认时机跑的话两个 ref
 * 都还是 null，卡片与画布整份不建——而它不报任何错。
 * ⚠ 换配置时主场景会重建部件材质，预览里克隆的那份材质随之作废，所以这里按
 * **部件引用**重来而不是只在开关时重来。
 */
function rebuild(): void {
  stopPreview()
  buildCard()
  startPreview()
}

watch(() => props.part, rebuild, { flush: 'post' })
watch(() => props.values, paint)

// ⚠ 不用 `immediate: true` 代替这一句：那一档是在 setup 里同步跑的，那时弹窗的
// DOM 还没建出来，两个 ref 都是 null，卡片与画布整份不建——而它不报任何错
onMounted(rebuild)

onBeforeUnmount(() => {
  stopPreview()
  clearCard()
})
</script>

<template>
  <DtModal
    :model-value="isOpen"
    :title="title"
    :description="part?.detail.subtitle ?? ''"
    :width="width"
    @update:model-value="emit('close')"
  >
    <div class="twin-part-modal" :style="bodyStyle">
      <div
        v-show="showModel"
        ref="stageRef"
        class="twin-part-modal__stage"
        data-test="part-modal-stage"
      />
      <div
        ref="cardRef"
        class="twin-part-modal__data"
        data-test="part-modal-data"
      />
    </div>
  </DtModal>
</template>

<style scoped lang="scss">
// ⚠ 数据卡片的观感全在全局的 `styles/panel.scss` 里：它是命令式建出来的 DOM，
// 不在本组件的 scoped 作用域内，写在这里一条都不生效。
.twin-part-modal {
  --tp-accent: var(--accent-primary);
  --tp-bg: var(--surface-overlay);
  --tp-font-size: 12px;

  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
  color: var(--text-primary);
  font-size: var(--tp-font-size);
  line-height: 1.5;

  &__stage {
    position: relative;
    flex: 2 1 300px;
    height: var(--tp-stage-height, 260px);
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
  }

  &__data {
    flex: 1 1 220px;
    min-width: 0;
  }
}
</style>
