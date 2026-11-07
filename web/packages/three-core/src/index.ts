// ⚠ 这个桶文件的第一行就静态依赖整个 three。启动期代码（app 的 main.ts /
// bootstrap/ / stores/）**禁止**从这里进——首屏 chunk 会被 three 撑破预算
// （闸门 check_bundle_budget.py）。注入接缝走深路径 `@dt/three-core/host`，
// 渲染组件由模块清单异步 import。守这条的用例在
// app/tests/contract/startup-graph.contract.spec.ts。
export { default as TwinScene } from './TwinScene.vue'
export { MAX_FRAME_S } from './frameClock'
export type { SceneLayerValues } from './sceneLayers'
export { loadTwinModel } from './modelLoader'
export type {
  GltfSource,
  TwinModelAsset,
  TwinModelLoadOptions,
} from './modelLoader'
export {
  WEBGL_UNAVAILABLE_MESSAGE,
  createSceneCore,
  createWebGLRenderer,
  disposeScene,
  disposeSceneGraph,
  frameObject,
  renderScene,
} from './sceneCore'
export type {
  SceneCore,
  SceneCoreOptions,
  SceneRenderer,
  SceneRendererFactory,
} from './sceneCore'
export { registerGlSnapshot } from './glCapture'
export type { GlSnapshotSource } from './glCapture'
export {
  configureTwinModelHost,
  resetTwinModelHost,
  resolveTwinModelUrl,
} from './host'
export type { TwinModelHost } from './host'
export { EditorScene } from './editorScene'
export type { GizmoChange, GizmoMode } from './transformGizmo'
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

export type { ModelAnimationEntry } from './animationCatalog'

export { default as TwinPanelPreview } from './TwinPanelPreview.vue'

export type { TwinPreviewAction } from './previewActions'
