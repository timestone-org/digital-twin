/**
 * @fileoverview 换肤意图的契约：没选过时是深色而不是跟随系统、偏好跨会话记得住、
 * 存储不可用时不崩、认不出的值落回默认，以及选了「跟随系统」后真的跟着系统深浅走。
 *
 * ⚠ 状态是模块级单例，用例之间必然串。每条都用 resetModules + 动态 import
 * 拿一份干净的实例，否则上一条存进去的偏好会漂到下一条。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'dt.theme'
const SYSTEM = 'system'

type MediaListener = (event: { matches: boolean }) => void

/** 装一个可编程的 matchMedia，返回触发系统深浅变化的开关。 */
function stubMatchMedia(matches: boolean, withListener = true) {
  const listeners: MediaListener[] = []
  const query = {
    matches,
    ...(withListener
      ? {
          addEventListener: (_name: string, handler: MediaListener) => {
            listeners.push(handler)
          },
        }
      : {}),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  )
  return {
    emit(next: boolean) {
      for (const handler of listeners) handler({ matches: next })
    },
  }
}

async function freshModule() {
  vi.resetModules()
  return import('@/composables/useThemePreference')
}

beforeEach(() => {
  localStorage.clear()
  stubMatchMedia(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useThemePreference · 缺省是深色', () => {
  it('没存过时给默认深色，不是跟随系统', async () => {
    const { DEFAULT_THEME_ID } = await import('@dt/tokens')
    const { useThemePreference } = await freshModule()
    expect(useThemePreference().preference.value).toBe(DEFAULT_THEME_ID)
  })

  it('系统偏浅色也照样是深色——浅色只在显式选过之后才出现', async () => {
    stubMatchMedia(true)
    const { DEFAULT_THEME_ID } = await import('@dt/tokens')
    const { useThemePreference } = await freshModule()
    expect(useThemePreference().resolvedId.value).toBe(DEFAULT_THEME_ID)
  })

  it('缺省不落盘——存下来就把这一刻的默认焊死，之后换默认他也不动', async () => {
    const { useThemePreference } = await freshModule()
    useThemePreference()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('useThemePreference · 持久化', () => {
  it('选过的主题下次进来还在', async () => {
    const first = await freshModule()
    first.useThemePreference().setPreference('emerald')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('emerald')

    const second = await freshModule()
    expect(second.useThemePreference().preference.value).toBe('emerald')
  })

  it('选「跟随系统」存的是 system 这一档，不是把键清掉', async () => {
    const { SYSTEM_PREFERENCE, useThemePreference } = await freshModule()
    const handle = useThemePreference()
    handle.setPreference('light')
    handle.setPreference(SYSTEM_PREFERENCE)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(SYSTEM)
  })

  it('存着 system 时下次进来仍是跟随系统', async () => {
    localStorage.setItem(STORAGE_KEY, SYSTEM)
    stubMatchMedia(true)
    const { SYSTEM_PREFERENCE, useThemePreference } = await freshModule()
    const handle = useThemePreference()
    expect(handle.preference.value).toBe(SYSTEM_PREFERENCE)
    expect(handle.resolvedId.value).toBe('light')
  })

  it('认不出的值落回默认深色——原样灌给引擎会静默回退，显示的和存的对不上', async () => {
    localStorage.setItem(STORAGE_KEY, 'no-such-theme')
    const { DEFAULT_THEME_ID } = await import('@dt/tokens')
    const { useThemePreference } = await freshModule()
    expect(useThemePreference().preference.value).toBe(DEFAULT_THEME_ID)
  })

  it('setPreference 同样挡野值', async () => {
    const { DEFAULT_THEME_ID } = await import('@dt/tokens')
    const { useThemePreference } = await freshModule()
    const handle = useThemePreference()
    handle.setPreference('no-such-theme')
    expect(handle.preference.value).toBe(DEFAULT_THEME_ID)
  })
})

describe('useThemePreference · 存储不可用', () => {
  it('读会抛（无痕模式）也照常起来，退化成默认深色', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const { DEFAULT_THEME_ID } = await import('@dt/tokens')
    const { useThemePreference } = await freshModule()
    expect(useThemePreference().preference.value).toBe(DEFAULT_THEME_ID)
  })

  it('写会抛也不影响本次会话内生效', async () => {
    const { useThemePreference } = await freshModule()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const handle = useThemePreference()
    handle.setPreference('cobalt-deep')
    expect(handle.preference.value).toBe('cobalt-deep')
  })
})

describe('useThemePreference · 跟随系统', () => {
  it('系统偏浅色时解析成浅色主题', async () => {
    stubMatchMedia(true)
    const { SYSTEM_PREFERENCE, useThemePreference } = await freshModule()
    const handle = useThemePreference()
    handle.setPreference(SYSTEM_PREFERENCE)
    expect(handle.resolvedId.value).toBe('light')
  })

  it('系统偏深色时解析成默认深色主题', async () => {
    stubMatchMedia(false)
    const { DEFAULT_THEME_ID } = await import('@dt/tokens')
    const { SYSTEM_PREFERENCE, useThemePreference } = await freshModule()
    const handle = useThemePreference()
    handle.setPreference(SYSTEM_PREFERENCE)
    expect(handle.resolvedId.value).toBe(DEFAULT_THEME_ID)
  })

  it('系统深浅在运行中变了，生效的主题跟着变', async () => {
    const media = stubMatchMedia(false)
    const { SYSTEM_PREFERENCE, useThemePreference } = await freshModule()
    const handle = useThemePreference()
    handle.setPreference(SYSTEM_PREFERENCE)
    expect(handle.resolvedId.value).toBe('dark-tech')

    media.emit(true)
    expect(handle.resolvedId.value).toBe('light')
  })

  it('选了具体主题就不再理会系统深浅', async () => {
    const media = stubMatchMedia(false)
    const { useThemePreference } = await freshModule()
    const handle = useThemePreference()
    handle.setPreference('lava-amber')

    media.emit(true)
    expect(handle.resolvedId.value).toBe('lava-amber')
  })

  it('MediaQueryList 没有 addEventListener 时只保留初值，不整个崩掉', async () => {
    stubMatchMedia(true, false)
    const { SYSTEM_PREFERENCE, useThemePreference } = await freshModule()
    const handle = useThemePreference()
    handle.setPreference(SYSTEM_PREFERENCE)
    expect(handle.resolvedId.value).toBe('light')
  })

  it('环境没有 matchMedia 时退回默认深色', async () => {
    vi.stubGlobal('matchMedia', undefined)
    const { SYSTEM_PREFERENCE, useThemePreference } = await freshModule()
    const handle = useThemePreference()
    handle.setPreference(SYSTEM_PREFERENCE)
    expect(handle.resolvedId.value).toBe('dark-tech')
  })
})

describe('useThemePreference · 单例', () => {
  it('两处取到的是同一份状态——各持一份的话切换器点了不生效', async () => {
    const { useThemePreference } = await freshModule()
    const topbar = useThemePreference()
    const injector = useThemePreference()

    topbar.setPreference('nebula-violet')
    expect(injector.preference.value).toBe('nebula-violet')
    expect(injector.resolvedId.value).toBe('nebula-violet')
  })

  it('options 列出全部内置主题', async () => {
    const { listThemes } = await import('@dt/tokens')
    const { useThemePreference } = await freshModule()
    expect(useThemePreference().options.value.map((theme) => theme.id)).toEqual(
      listThemes().map((theme) => theme.id),
    )
  })
})
