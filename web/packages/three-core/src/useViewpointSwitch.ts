/**
 * @fileoverview 运行态的视点切换：算出要显示哪几个视点、当前停在哪个，
 * 以及数字键与方括号键的快捷切换。不碰 three，切到哪个视点由宿主落到相机上。
 */
import type { TwinCamera, TwinConfig } from '@dt/twin-config'
import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'

export interface ViewpointSwitchOptions {
  /** 挂键盘监听的宿主元素。 */
  element: () => HTMLElement | null
  config: () => TwinConfig
  /** 切到某个视点：宿主把它落到相机上。 */
  onSwitch: (camera: TwinCamera) => void
}

export interface ViewpointSwitch {
  /** 要显示的视点，已按 `items` 排好序。空数组 = 不显示控件。 */
  items: ComputedRef<readonly TwinCamera[]>
  /** 当前停在哪个视点的 id；一个都没有时空串。 */
  activeId: Ref<string>
  switchTo: (id: string) => void
  attach: () => void
  detach: () => void
}

/** 数字键只到 9：再往上没有对应的键，第 10 个之后只能点或用方括号翻。 */
const MAX_DIGIT_SHORTCUT = 9

/** 前后翻的按键；方括号与翻页键各给一档。 */
const STEP_KEYS: Readonly<Record<string, number>> = {
  ']': 1,
  PageDown: 1,
  '[': -1,
  PageUp: -1,
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * 这一下按键要切到哪个视点；不是切换键给 null。
 * ⚠ 前后翻时没停在任何视点上就从第一个开始，而不是当成「找不到」放弃——
 * 用户刚打开大屏还没切过，按一下方括号该有反应。
 * @param key 按键
 * @param items 当前显示的视点
 * @param activeId 当前停在哪个视点上
 */
function keyTarget(
  key: string,
  items: readonly TwinCamera[],
  activeId: string,
): string | null {
  if (key >= '1' && key <= String(MAX_DIGIT_SHORTCUT)) {
    return items[Number(key) - 1]?.id ?? null
  }
  const delta = STEP_KEYS[key]
  if (delta === undefined || items.length === 0) return null
  const current = items.findIndex((item) => item.id === activeId)
  const from = current < 0 ? 0 : current
  return items[(from + delta + items.length) % items.length]?.id ?? null
}

/**
 * 装上视点切换。
 * @param options 宿主元素、配置与切换回调
 */
export function useViewpointSwitch(
  options: ViewpointSwitchOptions,
): ViewpointSwitch {
  const activeId = ref('')

  const items = computed<readonly TwinCamera[]>(() => {
    const config = options.config()
    if (!config.viewpoints.enabled) return []
    const byId = new Map(config.cameras.map((camera) => [camera.id, camera]))
    // 没列 items 就按视点的文档序全显示
    const ids =
      config.viewpoints.items.length > 0
        ? config.viewpoints.items
        : config.cameras.map((camera) => camera.id)
    // ⚠ 指向已删视点的 id 直接跳过：留着会画出一个点了没反应的按钮。
    // 悬空 id 本身由 `collectTwinConfigIssues` 报，渲染层不猜
    return ids
      .map((id) => byId.get(id))
      .filter((camera): camera is TwinCamera => camera !== undefined)
  })

  function switchTo(id: string): void {
    const camera = items.value.find((item) => item.id === id)
    if (camera === undefined) return
    activeId.value = camera.id
    options.onSwitch(camera)
  }

  /** 这一下按的是什么；接住了给 true。 */
  function handleKey(key: string): boolean {
    const id = keyTarget(key, items.value, activeId.value)
    if (id === null) return false
    switchTo(id)
    return true
  }

  function onKeydown(event: KeyboardEvent): void {
    // ⚠ 在输入框里按数字不该把镜头甩走
    if (isTypingTarget(event.target)) return
    if (!options.config().viewpoints.keyboard) return
    if (items.value.length === 0) return
    if (handleKey(event.key)) event.preventDefault()
  }

  function attach(): void {
    const element = options.element()
    if (element === null) return
    // 挂在宿主上而不是 window：同一页放两块大屏时，键盘只该管鼠标所在的那块。
    // tabindex 由模板给，否则元素收不到 keydown
    element.addEventListener('keydown', onKeydown)
  }

  function detach(): void {
    options.element()?.removeEventListener('keydown', onKeydown)
  }

  // ⚠ 自己兜住卸载，不指望宿主记得调 detach：漏一次就是一个吃着按键的死监听
  onBeforeUnmount(detach)

  return { items, activeId, switchTo, attach, detach }
}
