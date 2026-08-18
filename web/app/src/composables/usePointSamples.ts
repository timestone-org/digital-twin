/**
 * @fileoverview 一批点位的实时快照缓存：跟着「当前是哪张屏 + 要订哪些点位」重订，收到就记一份。
 *
 * ⚠ 换一批点位要先退旧订阅：不退的话每改一次绑定就多挂一份，
 * 一张开一天的大屏能攒出几百份，表现是「越用越卡」。
 * ⚠ 换一张屏也要重订，哪怕点位表一模一样：订阅的主题是订阅**那一刻**从
 * `createPointSubscribe` 里取的屏级主题，而总览屏与明细屏绑同一批点位是常态。
 * 只看点位表的话，人已经在 B 屏、订阅还挂在 A 的主题上——画面照样有值
 * （同一批点位），坏的是 hub 那边观看者永远算在 A 头上、publisher 为一张没人看的
 * 屏一直推，而 A 一改绑定 B 屏当场没数据，且现场看不出这跟改 A 有什么关系。
 * ⚠ 没装实时 provider 时一条都不订（公开快照页走这条）：假装订上会让
 * 界面一直停在「等首帧」，而首帧永远不会来。
 */

import { onUnmounted, shallowRef, watch, type Ref } from 'vue'
import type { PointSample, Unsubscribe } from '@dt/contracts'
import { getProvider, hasProvider } from '@dt/datasources'

import type { ReadPointSample } from '@/runtime/bindingReader'

/** 实时点位这一种来源。⚠ 它是绑定的来源种类，不是模块类型。 */
const REALTIME_KIND = 'opcua'

/** 重订依据里「屏」与「点位表」之间的分隔符，点位身份里不会出现它。 */
const SCOPE_SEPARATOR = '\n'

export interface PointSamples {
  /** 收到过读数的点位数，供状态条显示。 */
  sampleCount: Ref<number>
  /**
   * 取一个点位当前的快照；没收到过给 undefined。
   * ⚠ 每次调用都现取：把它在 computed 外面取好再传下去，值再变也不会重算。
   */
  read: ReadPointSample
}

/**
 * 订上这批点位并缓存它们的快照。须在 setup 内调用。
 * @param keys 当前要订的点位身份，**定序**——次序抖动会让这里反复退订重订
 * @param scope 当前是哪张屏（大屏 id / 公开令牌）；换了就连快照一起翻篇
 */
export function usePointSamples(
  keys: () => readonly string[],
  scope: () => string,
): PointSamples {
  const samples = shallowRef(new Map<string, PointSample>())
  const sampleCount = shallowRef(0)
  let stop: Unsubscribe | null = null
  // ⚠ 初值取不到的哨兵用 null 而不是空串：空串是「还没打开任何一张屏」这个真值
  let subscribedScope: string | null = null

  function record(nodeKey: string, sample: PointSample): void {
    // ⚠ 换一份 Map 而不是就地 set：shallowRef 只认引用变化，
    // 就地改的话画面上的值永远停在第一帧
    const next = new Map(samples.value)
    next.set(nodeKey, sample)
    samples.value = next
    sampleCount.value = next.size
  }

  /**
   * ⚠ 只在**换屏**时清快照，换点位表时不清：编辑器里改一次绑定点位表就变一次，
   * 跟着清会让整屏的值闪一下。换屏时不清则相反——上一屏的读数会冒充新屏的首帧。
   */
  function forgetSamples(): void {
    samples.value = new Map()
    sampleCount.value = 0
  }

  function resubscribe(nextScope: string, wanted: readonly string[]): void {
    stop?.()
    stop = null
    if (nextScope !== subscribedScope) {
      subscribedScope = nextScope
      forgetSamples()
    }
    if (wanted.length === 0 || !hasProvider(REALTIME_KIND)) return
    stop = getProvider(REALTIME_KIND).subscribe(wanted, record)
  }

  watch(
    () => [scope(), keys().join(' ')].join(SCOPE_SEPARATOR),
    () => {
      resubscribe(scope(), keys())
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stop?.()
    stop = null
  })

  return { sampleCount, read: (nodeKey) => samples.value.get(nodeKey) }
}
