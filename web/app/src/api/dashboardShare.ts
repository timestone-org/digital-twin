/**
 * @fileoverview 大屏的发布态读取、发布、取消发布，以及按公开令牌匿名读一张屏。
 *
 * ⚠ 每次发布都换一个新令牌，旧链接当场失效：界面上展示的令牌只能来自这一次
 * 发布的出参，缓存一个旧的会把已经撤回的链接继续发出去。
 */
import type {
  DashboardPublication,
  PublicDashboardPayload,
} from '@dt/contracts'

import { requestData } from './client'
import { idempotent, onPlatform } from './dashboard'
import type {
  DashboardPublicationWire,
  PublicDashboardWire,
} from './dashboardShareWire'
import { toPublication, toPublicDashboard } from './dashboardShareWire'
import { newIdempotencyKey } from './idempotency'

/**
 * 令牌查不到（领域 10）。撤回过的与从来没有的都是这一个码，不区分。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。
 */
export const DASHBOARD_NOT_PUBLISHED_CODE = 41016

/**
 * 读一张屏此刻的发布态与公开令牌。
 * ⚠ 令牌只有这一条读面：大屏详情不带它。要展示「当前那条链接」时必须走这里，
 * 拿再发布一次去顶替的话，已经发出去的链接会当场作废。
 * @param dashboardId 大屏 id
 * @param signal 取消信号
 */
export async function getDashboardPublication(
  dashboardId: string,
  signal?: AbortSignal,
): Promise<DashboardPublication> {
  const wire = await requestData<DashboardPublicationWire>(
    `/dashboards/${dashboardId}/publication`,
    onPlatform(signal === undefined ? {} : { signal }),
  )
  return toPublication(wire)
}

/**
 * 发布一张屏，拿到新的公开令牌。
 * @param dashboardId 大屏 id
 * @param key 幂等键
 */
export async function publishDashboard(
  dashboardId: string,
  key: string = newIdempotencyKey(),
): Promise<DashboardPublication> {
  const wire = await requestData<DashboardPublicationWire>(
    `/dashboards/${dashboardId}:publish`,
    onPlatform({ method: 'POST', headers: idempotent(key) }),
  )
  return toPublication(wire)
}

/**
 * 撤回发布，令牌置空。
 * @param dashboardId 大屏 id
 * @param key 幂等键
 */
export async function unpublishDashboard(
  dashboardId: string,
  key: string = newIdempotencyKey(),
): Promise<DashboardPublication> {
  const wire = await requestData<DashboardPublicationWire>(
    `/dashboards/${dashboardId}:unpublish`,
    onPlatform({ method: 'POST', headers: idempotent(key) }),
  )
  return toPublication(wire)
}

/**
 * 按公开令牌读一张屏。
 * ⚠ 必须匿名发：带上过期的 access token 会先撞 401 再走刷新，而这条路径本就
 * 允许没登录，刷新失败还会把当前会话踢下线。
 * @param publicToken 公开令牌
 * @param signal 取消信号
 */
export async function getPublicDashboard(
  publicToken: string,
  signal?: AbortSignal,
): Promise<PublicDashboardPayload> {
  const wire = await requestData<PublicDashboardWire>(
    `/public-dashboards/${publicToken}`,
    onPlatform(
      signal === undefined ? { anonymous: true } : { anonymous: true, signal },
    ),
  )
  return toPublicDashboard(wire)
}
