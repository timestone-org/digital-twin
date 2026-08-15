/**
 * @fileoverview 锁死模块清单两侧一致：服务端的 `module_types.json` 必须逐字等于
 * 本仓清单的序列化结果。⚠ 这一份漂了不会有任何报错——服务端按过期目录校验
 * `field_key`，新绑定被拒；Agent 按过期目录生成配置，前端渲染成空白（ADR-0012 五）。
 *
 * 目录变了就重新生成：`pnpm vitest run packages/modules/tests/catalog.contract.spec.ts -u`
 */
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildModuleCatalog } from '../src/catalog'
import { registerBuiltinModules } from '../src/registerBuiltins'
import { __resetModules, listModules } from '../src/registry'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const CATALOG_FILE = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'platform-server',
  'src',
  'platform_server',
  'apps',
  'dashboard',
  'module_types.json',
)

function serialized(): string {
  return `${JSON.stringify(buildModuleCatalog(listModules()), null, 2)}\n`
}

beforeAll(() => {
  __resetModules()
  registerBuiltinModules()
})

describe('模块清单的两侧一致', () => {
  // 整份逐字比对：模块增删、配置键改名、绑定槽改形状全都落在这一条上
  it('服务端目录就是本仓清单的序列化结果', async () => {
    await expect(serialized()).toMatchFileSnapshot(CATALOG_FILE)
  })
})
