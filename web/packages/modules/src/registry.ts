/**
 * @fileoverview 模块注册中心。`registerModule` 是**机制**——任何来源的清单都能在运行期
 * 注册进来；`registerBuiltins.ts` 里那条 `import.meta.glob` 只是它的第一个调用方，
 * 是便利不是入口。第三方模块因此不必住进本包的目录（DASHBOARD_DESIGN §5.3 陷阱 ①）。
 */
import type { ModuleManifest } from '@dt/contracts'

/** 注册期告警的接收端。 */
export type ModuleWarn = (message: string) => void

// ⚠ 不打 console：本仓 lint 禁 console，且「开发态才响」是按环境改**行为**，
// 而环境差异只能落在取值上——装不装这个槽由应用壳决定（config-and-secrets §4）
const DISCARD: ModuleWarn = () => undefined

const registry = new Map<string, ModuleManifest>()
let warn: ModuleWarn = DISCARD

/**
 * 装上注册期告警的接收端；不装即静默。
 * @param sink 收告警文本的函数
 */
export function setModuleWarn(sink: ModuleWarn): void {
  warn = sink
}

/**
 * 注册一个模块清单。**公开 API**：内置模块、应用壳、第三方清单走的是同一条路。
 * 同 type 重复注册按后来者生效（HMR 与热替换友好），只经告警槽提一句；
 * 同一个清单对象重复注册静默跳过。
 * @param manifest 任意来源的模块清单
 */
export function registerModule(manifest: ModuleManifest): void {
  const type = typeof manifest.type === 'string' ? manifest.type.trim() : ''
  if (type === '') {
    throw new Error('模块清单必须有 type')
  }
  const existing = registry.get(type)
  if (existing !== undefined && existing !== manifest) {
    warn(`模块类型 ${type} 被重复注册，后注册的清单生效`)
  }
  registry.set(type, manifest)
}

/**
 * 按类型取清单；没注册过返回 undefined。
 * @param type 模块类型 id
 */
export function getModule(type: string): ModuleManifest | undefined {
  return registry.get(type)
}

/** 全部已注册清单，顺序即注册先后。 */
export function listModules(): readonly ModuleManifest[] {
  return [...registry.values()]
}

/** 清空注册表与告警槽，供测试与组件展示隔离。 */
export function __resetModules(): void {
  registry.clear()
  warn = DISCARD
}

/**
 * 纯身份函数：只给对象字面量提供类型收窄，**零副作用**——注册永远是显式的一步，
 * 免得「import 了某个文件」变成一种隐式注册。
 * @param manifest 模块清单字面量
 */
export function defineModule(manifest: ModuleManifest): ModuleManifest {
  return manifest
}
