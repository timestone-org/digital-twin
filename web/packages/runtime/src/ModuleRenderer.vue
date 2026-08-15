<script setup lang="ts">
/**
 * @fileoverview ModuleRenderer —— 固定三件套 props（`config` / `values` / `meta`）的
 * **唯一装配点**：运行时只认识这三样，才能渲染它编译期并不知道的模块
 * （docs/DASHBOARD_DESIGN.md §5.1）。
 * 三条失败边界各自只影响一格：清单缺失 → 占位；渲染抛错 → `onErrorCaptured` 阻断冒泡；
 * 异步 chunk 加载失败 → 重试一次后占位。
 */
import type {
  BindingView,
  CardChrome,
  InteractionEvent,
  ModuleMeta,
} from '@dt/contracts'
import {
  computed,
  defineAsyncComponent,
  inject,
  onErrorCaptured,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue'

import { resolveCardChrome } from './cardVars'
import { INTERACTION_KEY } from './interactionRuntime'
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
  bindings?: readonly BindingView[]
  /** 画布节点 id，透传进 `meta` 供模块与调试用。 */
  nodeId?: string
  /** 大屏级卡片外观缺省；模块级覆盖在 `config.__cardStyle`，同键模块赢。 */
  cardChrome?: CardChrome | undefined
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

// 联动运行时可选：没 provide（设计态画布、独立渲染）就没有可点击外观也不转发
const interaction = inject(INTERACTION_KEY, null)

// 真配了以本节点为源的规则才算可交互——只有开关没有规则就是「点了没反应」
const interactive = computed(
  () =>
    interaction !== null &&
    props.nodeId !== undefined &&
    interaction.hasRules(props.nodeId),
)

/** 模块自己上抛的联动事件，转发给引擎；无引擎时静默丢弃。 */
function forwardInteraction(event: InteractionEvent): void {
  if (interaction === null || props.nodeId === undefined) return
  interaction.dispatch(props.nodeId, event)
}

// 整块可点由宿主统一接管，模块本身零改动
const hostClickable = computed(
  () => manifest.value?.hostClickable === true && interactive.value,
)

function onHostClick(): void {
  if (hostClickable.value) forwardInteraction({ event: 'click' })
}

function onHostKeydown(event: KeyboardEvent): void {
  if (!hostClickable.value) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    forwardInteraction({ event: 'click' })
  }
}

const meta = computed<ModuleMeta>(() => {
  const value: ModuleMeta = { status: status.value }
  if (props.nodeId !== undefined) value.nodeId = props.nodeId
  if (evaluated.value.valueTimeMs !== null) {
    value.valueTimeMs = evaluated.value.valueTimeMs
  }
  const reason = firstReason(evaluated.value.errors)
  if (reason !== '') value.errorMessage = reason
  if (interaction !== null && props.nodeId !== undefined) {
    value.interactive = interactive.value
  }
  return value
})

/** 渲染根要不要套卡片框，由清单声明，不按模块类型判断。 */
const isCard = computed(() => (manifest.value?.chrome ?? 'card') === 'card')

/** 缺省 true：只有显式退出统一外观的模块才两条路都不走。 */
const isChromeConfigurable = computed(
  () => manifest.value?.chromeConfigurable !== false,
)

// 大屏级缺省 + 模块级覆盖 → 这一格的卡片外观。没配任何 chrome 键时 style 是
// undefined，一个变量都不注入 = 渲染完全走平台默认，这是 chrome 的铁律
const chrome = computed(() =>
  resolveCardChrome(
    props.cardChrome,
    props.config?.__cardStyle,
    isCard.value,
    isChromeConfigurable.value,
  ),
)
</script>

<template>
  <div
    class="dt-module"
    :class="[
      chrome.classes,
      {
        'dt-module--card': chrome.isFramed,
        'dt-module--clickable': hostClickable,
      },
    ]"
    :style="chrome.style"
    :role="hostClickable ? 'button' : undefined"
    :tabindex="hostClickable ? 0 : undefined"
    @click="onHostClick"
    @keydown="onHostKeydown"
  >
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
        @interaction="forwardInteraction"
      >
        <slot />
      </component>
      <ModuleStatusOverlay
        :status="status"
        :message="meta.errorMessage ?? ''"
      />
    </template>
    <!-- 下两角：一个盒子只有 ::before / ::after 两个伪元素，下面两角得再借一层 -->
    <i v-if="chrome.isFramed" class="dt-corner-b" />
    <!-- 裸模块的纯描边浮层：只描边、不加背景，模块自己的画布在其下全幅 -->
    <i v-else-if="chrome.overlay.length > 0" :class="chrome.overlay">
      <i class="dt-corner-b" />
    </i>
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
  // 画布级正文缺省：三条都靠继承往下走，未注入时 inherit = 完全不改变现有渲染。
  // 模块自己写死或配过的排版天然赢过继承来的值，不需要第二套合并逻辑
  font-family: var(--card-font, inherit);
  font-size: var(--card-font-size, inherit);
  color: var(--card-text, inherit);
}

// ⚠ 卡片框、八种边框样式、四角与呼吸动画**不在这里**，在 runtime 的全局
// `styles/chrome.scss`：动画名由 CSS 变量注入，scoped 改写认不出来，写在这儿会静默失效。

// 整块可点的宿主外观：手型 + 键盘焦点环都在这一处，模块不必各写一遍
.dt-module--clickable {
  cursor: pointer;
}

.dt-module--clickable:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 1px;
}
</style>
