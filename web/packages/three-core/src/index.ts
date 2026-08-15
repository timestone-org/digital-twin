// ⚠ 这个桶文件的第一行就静态依赖整个 three。启动期代码（app 的 main.ts /
// bootstrap/ / stores/）**禁止**从这里进——首屏 chunk 会被 three 撑破预算
// （闸门 check_bundle_budget.py）。注入接缝走深路径 `@dt/three-core/host`，
// 渲染组件由模块清单异步 import。守这条的用例在
// app/tests/contract/startup-graph.contract.spec.ts。
export { default as TwinScene } from './TwinScene.vue'
export { AnchorLayer } from './anchorLayer'
export {
  EMPTY_NODE_INDEX,
  applyPartVisibility,
  buildNodeIndex,
  meshesOfNames,
  objectsOfNames,
  unmatchedNodeNames,
} from './nodeIndex'
export type { NodeIndex } from './nodeIndex'
export { createGltfSource, loadTwinModel } from './modelLoader'
export type { GltfSource, TwinModelLoadOptions } from './modelLoader'
export {
  WEBGL_UNAVAILABLE_MESSAGE,
  applyModelPlacement,
  boundingDiagonal,
  clampPixelRatio,
  createSceneCore,
  createWebGLRenderer,
  disposeScene,
  disposeSceneGraph,
  frameObject,
  renderScene,
  resizeScene,
} from './sceneCore'
export type {
  ModelPlacement,
  SceneCore,
  SceneCoreOptions,
  SceneRenderer,
  SceneRendererFactory,
} from './sceneCore'
export { ACCENT_COLOR_TOKEN, resolveColorSpec } from './themeColor'
export {
  configureTwinModelHost,
  resetTwinModelHost,
  resolveTwinModelUrl,
} from './host'
export type { TwinModelHost } from './host'
