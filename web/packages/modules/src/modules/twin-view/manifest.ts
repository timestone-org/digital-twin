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
      group: '数字孪生',
      // ⚠ 刻意不给 default：default 会 materialize 进每一次渲染，改它等于改存量
      //   大屏的渲染结果。缺省即空串 = 画布上不叠标题
      span: 'full',
      placeholder: '留空则画布上不叠标题',
    },
    {
      key: 'showAlarmSummary',
      label: '告警汇总',
      type: 'boolean',
      group: '数字孪生',
      // ⚠ 同样刻意不给 default。缺省即 false = 不显示
      span: 'half',
      help: '在画布右上角列出当前处于告警态的状态染色规则。',
    },
    {
      key: TWIN_CONFIG_KEY,
      label: '孪生场景',
      type: 'object',
      group: '数字孪生',
      // ⚠ 刻意不给 fields：TwinConfig 里有 Vec3 与 Record<string, string> 两种形状，
      //   两列通用表单表达不了。属性面板对「object 且无 fields」的字段渲染成
      //   只读摘要 + 子编辑器入口，绝不许静默画成空白
      help: '模型、部件、锚点与状态染色，整块由孪生子编辑器写入。',
    },
  ],
  bindings: [...TWIN_VIEW_BINDINGS],
  // 刻意不给 preview：3D 演示要有模型素材才看得见，编造一份只会在画布上留一块空白
  component: () => import('./Component.vue'),
})
