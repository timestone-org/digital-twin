<script setup lang="ts">
/**
 * @fileoverview 部件详情弹窗：装配导航、独立模型预览与自适应读数卡片。
 * 场景生命周期与字段契约见 docs/TWIN_PART_INTERACTION_DESIGN.md。
 */
import type {
  TwinPart,
  TwinPartFieldValues,
  TwinPartValues,
} from '@dt/twin-config'
import { detailPanelOf, partAssembly } from '@dt/twin-config'
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
import TwinPartAssemblyRail from './TwinPartAssemblyRail.vue'
import TwinPartSectionHead from './TwinPartSectionHead.vue'

const props = defineProps<{
  /** 打开的那个部件，也是装配的顶；null = 弹窗关着。 */
  part: TwinPart | null
  /** 全部部件；装配清单按它建。 */
  parts: readonly TwinPart[]
  /** 装配栏里正看着谁；空串 = 看打开的那个自己。 */
  currentId: string
  /** 详情字段实时值，键是 `<部件 id>::<字段 key>`。 */
  values: TwinPartFieldValues
  /** 部件状态染色那一路，装配栏的连接轨用它上色。 */
  partValues: TwinPartValues
  /** 取这个部件在模型里的对象；模型没加载时给空数组。 */
  objectsOf: (partId: string) => readonly THREE.Object3D[]
  /** 渲染器工厂；测试里换成 headless 替身。 */
  rendererFactory?: SceneRendererFactory
}>()

const emit = defineEmits<{ close: []; select: [partId: string] }>()

const stageRef = ref<HTMLDivElement | null>(null)
const cardRef = ref<HTMLDivElement | null>(null)
/** 当前这张卡片的字段落点；换部件时整批换掉。 */
let views: PanelFieldView[] = []
let preview: PartPreview | null = null
let observer: ResizeObserver | null = null
let frameHandle = 0
const clock = createFrameClock()
/** 说要画模型，模型里却一个对应节点都找不到。 */
const stageEmpty = ref(false)

const isOpen = computed(() => props.part !== null)

/** 这个部件与它的全部后代，深度优先；只有它自己时不摆装配栏。 */
const assembly = computed(() =>
  props.part === null ? [] : partAssembly(props.parts, props.part.id),
)
const hasAssembly = computed(() => assembly.value.length > 1)

/**
 * 现在看的是哪个部件。
 * ⚠ 找不到就退回打开的那一个，绝不给 null：弹窗开着而当前件是空的话，卡片与
 * 画布整份不建，而屏幕上只是一块空白。
 */
const current = computed<TwinPart | null>(() => {
  const root = props.part
  if (root === null) return null
  const hit = assembly.value.find((node) => node.part.id === props.currentId)
  return hit?.part ?? root
})
const currentPartId = computed(() => current.value?.id ?? '')

const title = computed(() => {
  const part = current.value
  if (part === null) return ''
  return part.detail.title === '' ? part.name : part.detail.title
})

/** 主题色空着就跟随大屏，不在这里塞一个默认色。 */
const bodyStyle = computed<CSSProperties>(() => {
  const root = props.part
  const detail = current.value?.detail
  if (root === null || detail === undefined) return {}
  const accent = detail.accent
  return {
    '--tp-stage-height': `${root.detail.modelHeight}px`,
    ...(accent === ''
      ? {}
      : {
          '--tp-accent': accent.startsWith('--') ? `var(${accent})` : accent,
        }),
  }
})

const width = computed(() => `${props.part?.detail.width ?? 0}px`)
const showModel = computed(() => current.value?.detail.showModel === true)
const noFields = computed(() => current.value?.detail.fields.length === 0)

/** 舞台上克隆哪些对象：当前件自己，加上它收着的全部后代。 */
function stageObjects(part: TwinPart): readonly THREE.Object3D[] {
  return partAssembly(props.parts, part.id).flatMap((node) =>
    props.objectsOf(node.part.id),
  )
}

function paint(): void {
  for (const view of views) paintPanelField(view, props.values)
}

function clearCard(): void {
  cardRef.value?.replaceChildren()
  views = []
}

function buildCard(): void {
  const host = cardRef.value
  const part = current.value
  clearCard()
  if (host === null || part === null || part.detail.fields.length === 0) return
  const card = buildPanelCard(detailPanelOf(part))
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
  stageEmpty.value = false
}

function startPreview(): void {
  const stage = stageRef.value
  const part = current.value
  if (stage === null || part === null || !part.detail.showModel) return
  const objects = stageObjects(part)
  stageEmpty.value = objects.length === 0
  if (objects.length === 0) return
  preview = createPartPreview({
    container: stage,
    objects,
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
 * 换部件（或开关弹窗、在装配栏里换一行）时整份重来。
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

watch(current, rebuild, { flush: 'post' })
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
    :description="current?.detail.subtitle ?? ''"
    :width="width"
    @update:model-value="emit('close')"
  >
    <div class="twin-part-modal" :style="bodyStyle">
      <div
        class="twin-part-modal__grid"
        :class="{ 'is-split': hasAssembly }"
        data-test="part-modal-grid"
      >
        <TwinPartAssemblyRail
          v-if="hasAssembly"
          :nodes="assembly"
          :current-id="currentPartId"
          :values="partValues"
          @select="emit('select', $event)"
        />
        <div class="twin-part-modal__detail">
          <section v-show="showModel" class="twin-part-modal__preview">
            <TwinPartSectionHead
              title="部件模型"
              :hint="stageEmpty ? '' : '拖动旋转 · 滚轮缩放'"
            />
            <div
              v-show="!stageEmpty"
              ref="stageRef"
              class="twin-part-modal__stage"
              data-test="part-modal-stage"
            />
            <p
              v-if="stageEmpty"
              class="twin-part-modal__stage twin-part-modal__blank"
              data-test="part-modal-stage-empty"
            >
              模型里找不到这个部件的节点
            </p>
          </section>
          <section class="twin-part-modal__readings">
            <TwinPartSectionHead
              title="部件读数"
              :hint="`${current?.detail.fields.length ?? 0} 项参数`"
            />
            <div
              v-show="!noFields"
              ref="cardRef"
              class="twin-part-modal__data"
              data-test="part-modal-data"
              role="region"
              aria-label="部件读数"
              :tabindex="noFields ? -1 : 0"
            />
            <p
              v-if="noFields"
              class="twin-part-modal__blank"
              data-test="part-modal-no-fields"
            >
              这个部件没有配读数
            </p>
          </section>
        </div>
      </div>
    </div>
  </DtModal>
</template>

<style scoped lang="scss" src="./styles/partModal.scss" />
