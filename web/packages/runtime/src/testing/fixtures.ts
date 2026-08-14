/**
 * @fileoverview 假清单 / 假节点 / 假绑定：用例用它装出一棵能渲染的节点树，
 * 免得每份用例各摊一遍后端载荷的十几个字段。
 * ⚠ 测试设施，不进产物——生产代码引用它由结构闸拦下。
 */
import type {
  BindingPayload,
  DashboardNodePayload,
  ModuleManifest,
  ModuleMeta,
} from '@dt/contracts'
import { defineComponent, h, type Component, type PropType } from 'vue'

import type { GetModuleManifest } from '../nodeTree'

/** 载荷里的时间戳，用例不关心它的取值。 */
const STAMP = '2026-08-14T00:00:00Z'

export interface FakeModuleOptions {
  /** 渲染出来的类名，用例据此找到这一格。 */
  mark: string
  /** 渲染默认插槽——容器壳靠它接子节点。 */
  hasSlot?: boolean
  /** setup 里抛一个带这段消息的异常；空串也是合法消息。 */
  throws?: string
}

/**
 * 一个把收到的三件套摊到 data 属性上的假模块，用例据此断言装配结果。
 * @param options 类名、要不要插槽、要不要抛异常
 */
export function fakeModuleComponent(options: FakeModuleOptions): Component {
  return defineComponent({
    name: 'FakeModule',
    props: {
      config: {
        type: Object as PropType<Record<string, unknown>>,
        required: true,
      },
      values: {
        type: Object as PropType<Record<string, unknown>>,
        required: true,
      },
      meta: { type: Object as PropType<ModuleMeta>, required: false },
    },
    setup(props, { slots }) {
      if (options.throws !== undefined) throw new Error(options.throws)
      return () =>
        h(
          'div',
          {
            class: options.mark,
            'data-config': JSON.stringify(props.config),
            'data-values': JSON.stringify(props.values),
            'data-meta': JSON.stringify(props.meta ?? null),
          },
          options.hasSlot === true ? slots.default?.() : undefined,
        )
    },
  })
}

/**
 * 把一个组件包成清单要求的异步模块。
 * ⚠ 刻意不带 `Symbol.toStringTag: 'Module'`：这正是第三方不走 `import()` 时交出来的
 * 形状，装配点必须自己剥 `default` 才渲染得出来（ModuleRenderer.vue）。
 * @param component 要异步交付的组件
 */
export function asAsyncModule(
  component: Component,
): Promise<{ default: Component }> {
  return Promise.resolve({ default: component })
}

/**
 * 一份最小可用的模块清单。
 * @param overrides 至少给 `type`，其余按需覆盖
 */
export function fakeManifest(
  overrides: Partial<ModuleManifest> & Pick<ModuleManifest, 'type'>,
): ModuleManifest {
  return {
    displayName: overrides.type,
    category: '测试',
    defaultSize: { width: 200, height: 100 },
    configSchema: [],
    bindings: [],
    component: () =>
      asAsyncModule(fakeModuleComponent({ mark: 'fake-module' })),
    ...overrides,
  }
}

/**
 * 按类型索引一批清单，做成注入式解析器。
 * @param manifests 参与本次用例的全部清单
 */
export function fakeCatalog(
  manifests: readonly ModuleManifest[],
): GetModuleManifest {
  const byType = new Map(manifests.map((manifest) => [manifest.type, manifest]))
  return (moduleType) => byType.get(moduleType)
}

/**
 * 一个画布节点。
 * @param overrides 至少给 `id` 与 `moduleType`
 */
export function fakeNode(
  overrides: Partial<DashboardNodePayload> &
    Pick<DashboardNodePayload, 'id' | 'moduleType'>,
): DashboardNodePayload {
  return {
    dashboardId: 'dashboard-1',
    parentId: null,
    clientKey: null,
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    zIndex: 1,
    isVisible: true,
    configJson: {},
    createdAt: STAMP,
    updatedAt: STAMP,
    bindings: [],
    ...overrides,
  }
}

/**
 * 一条绑定。
 * @param overrides 至少给 `id`、`fieldKey` 与 `sourceKind`
 */
export function fakeBinding(
  overrides: Partial<BindingPayload> &
    Pick<BindingPayload, 'id' | 'fieldKey' | 'sourceKind'>,
): BindingPayload {
  return {
    nodeId: 'node-1',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  }
}
