/**
 * @fileoverview 换肤意图：用户选了哪套主题，以及选「跟随系统」时实际生效的是哪套。
 *
 * ⚠ 状态是**模块级单例**，不像 useSidebar 那样每次调用新建一份：顶栏的换肤器与
 * 根注入必须读同一份，各持一份的话点了没反应——切换器改的是自己那份。
 *
 * ⚠ 没选过时是深色（`DEFAULT_THEME_ID`）而不是跟随系统：六套预设里五套是深色，
 * 浅色是备给特定现场的一档，让它在浅色系统上不请自来会把整个平台的观感换掉。
 * 「跟随系统」仍在换肤面板里，但要显式选。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { DEFAULT_THEME_ID, listThemes, type ThemeDefinition } from '@dt/tokens'

const STORAGE_KEY = 'dt.theme'
const LIGHT_QUERY = '(prefers-color-scheme: light)'
/** 系统偏浅色时「跟随系统」落到的那一套。 */
const LIGHT_THEME_ID = 'light'

/** 「跟随系统」这一档的存储值。⚠ 不许与任何预设 id 撞名。 */
export const SYSTEM_PREFERENCE = 'system'

/** 主题 id，或 `SYSTEM_PREFERENCE` = 跟随系统深浅。 */
export type ThemePreference = string

function isKnownPreference(id: string): boolean {
  return (
    id === SYSTEM_PREFERENCE || listThemes().some((theme) => theme.id === id)
  )
}

function read(): ThemePreference {
  // ⚠ Safari 无痕模式下访问 localStorage 会抛，丢个偏好不该把页面带崩
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // 认不出的值（存储被手改过、或预设改了名）按没选过处理：原样灌给引擎的话
    // 会静默回退到默认主题，用户看到的和存的对不上
    return raw !== null && isKnownPreference(raw) ? raw : DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

// ⚠ 初值不落盘：没选过的人要跟着「当前的默认」走，存一份下来就把这一刻的默认
// 焊死在这台机器上，之后换默认他也不动
const preference: Ref<ThemePreference> = ref(read())

// 用 watch 而不是只在 setPreference 里写：preference 是对外暴露的 Ref，
// 直接赋值的那条路同样要落盘。
// ⚠ flush 取 sync：默认的 pre 要等到下一个微任务，「选完立刻关标签页」就丢了偏好。
watch(
  preference,
  (next) => {
    // ⚠ 同上：写入也会抛
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* 存不下就只在本次会话内有效 */
    }
  },
  { flush: 'sync' },
)

const systemPrefersLight = ref(false)
let systemWatched = false

/**
 * 起系统深浅的跟踪。首次取用时才跑，import 本身不产生副作用。
 * 监听器有意不解绑：它挂在模块级单例上，与文档同生命周期，解绑了就没人再更新它。
 */
function watchSystemScheme(): void {
  if (systemWatched) return
  systemWatched = true
  if (typeof window === 'undefined') return
  if (typeof window.matchMedia !== 'function') return
  const query = window.matchMedia(LIGHT_QUERY)
  systemPrefersLight.value = query.matches
  // 部分环境的 MediaQueryList 只有已废弃的 addListener，没有 addEventListener。
  // 拿不到就只保留初值：跟随系统仍然成立，只是不会在运行中跟着系统一起变
  if (typeof query.addEventListener !== 'function') return
  query.addEventListener('change', (event) => {
    systemPrefersLight.value = event.matches
  })
}

const resolvedId: ComputedRef<string> = computed(() => {
  if (preference.value !== SYSTEM_PREFERENCE) return preference.value
  return systemPrefersLight.value ? LIGHT_THEME_ID : DEFAULT_THEME_ID
})

const options: ComputedRef<readonly ThemeDefinition[]> = computed(() =>
  listThemes(),
)

/**
 * 记下用户选的那一档。
 * @param id 主题 id 或 `SYSTEM_PREFERENCE`；认不出的一律落回默认深色
 */
function setPreference(id: ThemePreference): void {
  preference.value = isKnownPreference(id) ? id : DEFAULT_THEME_ID
}

export interface ThemePreferenceHandle {
  /** 用户选的那一档；`SYSTEM_PREFERENCE` = 跟随系统，没选过时是默认深色。 */
  preference: Ref<ThemePreference>
  /** 实际生效的主题 id，选了跟随系统时按系统深浅解析。 */
  resolvedId: ComputedRef<string>
  setPreference: (id: ThemePreference) => void
  options: ComputedRef<readonly ThemeDefinition[]>
}

/** 换肤意图的单例句柄。 */
export function useThemePreference(): ThemePreferenceHandle {
  watchSystemScheme()
  return { preference, resolvedId, setPreference, options }
}
