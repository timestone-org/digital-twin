/**
 * @fileoverview 序号法竞态防护：只有最后一次发起的请求能写状态。
 *
 * ⚠ 只要一条加载路径可能被「快速切换」触发第二次（换筛选、换时间范围、
 * 连点列表），就必须防竞态——否则慢的那次后返回会覆盖快的那次的结果，
 * 界面显示的是过期数据，且没有任何报错。
 */

export interface RacedHandlers<TResult> {
  ok: (result: TResult) => void
  fail: (caught: unknown) => void
  /** 无论成败都跑，但同样只在「自己仍是最后一次」时跑。 */
  settled: () => void
}

export interface RacedFetch {
  run: <TResult>(
    task: () => Promise<TResult>,
    handlers: RacedHandlers<TResult>,
  ) => Promise<void>
}

export function useRacedFetch(): RacedFetch {
  let sequence = 0

  async function run<TResult>(
    task: () => Promise<TResult>,
    handlers: RacedHandlers<TResult>,
  ): Promise<void> {
    const mine = ++sequence
    try {
      const result = await task()
      if (mine === sequence) handlers.ok(result)
    } catch (caught) {
      if (mine === sequence) handlers.fail(caught)
    } finally {
      if (mine === sequence) handlers.settled()
    }
  }

  return { run }
}
