/**
 * @fileoverview 序号法竞态防护：只有最后一次发起的请求能写状态。
 *
 * ⚠ 只要一条加载路径可能被「快速切换」触发第二次（换筛选、换时间范围、
 * 连点列表），就必须防竞态——否则慢的那次后返回会覆盖快的那次的结果，
 * 界面显示的是过期数据，且没有任何报错。
 *
 * ⚠ 卸载或关闭弹窗时要 `cancel()`：不作废的话，之后才返回的那一次照样会写进
 * 一个已经没人看的状态；请求本身也白占一条连接。
 */

export interface RacedHandlers<TResult> {
  ok: (result: TResult) => void
  fail: (caught: unknown) => void
  /** 无论成败都跑，但同样只在「自己仍是最后一次」时跑。 */
  settled: () => void
}

export interface RacedFetch {
  /** 发起一次；`task` 收到的 signal 会在被后一次顶掉或 `cancel()` 时中止。 */
  run: <TResult>(
    task: (signal: AbortSignal) => Promise<TResult>,
    handlers: RacedHandlers<TResult>,
  ) => Promise<void>
  /** 作废在飞的那一次：中止它的请求，且它之后返回也不许再写状态。 */
  cancel: () => void
}

export function useRacedFetch(): RacedFetch {
  let sequence = 0
  let inFlight: AbortController | null = null

  function claim(): AbortController {
    inFlight?.abort()
    sequence += 1
    const controller = new AbortController()
    inFlight = controller
    return controller
  }

  async function run<TResult>(
    task: (signal: AbortSignal) => Promise<TResult>,
    handlers: RacedHandlers<TResult>,
  ): Promise<void> {
    const controller = claim()
    const mine = sequence
    try {
      const result = await task(controller.signal)
      if (mine === sequence) handlers.ok(result)
    } catch (caught) {
      if (mine === sequence) handlers.fail(caught)
    } finally {
      if (mine === sequence) handlers.settled()
    }
  }

  function cancel(): void {
    inFlight?.abort()
    inFlight = null
    // ⚠ 推进序号：中止只让请求早点返回，拦不住已经拿到结果的那一次写状态
    sequence += 1
  }

  return { run, cancel }
}
