/**
 * @fileoverview 运行参数：按 section 读有效值、整组写覆盖值、整组恢复默认。
 *
 * ⚠ 「恢复默认」是删掉覆盖行而不是写回一份默认值：环境变量是永久默认值，
 * 抄一份进库之后运维改 .env 就再也不生效了。
 */
import type { RuntimeParamItem, RuntimeParamSection } from '@dt/contracts'

import { requestData } from './client'
import { onPlatform } from './dashboard'
import type { RuntimeParamItemWire } from './runtimeParamsWire'
import { toRuntimeParamItem } from './runtimeParamsWire'

/**
 * 提交了目录里没有的键（领域 10），HTTP 400。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。
 */
export const RUNTIME_PARAM_UNKNOWN_CODE = 41020

/**
 * 分组落在哪条路由上。
 * ⚠ 两条路由不是冗余：写权限码不同（dashboard:edit vs collect:manage），
 * 后端按码把分组拆开了，发错前缀就是 400。
 * @param section 参数分组
 */
function baseOf(section: RuntimeParamSection): string {
  return section === 'dashboard' ? '/runtime-params' : '/collect-runtime-params'
}

/** 读一组运行参数的当前有效值。 */
export async function listRuntimeParams(
  section: RuntimeParamSection,
): Promise<RuntimeParamItem[]> {
  const rows = await requestData<RuntimeParamItemWire[]>(
    baseOf(section),
    onPlatform({ query: { section } }),
  )
  return rows.map(toRuntimeParamItem)
}

/**
 * 写一组覆盖值，出参是写入后的全量状态。
 * @param section 参数分组
 * @param values 键名到覆盖值；只提交要改的项，没提交的不动
 */
export async function saveRuntimeParams(
  section: RuntimeParamSection,
  values: Record<string, unknown>,
): Promise<RuntimeParamItem[]> {
  const rows = await requestData<RuntimeParamItemWire[]>(
    `${baseOf(section)}/${section}`,
    onPlatform({ method: 'PUT', body: { values } }),
  )
  return rows.map(toRuntimeParamItem)
}

/** 把一组参数整体恢复默认，此后它们重新跟随环境变量。 */
export async function resetRuntimeParams(
  section: RuntimeParamSection,
): Promise<RuntimeParamItem[]> {
  const rows = await requestData<RuntimeParamItemWire[]>(
    `${baseOf(section)}/${section}:reset`,
    onPlatform({ method: 'POST' }),
  )
  return rows.map(toRuntimeParamItem)
}
