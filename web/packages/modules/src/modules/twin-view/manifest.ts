/**
 * @fileoverview twin-view —— 数字孪生查看器。一期最复杂的模块：带 3D 重资源与数组绑定。
 * 绑定槽直接摊开 `TWIN_VIEW_BINDINGS`，不在这里抄一份键名——槽键写两遍时，
 * 拼错的那一份既不报错也永远取不到值（twin-config/constants.ts）。
 */
import {
  TWIN_CONFIG_KEY,
  TWIN_VIEW_BINDINGS,
  normalizeTwinConfig,
  twinRowCounts,
  twinRowLabels,
} from '@dt/twin-config'

import { defineModule } from '../../registry'

export default defineModule({
  type: 'twin-view',
  displayName: '数字孪生',
  category: '孪生',
  icon: 'building',
  keywords: ['twin', 'luansheng', '孪生', '三维', '3d', '模型'],
  // 3D 画布自己就是整块内容，套一层卡片框只会在四周切掉一圈可视范围
  chrome: 'bare',
  // 标题自绘且样式写死（Component.vue 的 .dt-twin__title），整组标题键都无消费点；
  // 正文字体/字色靠继承，但 3D 画布与钻取面板全都自定色，同样落不到任何地方
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
      help: '运行态左下角提供只读的模型结构树：浏览层级、勾选显隐、点击定位。勾选显隐只影响当前会话，不写回配置。',
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
  // 点中部件时上抛 `{ event: 'click', value: 部件 id }`
  emitsInteractions: true,
  // ⚠ `hostClickable` 刻意不开：3D 视口内部有拖拽手势，整块可点会让每次
  //   转完镜头松手都派发一次 click（清单里 `hostClickable` 的注释写了这条）
  // 属性面板只读这份声明来决定出不出入口，故这里的路由名写错 = 入口点了没反应
  subEditor: {
    configKey: TWIN_CONFIG_KEY,
    routeName: 'twin-editor',
    label: '打开孪生编辑器',
    hint: '模型摆放、部件、锚点、信息牌与能量流都在那里配。',
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
