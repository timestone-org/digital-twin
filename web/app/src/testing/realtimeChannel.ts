/**
 * @fileoverview 用例里的假实时通道。
 *
 * ⚠ 不打桩就是**真的开一条 WebSocket**：`useRealtimeChannel()` 一被调用就去连，
 * 连不上还会排一个重连定时器。而定时器在测试环境拆掉之后才到点，于是整轮
 * vitest 报一条 `window is not defined` 的未处理异常——测试全绿，退出码却非零。
 * ⚠ 谁挂了会订实时值的组件谁就得桩，而这件事很容易忘，所以桩只写这一份：
 * 各 spec 里 `vi.mock` 转一手，别再各写各的。
 */
import { ref, type Ref } from 'vue'

export interface FakeChannel {
  isConnected: Ref<boolean>
  /** 服务端明确拒绝了这条连接（公开票据无效或已撤回）。 */
  isRejected: Ref<boolean>
  /** 订过的主题，按调用顺序。 */
  topics: string[]
  subscribe: (topic: string, handler: (payload: object) => void) => () => void
  /** 手工推一帧给最后一个订阅者；没人订就什么都不做。 */
  push: (payload: object) => void
}

/** 造一条不连网的通道。默认当作已连上。 */
export function fakeRealtimeChannel(isConnected = true): FakeChannel {
  const connected = ref(isConnected)
  const topics: string[] = []
  let last: ((payload: object) => void) | null = null

  return {
    isConnected: connected,
    isRejected: ref(false),
    topics,
    subscribe: (topic, handler) => {
      topics.push(topic)
      last = handler
      return () => {
        last = null
      }
    },
    push: (payload) => last?.(payload),
  }
}
