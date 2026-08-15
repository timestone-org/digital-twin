/**
 * @fileoverview twin-view —— 数字孪生查看器。一期最复杂的模块：带 3D 重资源与数组绑定。
 * 绑定槽直接摊开 `TWIN_VIEW_BINDINGS`，不在这里抄一份键名——槽键写两遍时，
 * 拼错的那一份既不报错也永远取不到值（twin-config/constants.ts）。
 */
import { TWIN_CONFIG_KEY, TWIN_VIEW_BINDINGS } from '@dt/twin-config'

import { defineModule } from '../../registry'

export default defineModule({
  type: 'twin-view',
  displayName: '数字孪生',
  category: '孪生',
  icon: 'building',
  keywords: ['twin', 'luansheng', '孪生', '三维', '3d', '模型'],
  // 3D 画布自己就是整块内容，套一层卡片框只会在四周切掉一圈可视范围
  chrome: 'bare',
  defaultSize: { width: 1280, height: 720, minWidth: 320, minHeight: 240 },
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      group: '标题',
      // ⚠ 刻意不给 default：default 会 materialize 进每一次渲染，改它等于改存量
      //   大屏的渲染结果。缺省即空串 = 画布上不叠标题
      span: 'full',
      placeholder: '留空则画布上不叠标题',
    },
    {
      key: 'titlePosition',
      label: '标题位置',
      type: 'enum',
      group: '标题',
      // 缺省这一档等于组件里的兜底位置，materialize 进存量渲染是同一个结果
      default: 'top-left',
      span: 'half',
      options: [
        { value: 'top-left', label: '左上' },
        { value: 'top-right', label: '右上' },
        { value: 'bottom-left', label: '左下' },
        { value: 'bottom-right', label: '右下' },
      ],
    },
    {
      key: 'titleFontSize',
      label: '标题字号 (px)',
      type: 'range',
      group: '标题',
      default: 16,
      min: 8,
      max: 72,
      step: 1,
      span: 'half',
    },
    {
      key: TWIN_CONFIG_KEY,
      label: '孪生场景',
      type: 'object',
      group: '模型',
      // ⚠ 刻意不给 fields：TwinConfig 里有 Vec3 这种两列通用表单表达不了的形状。
      //   属性面板对「object 且无 fields」的字段渲染成只读摘要 + 子编辑器入口，
      //   绝不许静默画成空白
      help: '模型、部件与锚点，整块由孪生子编辑器写入。',
    },
  ],
  bindings: [...TWIN_VIEW_BINDINGS],
  // 刻意不给 preview：3D 演示要有模型素材才看得见，编造一份只会在画布上留一块空白
  component: () => import('./Component.vue'),
})
