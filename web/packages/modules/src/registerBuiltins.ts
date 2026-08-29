/// <reference types="vite/client" />
/**
 * @fileoverview 内置模块的自动发现：扫 `modules/<type>/manifest.ts` 逐个交给
 * `registerModule`。新增一个内置模块 = 建一个目录，本文件不用动。
 * ⚠ glob 只是便利，注册的机制是 `registerModule`（registry.ts 文件头）。
 *
 * ⚠ 卡片部件**不走 glob**：它们的顺序就是「加部件」菜单的顺序，而 glob 的顺序是
 * 文件名排出来的。清单在 `modules/data-card/parts/index.ts` 里显式写着。
 */
import type { ModuleManifest } from '@dt/contracts'

import { registerBuiltinCardParts } from './modules/data-card/parts'
import { registerModule } from './registry'

interface ManifestModule {
  default?: ModuleManifest
}

const BUILTINS = import.meta.glob<ManifestModule>('./modules/*/manifest.ts', {
  eager: true,
})

/**
 * 注册全部内置模块，按路径排序保证注册顺序确定。
 * ⚠ 目录在、默认导出不在一律抛：内置模块漏写 `export default` 时静默跳过的话，
 * 表现是「这个模块从模块库里消失了」，而没有任何一处报错。
 * @param source 仅测试注入；缺省是 glob 的真实结果
 */
export function registerBuiltinModules(
  source: Record<string, ManifestModule> = BUILTINS,
): void {
  for (const path of Object.keys(source).sort()) {
    const manifest = source[path]?.default
    if (manifest === undefined) {
      throw new Error(`内置模块 ${path} 没有默认导出的清单`)
    }
    registerModule(manifest)
  }
  // ⚠ 与模块同一趟装：漏了这一步，卡片上每一个部件都画成「没有这种部件」的占位
  registerBuiltinCardParts()
}
