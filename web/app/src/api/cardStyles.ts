/**
 * @fileoverview 卡片样式库：列、建、改、删。样式是**全站共享的资产**，读走
 * `dashboard:view`、写走 `dashboard:manage`，与整屏模板同级。
 */
import type { CardChrome, CardStyle, Page } from '@dt/contracts'

import { request, requestData } from './client'
import type { CardStyleWire } from './cardStylesWire'
import { toCardStyle } from './cardStylesWire'
import { idempotent, onPlatform } from './dashboard'
import { newIdempotencyKey } from './idempotency'

const URL = '/card-styles'

/**
 * 样式不存在（领域段续号）。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。
 */
export const CARD_STYLE_NOT_FOUND_CODE = 41016

export interface CardStyleListQuery {
  /** 只要绑这个模块类型的；不给则连通用外壳样式一起列。 */
  moduleType?: string | undefined
  page?: number | undefined
  size?: number | undefined
}

export interface CardStyleInput {
  name: string
  description?: string | undefined
  /** 留空 = 通用外壳样式，此时 `config` 必须为空。 */
  moduleType?: string | null | undefined
  chrome: CardChrome
  config?: Record<string, unknown> | undefined
  thumbnail?: string | null | undefined
}

/** 入参的线形。⚠ 逐字段写，不 `as`：多一个键服务端会 400，少一个键会静默走缺省。 */
function toBody(input: CardStyleInput): Record<string, unknown> {
  return {
    name: input.name,
    description: input.description ?? null,
    module_type: input.moduleType ?? null,
    chrome_json: input.chrome,
    config_json: input.config ?? {},
    thumbnail: input.thumbnail ?? null,
  }
}

/**
 * 列样式。
 * @param query 筛选与分页
 * @param signal 竞态防护用；连点左栏时慢的那次后返回会覆盖快的那次
 */
export async function listCardStyles(
  query: CardStyleListQuery = {},
  signal?: AbortSignal,
): Promise<Page<CardStyle>> {
  const page = await requestData<Page<CardStyleWire>>(
    URL,
    onPlatform({
      query: {
        module_type: query.moduleType,
        page: query.page,
        size: query.size,
      },
      signal,
    }),
  )
  return { ...page, items: page.items.map(toCardStyle) }
}

export async function getCardStyle(styleId: string): Promise<CardStyle> {
  return toCardStyle(
    await requestData<CardStyleWire>(`${URL}/${styleId}`, onPlatform()),
  )
}

/**
 * 存一条新样式。
 * @param input 样式取值
 * @param key 幂等键；网络抖动导致的重试不该存出第二条同名样式
 */
export async function createCardStyle(
  input: CardStyleInput,
  key: string = newIdempotencyKey(),
): Promise<CardStyle> {
  return toCardStyle(
    await requestData<CardStyleWire>(
      URL,
      onPlatform({
        method: 'POST',
        body: toBody(input),
        headers: idempotent(key),
      }),
    ),
  )
}

/**
 * 改一条样式。整条替换，不是逐键打补丁——样式的语义就是「一整套取值」。
 * @param styleId 样式 id
 * @param input 新的样式取值
 */
export async function updateCardStyle(
  styleId: string,
  input: CardStyleInput,
): Promise<CardStyle> {
  return toCardStyle(
    await requestData<CardStyleWire>(
      `${URL}/${styleId}`,
      onPlatform({ method: 'PATCH', body: toBody(input) }),
    ),
  )
}

export async function deleteCardStyle(styleId: string): Promise<void> {
  await request<null>(`${URL}/${styleId}`, onPlatform({ method: 'DELETE' }))
}
