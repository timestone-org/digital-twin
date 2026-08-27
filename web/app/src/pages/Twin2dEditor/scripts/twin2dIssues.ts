/**
 * @fileoverview 2D 孪生编辑器这一路的诊断入口：一份配置进，归一化结果与逐条问题出。
 * 顶栏那个计数与右下角那张清单读的是**同一支**——各调各的话，两处迟早对同一份配置
 * 报出两个数，而先信哪一个全靠猜。
 *
 * ⚠ 递进来的最好是**原始** config（`configJson.twin2d` 那一段原样）：「归一化整条
 * 丢掉了什么」那一族（`dropped-*` / `prim-too-deep` / `dangling-sprite`）只有拿原始
 * JSON 才查得到，喂归一化结果进来那一族恒为空，而面板照样报绿。
 * ⚠ 预置样式库也要算「认识」：不递进去的话整张图的节点会被逐个报成悬空样式，
 * 真正那几条问题就此淹没在几十行噪音里（docs/MODULE_TWIN_2D_DESIGN.md §13.4）。
 */
import {
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
  collectTwin2dIssues,
  normalizeTwin2dConfig,
  twin2dAssetsConfigured,
  twin2dStyleResolver,
} from '@dt/twin2d'
import type { Twin2dConfig, Twin2dIssue } from '@dt/twin2d'

/** 一次诊断的产出。 */
export interface Twin2dScan {
  /** 归一化之后的那一份；核对下标与解析样式引用都用它。 */
  live: Twin2dConfig
  /** 逐条问题，文档序。 */
  issues: readonly Twin2dIssue[]
}

/** 素材解析没装配时说的那一句。 */
export const TWIN_2D_ASSETS_UNWIRED =
  '素材解析还没装配：这张图上的自带图标与画布底图都取不回来。'

/**
 * 诊断一份配置。
 * @param config 这块 2D 孪生的配置，原始那一份最好
 */
export function twin2dScan(config: unknown): Twin2dScan {
  const live = normalizeTwin2dConfig(config)
  return {
    live,
    issues: collectTwin2dIssues(config, {
      knownStyleIds: new Set(TWIN_2D_BUILTIN_NODE_STYLE_MAP.keys()),
      styleOf: twin2dStyleResolver(live),
    }),
  }
}

/**
 * 装配这一层的缺口，一条一句；空表 = 装配齐了。
 * ⚠ 与 `twin2dScan` 分开：诊断跑在配置上，问的是「这份配置里有没有指空的引用」，
 * 而「装配做没做」是另一回事——不在这里问一次，素材没接上的表现就只是「图标少了
 * 几枚」，配置一字没错、控制台一声不吭。
 */
export function twin2dSetupIssues(): readonly string[] {
  return twin2dAssetsConfigured() ? [] : [TWIN_2D_ASSETS_UNWIRED]
}
