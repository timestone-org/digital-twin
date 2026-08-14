/**
 * @fileoverview 项目自定义主题的增删改查。一组主题整体存在项目行的 JSONB 数组里。
 *
 * ⚠ 删掉一套主题不联动改屏：引用它的大屏 resolve 时回退到项目默认或内置主题，
 * 不报错。界面上因此要在删除前说清「这几张屏会换回默认配色」。
 */
import type { ProjectThemeMode, ProjectThemePayload } from '@dt/contracts'

import { request, requestData } from './client'
import { idempotent, onPlatform } from './dashboard'
import type { ProjectThemeWire } from './projectThemesWire'
import { toProjectTheme } from './projectThemesWire'
import { newIdempotencyKey } from './idempotency'

/**
 * 主题不存在（领域 10）。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。
 */
export const THEME_NOT_FOUND_CODE = 41019

export interface ProjectThemeCreateInput {
  name: string
  mode: ProjectThemeMode
  /** 语义 token 取值，形状即 `@dt/tokens` 的 `ThemeTokens`。 */
  tokens: Record<string, unknown>
}

export interface ProjectThemePatchInput {
  name?: string | undefined
  mode?: ProjectThemeMode | undefined
  /** 整份替换，不做逐键合并。 */
  tokens?: Record<string, unknown> | undefined
}

export async function listProjectThemes(
  projectId: string,
): Promise<ProjectThemePayload[]> {
  const rows = await requestData<ProjectThemeWire[]>(
    `/dashboard-projects/${projectId}/themes`,
    onPlatform(),
  )
  return rows.map(toProjectTheme)
}

/**
 * 新建一套主题。
 * @param projectId 项目 id
 * @param input 主题名、明暗档与 token 取值
 * @param key 幂等键
 */
export async function createProjectTheme(
  projectId: string,
  input: ProjectThemeCreateInput,
  key: string = newIdempotencyKey(),
): Promise<ProjectThemePayload> {
  const wire = await requestData<ProjectThemeWire>(
    `/dashboard-projects/${projectId}/themes`,
    onPlatform({
      method: 'POST',
      body: { name: input.name, mode: input.mode, tokens: input.tokens },
      headers: idempotent(key),
    }),
  )
  return toProjectTheme(wire)
}

/**
 * 改一套主题，只发给了的那几项。
 * @param projectId 项目 id
 * @param themeId 主题 id
 * @param patch 要改的字段
 * @param key 幂等键
 */
export async function updateProjectTheme(
  projectId: string,
  themeId: string,
  patch: ProjectThemePatchInput,
  key: string = newIdempotencyKey(),
): Promise<ProjectThemePayload> {
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.mode !== undefined) body.mode = patch.mode
  if (patch.tokens !== undefined) body.tokens = patch.tokens
  const wire = await requestData<ProjectThemeWire>(
    `/dashboard-projects/${projectId}/themes/${themeId}`,
    onPlatform({ method: 'PATCH', body, headers: idempotent(key) }),
  )
  return toProjectTheme(wire)
}

export async function deleteProjectTheme(
  projectId: string,
  themeId: string,
): Promise<void> {
  await request<null>(
    `/dashboard-projects/${projectId}/themes/${themeId}`,
    onPlatform({ method: 'DELETE' }),
  )
}
