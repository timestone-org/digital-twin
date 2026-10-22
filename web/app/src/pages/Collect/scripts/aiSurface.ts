/** @fileoverview 采集页只读助手工作面，仅提供非秘密的配置与最近运行态。 */
import type { CollectSource } from '@dt/contracts'
import { UnsupportedTool, type AiSurface } from '@/features/ai/surfaces'

type SourceView = Pick<
  CollectSource,
  | 'id'
  | 'name'
  | 'code'
  | 'protocol'
  | 'read_mode'
  | 'is_enabled'
  | 'point_count'
  | 'runtime'
>

export function createCollectSurface(
  source: () => SourceView | null,
): AiSurface {
  return {
    kind: 'collect-source',
    label: '采集配置页',
    tools: [],
    snapshot: () => {
      const current = source()
      return current === null
        ? { selected_source: null }
        : {
            selected_source: {
              id: current.id,
              name: current.name,
              code: current.code,
              protocol: current.protocol,
              read_mode: current.read_mode,
              is_enabled: current.is_enabled,
              configured_points: current.point_count,
              runtime: {
                state: current.runtime.state,
                reported_points: current.runtime.point_count,
                error_category: current.runtime.error_category,
                updated_at: current.runtime.updated_at,
              },
            },
            note: '配置启用不等于现场在线。运行态是页面最近读取的上报，时间见updated_at；本工作面不执行设备写值或配置修改。',
          }
    },
    run: (call) => Promise.reject(new UnsupportedTool(call.name)),
  }
}
