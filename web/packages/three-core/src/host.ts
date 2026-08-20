/**
 * @fileoverview 宿主注入接缝：素材引用 `asset:<uuid>` → 可 fetch 的模型 URL。
 * ⚠ 本文件不许出现 three 的静态依赖——启动期代码只从这条深路径进来，
 * 走桶文件会把整个 three 拖进首屏 chunk（DASHBOARD_DESIGN §5.4）。
 */
import type { ModelVariant } from '@dt/contracts'

/**
 * 模型地址解析能力，由应用壳在启动期注入。
 * ⚠ 档位是**参数**不是引用的一部分：`asset:<uuid>` 的语法在服务端、前端与删除时
 * 的反查里各有一份实现，把档位塞进串里要同时改三处（ADR-0022）。
 */
export interface TwinModelHost {
  /** 素材引用 + 档位 → 可 fetch 的 URL；解析不出返回空串。 */
  resolveModelUrl(assetRef: string, variant: ModelVariant): string
}

// ⚠ 默认桩不臆造后端前缀：没注入宿主时要在界面上看得见「取不到」，而不是拿到一个必然 404 的地址
const NOT_CONFIGURED: TwinModelHost = { resolveModelUrl: () => '' }

let host: TwinModelHost = NOT_CONFIGURED

/**
 * 注入真实实现。
 * @param impl 应用壳侧的地址解析
 */
export function configureTwinModelHost(impl: TwinModelHost): void {
  host = impl
}

/** 复位到默认桩，供测试与组件展示隔离。 */
export function resetTwinModelHost(): void {
  host = NOT_CONFIGURED
}

/**
 * 解析模型地址；空引用与解析失败都返回空串。
 * @param assetRef `TwinModelRef.asset`，空串表示还没挑模型
 * @param variant 压缩档；不给按原件
 */
export function resolveTwinModelUrl(
  assetRef: string,
  variant: ModelVariant = 'original',
): string {
  const ref = assetRef.trim()
  return ref === '' ? '' : host.resolveModelUrl(ref, variant).trim()
}
