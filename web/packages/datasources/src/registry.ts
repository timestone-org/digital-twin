/**
 * @fileoverview provider 注册表：加一种取数方式 = 加一个 provider + 一行注册，
 * 渲染层一行不用碰（docs/DASHBOARD_DESIGN.md §5.5）。
 * ⚠ 这里不许 import 任何具体 provider——注册表一旦认识实现，那条缝就焊死了。
 */
import type {
  BindingSourceKind,
  DataSourceProvider,
  ProviderRegistry,
} from '@dt/contracts'

import { DataSourceError } from './errors'

const providers = new Map<BindingSourceKind, DataSourceProvider>()

/**
 * 登记一个 provider；同一种来源重复登记，后者覆盖前者。
 * @param provider 实现
 */
export function registerProvider(provider: DataSourceProvider): void {
  providers.set(provider.kind, provider)
}

/**
 * 取一种来源的 provider。
 * ⚠ 没登记过一律抛：静默返回 undefined 会让调用方渲染成「绑了点位但永远
 * 没数据」，而求值层拿着这个错误就能给出 error 槽。
 * @param kind 来源种类
 */
export function getProvider(kind: BindingSourceKind): DataSourceProvider {
  const provider = providers.get(kind)
  if (provider === undefined) {
    throw new DataSourceError(
      'unknown-source-kind',
      `没有登记 ${kind} 来源的 provider`,
    )
  }
  return provider
}

/**
 * 这种来源登记过没有。
 * @param kind 来源种类
 */
export function hasProvider(kind: BindingSourceKind): boolean {
  return providers.has(kind)
}

/** 已登记的全部 provider，按登记先后；返回的是副本。 */
export function listProviders(): readonly DataSourceProvider[] {
  return [...providers.values()]
}

/** ⚠ 只给测试用：生产路径调用它等于把大屏的取数一次全摘掉。 */
export function __resetProviders(): void {
  providers.clear()
}

/**
 * contracts 口径的注册表面，供应用壳装配好后注入运行时。
 * ⚠ 它的 `get` 按契约在未登记时返回 undefined，调用方必须据此给出 error 槽；
 * 本包内部一律走会抛的 `getProvider`。
 */
export const providerRegistry: ProviderRegistry = {
  register: registerProvider,
  get: (kind) => providers.get(kind),
  reset: __resetProviders,
}
