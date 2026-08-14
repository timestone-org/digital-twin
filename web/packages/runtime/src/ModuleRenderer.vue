<script setup lang="ts">
/**
 * @fileoverview ModuleRenderer —— 固定三件套 props（`config` / `values` / `meta`）的
 * **唯一装配点**：运行时只认识这三样，才能渲染它编译期并不知道的模块
 * （docs/DASHBOARD_DESIGN.md §5.1）。
 * 三条失败边界各自只影响一格：清单缺失 → 占位；渲染抛错 → `onErrorCaptured` 阻断冒泡；
 * 异步 chunk 加载失败 → 重试一次后占位。
 */
import type { BindingPayload, ModuleMeta } from '@dt/contracts'
import {
  computed,
  defineAsyncComponent,
  onErrorCaptured,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue'

import ModuleFallback from './ModuleFallback.vue'
import ModuleStatusOverlay from './ModuleStatusOverlay.vue'
import { computeModuleStatus, countUnboundRequired } from './moduleStatus'
import { computeModuleValues } from './moduleValues'
import { resolveModuleConfig, type GetModuleManifest } from './nodeTree'
import { useRuntimeData } from './runtimeData'

const props = defineProps<{
  moduleType: string
  /** 节点落库的配置；清单缺省在这里铺底。 */
  config?: Record<string, unknown>
  bindings?: readonly BindingPayload[]
  /** 画布节点 id，透传进 `meta` 供模块与调试用。 */
  nodeId?: string
  /**
   * 注入式清单解析器。
   * ⚠ 必填而不是可选：本包不查注册表，注册表由应用壳持有；给成可选就会有人忘了传，
   * 而忘了传的表现是整屏每一格都渲染成「未知模块类型」。
   */
  getManifest: GetModuleManifest
}>()

/** 异步 chunk 最多重试一次：再失败就是占位，不无限重试拖住这一格。 */
const LOAD_ATTEMPT_LIMIT = 1

/** 异步 chunk 的加载超时（ms）。 */
const LOAD_TIMEOUT_MS = 15_000

const runtimeData = useRuntimeData()

const manifest = computed(() => props.getManifest(props.moduleType))

// ⚠ 用 null 表示「没失败」而不是空串：异常带的消息**可以是空串**，
// 拿空串当哨兵的话那一格既不渲染模块也不渲染占位，只剩一块什么都不说的空白
const renderFailure = ref<string | null>(null)
const loadFailure = ref<string | null>(null)
const asyncComponent = shallowRef<Component | null>(null)

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : '未知错误'
}

// ⚠ 必须返回 false 阻断冒泡：不阻断的话这一格的异常会一路冒到应用根，整屏跟着白
onErrorCaptured((error) => {
  renderFailure.value = describeError(error)
  return false
})

function toAsyncComponent(
  loader: () => Promise<{ default: Component }>,
): Component {
  return defineAsyncComponent({
    // ⚠ 必须自己剥 default：Vue 只对带 `Symbol.toStringTag: 'Module'` 的结果剥，
    // 而清单契约允许 `Promise.resolve({ default: C })`（第三方不走 import() 时就是它），
    // 直接交给 Vue 会把整个 `{ default: C }` 当组件，表现是这一格既不渲染也不占位
    loader: async () => (await loader()).default,
    timeout: LOAD_TIMEOUT_MS,
    onError(error, retry, fail, attempts) {
      if (attempts <= LOAD_ATTEMPT_LIMIT) {
        retry()
        return
      }
      loadFailure.value = describeError(error)
      fail()
    },
  })
}

// 换了模块类型或换了节点，上一格的失败痕迹不能留着——否则新模块一挂上就是占位
watch(
  () => [props.nodeId, manifest.value] as const,
  () => {
    renderFailure.value = null
    loadFailure.value = null
    const loader = manifest.value?.component
    asyncComponent.value =
      loader === undefined ? null : toAsyncComponent(loader)
  },
  { immediate: true },
)

const fallback = computed<{ title: string; detail: string } | null>(() => {
  if (manifest.value === undefined) {
    return { title: '未知模块类型', detail: props.moduleType }
  }
  if (loadFailure.value !== null) {
    return { title: '模块加载失败', detail: loadFailure.value }
  }
  if (renderFailure.value !== null) {
    return { title: '模块渲染失败', detail: renderFailure.value }
  }
  return null
})

const resolvedConfig = computed(() =>
  resolveModuleConfig(manifest.value, props.config),
)

// ⚠ 在 computed 里调用注入的读取器：对取数源的响应式依赖由这次调用建立
const evaluated = computed(() =>
  computeModuleValues({
    specs: manifest.value?.bindings ?? [],
    bindings: props.bindings ?? [],
    read: runtimeData.readBinding(),
  }),
)

const status = computed(() =>
  computeModuleStatus({
    hasRenderError: fallback.value !== null,
    unboundRequiredCount: countUnboundRequired(
      manifest.value?.bindings ?? [],
      props.bindings ?? [],
    ),
    tally: evaluated.value.tally,
  }),
)

/** 状态条只放得下一句，取第一条槽的原因；逐槽原因在求值结果里。 */
function firstReason(errors: Readonly<Record<string, string>>): string {
  const [first] = Object.entries(errors)
  return first === undefined ? '' : `${first[0]}：${first[1]}`
}

const meta = computed<ModuleMeta>(() => {
  const value: ModuleMeta = { status: status.value }
  if (props.nodeId !== undefined) value.nodeId = props.nodeId
  if (evaluated.value.valueTimeMs !== null) {
    value.valueTimeMs = evaluated.value.valueTimeMs
  }
  const reason = firstReason(evaluated.value.errors)
  if (reason !== '') value.errorMessage = reason
  return value
})

/** 渲染根要不要套卡片框，由清单声明，不按模块类型判断。 */
const isCard = computed(() => (manifest.value?.chrome ?? 'card') === 'card')
</script>

<template>
  <div class="dt-module" :class="{ 'dt-module--card': isCard }">
    <ModuleFallback
      v-if="fallback"
      :title="fallback.title"
      :detail="fallback.detail"
    />
    <template v-else>
      <component
        :is="asyncComponent"
        v-if="asyncComponent"
        :config="resolvedConfig"
        :values="evaluated.values"
        :meta="meta"
      >
        <slot />
      </component>
      <ModuleStatusOverlay
        :status="status"
        :message="meta.errorMessage ?? ''"
      />
    </template>
  </div>
</template>

<style scoped lang="scss">
// 填满节点矩形并把内容裁在本格内：一格的溢出绝不许盖住相邻模块
.dt-module {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.dt-module--card {
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  background: var(--card-bg);
}
</style>
