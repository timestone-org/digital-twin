/**
 * @fileoverview 设备码登录那一段状态。
 *
 * 守三条只有出事才看得见的规矩：轮询间隔必须用**返回值里那个**
 * （上游让慢下来时它会变大，照原间隔接着打的话被限流的是整台机器）、
 * 作用域销毁要把定时器停掉（不停的话离开这一页之后它还在打）、
 * 以及连点两下「登录」时前一次立刻作废（不作废的话界面在两个用户码之间来回跳）。
 */
import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/assistant', () => ({
  startDeviceLogin: vi.fn(),
  pollDeviceLogin: vi.fn(),
  readCredential: vi.fn(),
  forgetCredential: vi.fn(),
}))

const api = await import('@/api/assistant')
const { useCodexLogin } =
  await import('@/pages/System/Assistant/scripts/useCodexLogin')

function started(ref_ = 'r1', interval = 5) {
  return {
    ref: ref_,
    user_code: 'ABCD-1234',
    verification_uri: 'https://example.test/activate',
    interval_s: interval,
    expires_in_s: 900,
  }
}

function connected() {
  return {
    provider: 'codex',
    is_connected: true,
    account_label: '…a1b2c3',
    plan_label: 'plus',
    expires_at: null,
    last_refresh_at: null,
    last_error: null,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(api.readCredential).mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('设备码登录', () => {
  it('开了头就把用户码摆出来，并按上游给的间隔问', async () => {
    vi.mocked(api.startDeviceLogin).mockResolvedValue(started('r1', 7))
    vi.mocked(api.pollDeviceLogin).mockResolvedValue({
      is_done: false,
      interval_s: 7,
      status: null,
    })
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    await login?.begin()

    expect(login?.pending.value?.user_code).toBe('ABCD-1234')
    await vi.advanceTimersByTimeAsync(6_000)
    expect(api.pollDeviceLogin).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(api.pollDeviceLogin).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('上游让慢下来时下一次就隔得更久', async () => {
    vi.mocked(api.startDeviceLogin).mockResolvedValue(started('r1', 2))
    vi.mocked(api.pollDeviceLogin).mockResolvedValue({
      is_done: false,
      interval_s: 9,
      status: null,
    })
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    await login?.begin()

    await vi.advanceTimersByTimeAsync(2_500)
    expect(api.pollDeviceLogin).toHaveBeenCalledTimes(1)
    // 还按 2 秒打的话这里就该有第二次了——而那会把整台机器打进限流
    await vi.advanceTimersByTimeAsync(3_000)
    expect(api.pollDeviceLogin).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(7_000)
    expect(api.pollDeviceLogin).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('登好了就收摊，不再接着问', async () => {
    vi.mocked(api.startDeviceLogin).mockResolvedValue(started())
    vi.mocked(api.pollDeviceLogin).mockResolvedValue({
      is_done: true,
      interval_s: 5,
      status: connected(),
    })
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    await login?.begin()

    await vi.advanceTimersByTimeAsync(6_000)
    expect(login?.status.value?.is_connected).toBe(true)
    expect(login?.pending.value).toBeNull()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.pollDeviceLogin).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('连点两下登录时，前一次立刻作废', async () => {
    vi.mocked(api.startDeviceLogin)
      .mockResolvedValueOnce(started('r1'))
      .mockResolvedValueOnce(started('r2'))
    vi.mocked(api.pollDeviceLogin).mockResolvedValue({
      is_done: false,
      interval_s: 5,
      status: null,
    })
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    await login?.begin()
    await login?.begin()

    await vi.advanceTimersByTimeAsync(6_000)
    // 两条轮询都在的话，界面会在两个用户码之间来回跳
    expect(api.pollDeviceLogin).toHaveBeenCalledOnce()
    expect(vi.mocked(api.pollDeviceLogin).mock.calls[0]?.[1]).toBe('r2')
    scope.stop()
  })

  it('作用域销毁之后定时器不再打', async () => {
    vi.mocked(api.startDeviceLogin).mockResolvedValue(started())
    vi.mocked(api.pollDeviceLogin).mockResolvedValue({
      is_done: false,
      interval_s: 5,
      status: null,
    })
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    await login?.begin()
    scope.stop()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.pollDeviceLogin).not.toHaveBeenCalled()
  })

  it('开头就失败时说出来，并且不留一个转着圈的框', async () => {
    vi.mocked(api.startDeviceLogin).mockRejectedValue(new Error('上游连不上'))
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    await login?.begin()

    expect(login?.error.value).toBe('上游连不上')
    expect(login?.pending.value).toBeNull()
    scope.stop()
  })

  it('取消把那一屏收掉，也不再接着问', async () => {
    vi.mocked(api.startDeviceLogin).mockResolvedValue(started())
    vi.mocked(api.pollDeviceLogin).mockResolvedValue({
      is_done: false,
      interval_s: 5,
      status: null,
    })
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    await login?.begin()
    login?.cancel()

    expect(login?.pending.value).toBeNull()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(api.pollDeviceLogin).not.toHaveBeenCalled()
    scope.stop()
  })

  it('读一次登录态', async () => {
    vi.mocked(api.readCredential).mockResolvedValue(connected())
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    await login?.refresh()

    expect(login?.status.value?.account_label).toBe('…a1b2c3')
    scope.stop()
  })

  it('退出登录之后手上那份状态立刻作废', async () => {
    vi.mocked(api.forgetCredential).mockResolvedValue(undefined)
    vi.mocked(api.readCredential).mockResolvedValue(null)
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    if (login !== undefined) login.status.value = connected()
    await login?.signOut()

    expect(api.forgetCredential).toHaveBeenCalledWith('codex')
    expect(login?.status.value).toBeNull()
    scope.stop()
  })

  it('退出登录失败时说出来，不假装退成了', async () => {
    vi.mocked(api.forgetCredential).mockRejectedValue(new Error('删不掉'))
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    if (login !== undefined) login.status.value = connected()
    await login?.signOut()

    expect(login?.error.value).toBe('删不掉')
    expect(login?.status.value).not.toBeNull()
    scope.stop()
  })

  it('轮询中途出错时把话说出来，并把那一屏收掉', async () => {
    vi.mocked(api.startDeviceLogin).mockResolvedValue(started())
    vi.mocked(api.pollDeviceLogin).mockRejectedValue(new Error('上游拒了'))
    const scope = effectScope()
    const login = scope.run(() => useCodexLogin())
    await login?.begin()

    await vi.advanceTimersByTimeAsync(6_000)
    expect(login?.error.value).toBe('上游拒了')
    expect(login?.pending.value).toBeNull()
    scope.stop()
  })
})
