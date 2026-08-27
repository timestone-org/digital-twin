/**
 * @fileoverview 契约：诊断这一支全仓只有一份，顶栏计数与右下角那张清单读的是同一支；
 * 它吃原始配置、认得预置样式库；装配那一层的缺口另走一支，不混进配置问题里。
 *
 * ⚠ 喂归一化结果进来不会报错，只是「被整条丢掉了什么」那一族恒为空，而面板照样报绿
 * ——最需要被说出来的那一族就此消失。头一条正是钉这件事的。
 * ⚠ 预置库里那些样式也要算「认识」：不认的话整张图的节点会被逐个报成悬空样式，
 * 真正那几条问题淹没在几十行噪音里。
 * ⚠ 「素材解析没装配」是**装配**状态，诊断跑在配置上一辈子看不见它：不单独问一次的
 * 表现是整张图的图标与底图一起消失，而配置一字没错、控制台一声不吭。
 */
import {
  __resetTwin2dAssets,
  configureTwin2dAssets,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import { afterEach, describe, expect, it } from 'vitest'

import {
  TWIN_2D_ASSETS_UNWIRED,
  twin2dScan,
  twin2dSetupIssues,
} from '@/pages/Twin2dEditor/scripts/twin2dIssues'

/** 一个没写 id 的节点会被归一化整条丢掉，只有原始 JSON 里查得到。 */
const RAW = {
  canvas: { width: 400, height: 200 },
  nodes: [
    { id: 'n1', styleId: 'heat-exchanger', x: 10, y: 10 },
    { styleId: 'heat-exchanger', x: 40, y: 40 },
  ],
}

/** 这一份配置里各出现了哪些问题码。 */
function codesOf(config: unknown): string[] {
  return twin2dScan(config).issues.map((issue) => issue.code)
}

afterEach(() => {
  __resetTwin2dAssets()
})

describe('诊断吃的是原始那一份', () => {
  it('被归一化整条丢掉的节点查得出来', () => {
    expect(codesOf(RAW)).toContain('dropped-node')
  })

  // ⚠ 这一条一红就说明有人把归一化结果递进来了：那一族随即整族消失，而面板报绿
  it('递归一化结果进来的话，那一族一条都不剩', () => {
    expect(codesOf(normalizeTwin2dConfig(RAW))).not.toContain('dropped-node')
  })

  it('预置库里的样式算「认识」，不报成悬空', () => {
    expect(codesOf(RAW)).not.toContain('dangling-style')
  })

  it('预置库里也没有的样式才报悬空', () => {
    expect(codesOf({ nodes: [{ id: 'n1', styleId: 'nope' }] })).toContain(
      'dangling-style',
    )
  })

  it('归一化结果一并交出来，跳转时按它核对下标', () => {
    expect(twin2dScan(RAW).live.nodes.map((node) => node.id)).toEqual(['n1'])
  })
})

describe('装配那一层的缺口', () => {
  it('两条解析都装上了就一条都不报', () => {
    configureTwin2dAssets({ resolveIcon: () => '', resolveImage: () => '' })

    expect(twin2dSetupIssues()).toEqual([])
  })

  it('没装配时点名，而不是让图标与底图悄悄消失', () => {
    expect(twin2dSetupIssues()).toEqual([TWIN_2D_ASSETS_UNWIRED])
  })

  // ⚠ 装配缺口不许混进配置问题里：混了之后「这张图配错了」与「这一页没装好」
  // 就再也分不开，而两者的查法完全不同
  it('不混进配置问题里', () => {
    expect(codesOf(RAW)).not.toContain(TWIN_2D_ASSETS_UNWIRED)
  })
})
