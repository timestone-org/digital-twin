/**
 * @fileoverview 实时点位（`opcua`）来源的 provider。
 * ⚠ 它**不自己建 WebSocket**：连接要读登录态，而登录态在应用壳里，所以订阅
 * 函数由应用壳注入（docs/DASHBOARD_DESIGN.md §7）。这也正是本包能在测试与
 * 编辑器预览态里跑假件的原因。
 */
import type {
  DataSourceProvider,
  HistoryQuery,
  HistoryResult,
  PointValueListener,
  Unsubscribe,
} from '@dt/contracts'

import { refuseHistory } from '../capability'

const KIND = 'opcua'

/** 应用壳注入的口子。 */
export interface RealtimePorts {
  /** 订阅一批点位，返回退订。 */
  subscribe: (
    nodeKeys: readonly string[],
    onValue: PointValueListener,
  ) => Unsubscribe
  /**
   * 实时点位的历史序列。
   * ⚠ 不注入时 `readHistory` 一律拒绝：实时通道里只有当前值，拿收到过的那几个
   * 点当历史，会画出一条从打开页面才开始的假曲线。
   */
  readHistory?: (query: HistoryQuery) => Promise<HistoryResult>
}

/**
 * 造一个实时点位 provider。
 * @param ports 应用壳注入的订阅与（可选的）历史取数
 */
export function createRealtimeProvider(
  ports: RealtimePorts,
): DataSourceProvider {
  return {
    kind: KIND,
    subscribe: (nodeKeys, onValue) => subscribeOnce(ports, nodeKeys, onValue),
    readHistory: (query) => {
      const read = ports.readHistory
      return read === undefined ? refuseHistory(KIND) : read(query)
    },
  }
}

function subscribeOnce(
  ports: RealtimePorts,
  nodeKeys: readonly string[],
  onValue: PointValueListener,
): Unsubscribe {
  // 同一个点位绑到两个槽是常事，去重后再往下发
  const keys = [...new Set(nodeKeys)]
  if (keys.length === 0) return () => undefined
  const stop = ports.subscribe(keys, onValue)
  // ⚠ 退订必须幂等：重复调用会把重建后的那份订阅一起摘掉
  const state = { stopped: false }
  return () => {
    if (state.stopped) return
    state.stopped = true
    stop()
  }
}
