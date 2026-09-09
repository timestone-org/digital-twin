/**
 * @fileoverview twin-view —— 数字孪生查看器。一期最复杂的模块：带 3D 重资源与数组绑定。
 * 绑定槽直接摊开 `TWIN_VIEW_BINDINGS`，不在这里抄一份键名——槽键写两遍时，
 * 拼错的那一份既不报错也永远取不到值（twin-config/constants.ts）。
 */
import {
  TWIN_CONFIG_KEY,
  TWIN_NAVIGATION_MODES,
  TWIN_VIEW_BINDINGS,
  normalizeTwinConfig,
  twinRowCounts,
  twinRowLabels,
} from '@dt/twin-config'

import { defineModule } from '../../registry'

export default defineModule({
  type: 'twin-view',
  description:
    '3D 数字孪生模块，用于在模型中呈现部件、锚点、信息牌、箭头和能量流。场景文档由孪生编辑器维护；属性面板仅配置标题及运行态工具，平面流程或接线图应选择 2D 孪生。六个实体钉定的数组绑定槽按归一化文档顺序关联数据，未绑定行不会改变后续实体索引。部件点击发送以稳定部件 id 为值的 `click` 事件。',
  displayName: '数字孪生',
  category: '孪生',
  icon: 'building',
  keywords: ['twin', 'luansheng', '孪生', '三维', '3d', '模型'],
  // 3D 画布自己就是整块内容，套一层卡片框只会在四周切掉一圈可视范围
  chrome: 'bare',
  // 标题自绘且样式写死（Component.vue 的 .dt-twin__title），整组标题键都无消费点；
  // 正文字体/字色靠继承，但 3D 画布与详情卡片全都自定色，同样落不到任何地方
  unsupportedChromeKeys: [
    'showTitle',
    'titleColor',
    'titleAlign',
    'titlePadding',
    'titleGap',
    'titleFontSize',
    'titleFontWeight',
    'titleLetterSpacing',
    'titleBarWidth',
    'titleBarFull',
    'titleBarRadius',
    'titleBarGlow',
    'titleBarColor',
    'titleBarColorAlt',
    'titlePulse',
    'titlePulseDuration',
    'titleRule',
    'titleRuleHeight',
    'titleRuleOpacity',
    'fontFamily',
    'textColor',
  ],
  defaultSize: { width: 1280, height: 720, minWidth: 320, minHeight: 240 },
  contentKeys: [
    'title',
    'showSceneTools',
    'showStructureTree',
    'navigationMode',
    TWIN_CONFIG_KEY,
  ],
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      group: '标题',
      // ⚠ 刻意不给 default：default 会 materialize 进每一次渲染，改它等于改存量
      //   大屏的渲染结果。缺省即空串 = 画布上不叠标题
      span: 'full',
      placeholder: '留空则不显示画布标题',
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
      key: 'showSceneTools',
      label: '场景工具条',
      type: 'boolean',
      group: '运行态',
      // ⚠ 同样刻意不给 default：缺省即 false = 不显示，存量大屏零回归
      span: 'full',
      help: '运行态左上角提供场景内搜索定位、当前画面 PNG 截图、两点测量、颜色图例与剖切面。',
    },
    {
      key: 'showStructureTree',
      label: '结构树',
      type: 'boolean',
      group: '运行态',
      // ⚠ 同样刻意不给 default：缺省即 false = 不显示，存量大屏零回归
      span: 'full',
      help: '在运行态左下角提供只读模型结构树，支持层级浏览、临时显隐和定位；不写回配置。',
    },
    {
      key: 'navigationMode',
      label: '预览操作模式',
      type: 'enum',
      group: '运行态',
      default: 'orbit',
      span: 'full',
      options: TWIN_NAVIGATION_MODES.map((value) => ({
        value,
        label:
          value === 'orbit' ? '轨道操作' : '游戏操作（WASD / 空格 / Shift）',
      })),
      help: '决定运行态预览与发布后的 3D 画面如何操作；与孪生编辑器顶栏当前选择相互独立。游戏操作用 WASD 前后左右、空格上升、Shift 下降，按 Esc 释放鼠标。',
    },
    {
      key: TWIN_CONFIG_KEY,
      label: '孪生场景',
      type: 'object',
      group: '模型',
      // ⚠ 刻意不给 fields：TwinConfig 里有 Vec3 这种两列通用表单表达不了的形状。
      //   属性面板对「object 且无 fields」的字段渲染成只读摘要 + 子编辑器入口，
      //   绝不许静默画成空白
      help: '模型、部件与锚点由孪生编辑器统一维护。',
    },
  ],
  // 点中部件时上抛 `{ event: 'click', value: 部件 id }`
  emitsInteractions: true,
  // 六个实体钉定槽允许局部失败，不得遮住其余可用场景。
  ownsStatusDisplay: true,
  // ⚠ `hostClickable` 刻意不开：3D 视口内部有拖拽手势，整块可点会让每次
  //   转完镜头松手都派发一次 click（清单里 `hostClickable` 的注释写了这条）
  // 属性面板只读这份声明来决定出不出入口，故这里的路由名写错 = 入口点了没反应
  subEditor: {
    configKey: TWIN_CONFIG_KEY,
    routeName: 'twin-editor',
    label: '打开孪生编辑器',
    hint: '在孪生编辑器中维护模型、部件、锚点、信息牌与能量流。',
  },
  bindings: [...TWIN_VIEW_BINDINGS],
  // 绑点面板按它把「第 3 行」显示成「3 号机组温度」——行号与实体的对应关系
  // 只有归一化后的配置知道，所以由清单自己算
  bindingRowLabels: (config) =>
    twinRowLabels(normalizeTwinConfig(config[TWIN_CONFIG_KEY])),
  // ⚠ 孪生的行**不是**用户随手加的：行号就是实体的文档序。不声明行数的话，
  //   绑点面板会摆出「新增一行」，而加出来的那一行没有对应实体、永远喂不到
  //   任何东西——绑完看着是配好了，画面上一点反应都没有
  bindingRowCounts: (config) =>
    twinRowCounts(normalizeTwinConfig(config[TWIN_CONFIG_KEY])),
  // 刻意不给 preview：3D 演示要有模型素材才看得见，编造一份只会在画布上留一块空白
  component: () => import('./Component.vue'),
})
