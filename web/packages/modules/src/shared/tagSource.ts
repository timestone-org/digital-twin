/**
 * @fileoverview 实时点位读数的注入槽。少数模块（如孪生）要按 node_key 直读整批读数
 * 而不是只拿自己绑好的那几个槽，真源由应用壳启动时注入，本包只留这个口子。
 */
import type { PointSample } from '@dt/contracts'

/** 按 node_key 索引的一批读数。 */
export type PointSampleMap = ReadonlyMap<string, PointSample>

const EMPTY: PointSampleMap = new Map()

let source: () => PointSampleMap = () => EMPTY

/**
 * 装上真实的读数源，通常是应用壳里那个响应式 Map 的 getter。
 * @param getter 每次读都会被调用的取值函数
 */
export function configureTagSource(getter: () => PointSampleMap): void {
  source = getter
}

/** 摘掉读数源，退回空 Map。⚠ 只给测试与组件展示用，生产路径调它等于把实时值全断掉。 */
export function __resetTagSource(): void {
  source = () => EMPTY
}

/**
 * 读当前这一批读数；没装源时是空 Map，取不到就是取不到，不伪造读数。
 * ⚠ 每次都重新调 getter、不缓存：在 `computed` / `watchEffect` 里调用才能让
 * 注入的响应式源被追踪到，缓存一次就等于此后再也不更新。
 */
export function readTagSnapshots(): PointSampleMap {
  return source()
}
