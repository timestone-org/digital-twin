<script setup lang="ts">
/**
 * @fileoverview 素材库里的三维模型预览：装一套最小场景，把 glb/gltf 画出来并可转看。
 *
 * ⚠ 这个组件**只许异步加载**（调用方用 `defineAsyncComponent`）：它第一行就
 * 静态依赖整个 three，同步引进来会把素材页的首包撑到几百 KB，而那一页
 * 十有八九根本不看模型。
 * ⚠ 卸载必须把渲染器、场景与模型逐个释放：WebGL 上下文的数量有硬上限
 * （多数浏览器 8～16 个），只丢引用不释放的话，连开十几个模型之后新的一个
 * 就再也拿不到上下文——表现是「预览突然全白」，且控制台只有一句警告。
 */
import {
  WEBGL_UNAVAILABLE_MESSAGE,
  createSceneCore,
  createWebGLRenderer,
  disposeScene,
  disposeSceneGraph,
  frameObject,
  loadTwinModel,
  useRenderLoop,
} from '@dt/three-core'
import type { SceneCore, TwinModelAsset } from '@dt/three-core'
import { DtButton, DtNotice, DtProgress, DtSpinner } from '@dt/ui'
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

// ⚠ 从 three-core 的出参里取这个类型，而不是 `import type ... from 'three'`：
// 应用壳没有把 three 列进自己的依赖，直连它会让 typecheck 在解析包名时就红
type ModelRoot = TwinModelAsset['root']

const props = defineProps<{
  /** 模型原件地址，由调用方从素材引用拼出来。 */
  url: string
}>()

const host = ref<HTMLElement | null>(null)
// ⚠ shallowRef：three 的对象图又深又带循环引用，`ref` 会去深层代理它，
// 既拖慢每一帧，又可能在遍历到某个自引用属性时爆栈
const core = shallowRef<SceneCore | null>(null)
const model = shallowRef<ModelRoot | null>(null)

const error = ref('')
const isLoading = ref(true)
/** 已下载比例，0～1；服务端没给长度时停在 0，界面改用不定态。 */
const ratio = ref(0)
const hasLength = ref(false)

const loop = useRenderLoop({
  core: () => core.value,
  element: () => host.value,
  // 预览不跑动画也不漫游，每帧只要 renderScene 里那次阻尼 update
  onFrame: () => undefined,
})

let loading: AbortController | null = null

function releaseModel(): void {
  const current = model.value
  if (current === null) return
  current.removeFromParent()
  disposeSceneGraph(current)
  model.value = null
}

async function load(): Promise<void> {
  const scene = core.value
  if (scene === null) return
  const controller = new AbortController()
  loading = controller
  isLoading.value = true
  error.value = ''
  try {
    const asset = await loadTwinModel(props.url, {
      signal: controller.signal,
      onProgress: (loaded, total) => {
        hasLength.value = total > 0
        ratio.value = total > 0 ? loaded / total : 0
      },
    })
    releaseModel()
    model.value = asset.root
    scene.modelRoot.add(asset.root)
    frameObject(scene, asset.root)
  } catch (caught) {
    // 中止是组件被卸载了，那时没有任何界面还能显示这条错
    if (!controller.signal.aborted) {
      error.value = caught instanceof Error ? caught.message : '模型加载失败'
    }
  } finally {
    if (loading === controller) {
      loading = null
      isLoading.value = false
    }
  }
}

onMounted(() => {
  const container = host.value
  if (container === null) return
  const renderer = createWebGLRenderer()
  if (renderer === null) {
    // ⚠ 说清是环境不支持而不是素材坏了：换一台机器就好的问题，不该让用户
    // 以为自己传的文件有毛病
    error.value = WEBGL_UNAVAILABLE_MESSAGE
    isLoading.value = false
    return
  }
  core.value = createSceneCore({ container, renderer })
  loop.start()
  void load()
})

// ⚠ 注册在 useRenderLoop 之后：Vue 按注册顺序调卸载钩子，循环先停、场景后释放，
// 反过来的话最后一帧会画在一个已经 dispose 掉的渲染器上
onBeforeUnmount(() => {
  loading?.abort()
  loading = null
  releaseModel()
  const scene = core.value
  if (scene !== null) disposeScene(scene)
  core.value = null
})
</script>

<template>
  <div class="dt-model-viewer">
    <div ref="host" class="dt-model-viewer__stage" />

    <div v-if="isLoading" class="dt-model-viewer__veil">
      <DtSpinner />
      <DtProgress
        v-if="hasLength"
        class="dt-model-viewer__bar"
        :value="ratio * 100"
      />
      <p class="dt-model-viewer__hint">正在下载模型…</p>
    </div>

    <div v-else-if="error !== ''" class="dt-model-viewer__veil">
      <DtNotice intent="danger">{{ error }}</DtNotice>
      <DtButton size="sm" variant="outline" @click="load()">重试</DtButton>
    </div>

    <p v-else class="dt-model-viewer__tip">拖动旋转 · 滚轮缩放 · 右键平移</p>
  </div>
</template>

<style scoped lang="scss">
.dt-model-viewer {
  position: relative;
  display: flex;
  overflow: hidden;
  min-height: 20rem;
  flex: 1;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);

  &__stage {
    position: relative;
    flex: 1;
  }

  &__veil {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    gap: 12px;
    inset: 0;
  }

  &__bar {
    width: min(20rem, 70%);
  }

  &__hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
  }

  &__tip {
    position: absolute;
    right: 8px;
    bottom: 8px;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    margin: 0;
    background: var(--surface-raised);
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-md);
    pointer-events: none;
  }
}
</style>
