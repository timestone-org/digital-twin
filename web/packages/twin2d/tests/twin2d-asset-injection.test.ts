/**
 * @fileoverview 契约：素材注入槽收**两个**函数，图元图标与画布底图各走各的 kind；
 * 未注入时两条都回空串，两处落点随即整枝不画，而不是拿一条必然 404 的地址去画。
 *
 * ⚠ 一个函数服务两种 kind 时，装错的表现是**图标 404**（碎图或空白），零报错——
 * 图还在、连线还在、底图还在，只有那几枚图标不见了。两种 kind 各一条用例正是为了
 * 让这一步在装配处就红（docs/MODULE_TWIN_2D_DESIGN.md §11.4）。
 * ⚠ 「未注入」是**装配**状态，诊断面看不见它：诊断跑在配置上，问的是「这份配置里
 * 有没有指空的引用」。所以未注入这一档只断言「空」，而「图标为什么没了」由诊断面
 * 覆盖的那一半（内置图标集里没有这枚 sprite）单独一条钉住。
 */
import { assetUrl } from '@dt/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import {
  __resetTwin2dAssets,
  configureTwin2dAssets,
  twin2dAssetsConfigured,
  twin2dIconUrl,
  twin2dImageUrl,
} from '../src/assets'
import { canvasBackdropStyles } from '../src/canvasBackdrop'
import { collectTwin2dIssues } from '../src/issues'
import { normalizeCanvas } from '../src/normalize'
import { resolveIcoSrc } from '../src/paintText'

/** 取回前缀，与应用壳里那份 `ASSET_BASE_URL` 同形。 */
const BASE = '/oss/'
/** 一枚合法素材 id；`parseAssetRef` 只认这一种形状。 */
const ID = '0f9a2b3c-4d5e-4f70-8192-a3b4c5d6e7f8'
const REF = `asset:${ID}`

/** 照 `bootstrap/dashboard.ts` 那一份装上两条解析。 */
function install(): void {
  configureTwin2dAssets({
    resolveIcon: (ref) => assetUrl(BASE, 'icon', ref),
    resolveImage: (ref) => assetUrl(BASE, 'image', ref),
  })
}

/** 底图那一层的取值；这一层一条声明都不产时是空对象。 */
function backgroundOf(background: string): string {
  const canvas = normalizeCanvas({ background })
  return (
    canvasBackdropStyles(canvas, twin2dImageUrl).background['--t2-bg'] ?? ''
  )
}

afterEach(() => {
  __resetTwin2dAssets()
})

describe('两种 kind 各走各的', () => {
  it('图标那一条拼的是图标前缀', () => {
    install()

    expect(twin2dIconUrl(REF)).toBe(`${BASE}icons/${ID}`)
  })

  it('底图那一条拼的是图片前缀', () => {
    install()

    expect(twin2dImageUrl(REF)).toBe(`${BASE}images/${ID}`)
  })

  // ⚠ 两条拼出同一个地址就说明装成了一条服务两种 kind，而那一档的表现是图标 404
  it('同一个引用经两条解析出来的地址不一样', () => {
    install()

    expect(twin2dIconUrl(REF)).not.toBe(twin2dImageUrl(REF))
  })

  it('图元的 asset 档缺省走图标那一条', () => {
    install()

    expect(resolveIcoSrc({ kind: 'asset', ref: REF })).toEqual({
      kind: 'asset',
      url: `${BASE}icons/${ID}`,
    })
  })

  it('画布底图走的是图片那一条', () => {
    install()

    expect(backgroundOf(REF)).toContain(`url("${BASE}images/${ID}")`)
  })

  // ⚠ 引用形状不对时拼不出键：漏了这一步会得到一条谁也解释不了的 404
  it('引用形状不对时两条都回空串', () => {
    install()

    expect(twin2dIconUrl('asset:not-a-uuid')).toBe('')
    expect(twin2dImageUrl('/oss/plant.png')).toBe('')
  })
})

describe('未注入那一档', () => {
  it('两条都回空串，不凭空造一条必然 404 的地址', () => {
    expect(twin2dIconUrl(REF)).toBe('')
    expect(twin2dImageUrl(REF)).toBe('')
  })

  // ⚠ 空档而不是 `{kind:'asset', url:''}`：空 src 的 <img> 会让浏览器把当前页地址
  // 重新请求一遍，画面上还多一个碎图
  it('图元的 asset 档落成空档，不留一个空 src', () => {
    expect(resolveIcoSrc({ kind: 'asset', ref: REF })).toEqual({ kind: 'none' })
  })

  it('画布底图那一层一条声明都不产', () => {
    expect(backgroundOf(REF)).toBe('')
  })

  it('摘掉注入之后退回空串', () => {
    install()
    __resetTwin2dAssets()

    expect(twin2dIconUrl(REF)).toBe('')
    expect(twin2dImageUrl(REF)).toBe('')
  })

  // ⚠ 装配处据此说出口：只回空串而不让人问出「装没装」的话，整张图的图标与底图一起
  // 消失，而配置一字没错、控制台一声不吭
  it('「装没装」问得出来', () => {
    expect(twin2dAssetsConfigured()).toBe(false)

    install()

    expect(twin2dAssetsConfigured()).toBe(true)
  })

  it('摘掉之后又变回没装', () => {
    install()
    __resetTwin2dAssets()

    expect(twin2dAssetsConfigured()).toBe(false)
  })
})

describe('图标为什么没了要有人说', () => {
  // ⚠ 静默降级对人尚可忍受，对 Agent 是致命的：图标整枚消失而画面其余部分一切照常
  it('内置图标集里没有这枚 sprite 时诊断面点名', () => {
    const raw = {
      styles: [
        {
          id: 'st',
          prims: [
            { id: 'p1', kind: 'ico', src: { kind: 'sprite', id: 'ghost' } },
          ],
        },
      ],
    }

    const issues = collectTwin2dIssues(raw).filter(
      (issue) => issue.code === 'dangling-sprite',
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]?.at).toBe('styles[0].prims[0].src.id')
    expect(issues[0]?.message).toContain('图标会整个消失')
  })
})
