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
 * 样式不存在。
 * ⚠ 按码分支，不按 message：文案会改、会翻译。
 */
export const CARD_STYLE_NOT_FOUND_CODE = 41021

/** 样式的取值与模块清单对不上：类型没注册，或写了清单外的键。 */
export const CARD_STYLE_INVALID_CODE = 41022

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

/**
 * 建一条时的线形。
 * ⚠ 逐字段写，不 `as`：多一个键服务端整条 400（入参是 `extra="forbid"`），
 * 少一个键则静默走缺省。
 */
function toCreateBody(input: CardStyleInput): Record<string, unknown> {
  return {
    ...toUpdateBody(input),
    module_type: input.moduleType ?? null,
  }
}

/**
 * 改一条时的线形。
 * ⚠ **不带 `module_type`**：改的入参根本不收它（换了类型整段内芯当场作废，
 * 而库里那袋值不会跟着消失），多带一个键会让整条 PATCH 400。要换归属得复制一条。
 * ⚠ 缩略图只在**给了**的时候才写：PATCH 里显式的 `null` 是「清空」，
 * 每次保存都捎上一个 null，等于每存一次就把缩略图抹一次。
 */
function toUpdateBody(input: CardStyleInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.name,
    description: input.description ?? null,
    chrome_json: input.chrome,
    config_json: input.config ?? {},
  }
  if (input.thumbnail !== undefined) body.thumbnail = input.thumbnail
  return body
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
        body: toCreateBody(input),
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
      onPlatform({ method: 'PATCH', body: toUpdateBody(input) }),
    ),
  )
}

export async function deleteCardStyle(styleId: string): Promise<void> {
  await request<null>(`${URL}/${styleId}`, onPlatform({ method: 'DELETE' }))
}
