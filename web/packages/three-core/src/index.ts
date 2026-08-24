// ⚠ 这个桶文件的第一行就静态依赖整个 three。启动期代码（app 的 main.ts /
// bootstrap/ / stores/）**禁止**从这里进——首屏 chunk 会被 three 撑破预算
// （闸门 check_bundle_budget.py）。注入接缝走深路径 `@dt/three-core/host`，
// 渲染组件由模块清单异步 import。守这条的用例在
// app/tests/contract/startup-graph.contract.spec.ts。
export { default as TwinScene } from './TwinScene.vue'
export { default as TwinHierDrill } from './TwinHierDrill.vue'
export { AnchorLayer } from './anchorLayer'
export { ArrowLayer } from './arrowLayer'
export { FlowLayer } from './flowLayer'
export { PanelLayer } from './panelLayer'
export { SceneEffectsLayer } from './sceneEffects'
export { MAX_FRAME_S, createFrameClock } from './frameClock'
export type { FrameClock } from './frameClock'
export { SceneLayers } from './sceneLayers'
export type { SceneLayerValues } from './sceneLayers'
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
export type {
  GltfSource,
  TwinModelAsset,
  TwinModelLoadOptions,
} from './modelLoader'
export {
  WEBGL_UNAVAILABLE_MESSAGE,
  applyCameraPose,
  applyModelPlacement,
  boundingDiagonal,
  clampPixelRatio,
  createSceneCore,
  createWebGLRenderer,
  disposeScene,
  disposeSceneGraph,
  frameObject,
  horizontalSpanOf,
  modelFrameOrigin,
  renderScene,
  resizeScene,
} from './sceneCore'
export type {
  ModelFrame,
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
export { EditorScene } from './editorScene'
export { TransformGizmo } from './transformGizmo'
export type { GizmoChange, GizmoKind, GizmoMode } from './transformGizmo'
export type {
  EditorSceneCallbacks,
  EditorSceneOptions,
  EditorSceneStatus,
  TwinCameraPose,
  TwinPickMode,
} from './editorScene'
export type { TwinSceneEntityKind, TwinSceneSelection } from './pickTargets'
export { useRenderLoop } from './useRenderLoop'
export type { RenderLoop, RenderLoopOptions } from './useRenderLoop'
export { useRoamTour } from './useRoamTour'
export type { RoamTourController, RoamTourDeps } from './useRoamTour'
