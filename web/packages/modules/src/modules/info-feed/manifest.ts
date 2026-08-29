/**
 * @fileoverview info-feed —— 信息流：直通渲染后端推来的成品文本流，一行是
 * 「级别圆点 ｜ 级别文字 ｜ 正文 ｜ 时间」四件，不做阈值评估也不做数值格式化
 * （对照 info-list：那边是客户端按规则表评估数值点位）。参考仓 feed-list 的观感
 * 落成本模块的两套预设，见 docs/MODULE_INFO_CARD_DESIGN.md §4.3 与 §5.2。
 *
 * ⚠ 本族四个模块里只有它的数组槽是**列表式**：行由用户在绑点面板上增删，
 * 服务端强制索引连续且从 0 起。所以这里刻意不给 `isEntityPinned`、也不给
 * `bindingRowCounts`——两者是同一档口径的两半，给了就退回「行钉在配置里的实体上」，
 * 而本模块根本没有 config 侧的行，行数会永远算成 0。清单字段不可能按实例切换，
 * 硬切就是「服务端按一种口径校验、绑点面板按另一种口径摆行」。
 * ⚠ 七个尺寸旋钮的区间与缺省取自 `./look` 的 `FEED_SIZE_BOUNDS`：属性面板的 min / max
 * 与取值层的夹取一旦各写一份，面板上拖得到的那一格渲染时会被夹回去——「配了不生效」。
 * ⚠ 类型 id 是 `info-feed` 而不是 `feed`：守「零模块类型字面量」的那道闸按已注册的
 * type 逐个 grep 源码，`feed` 这种常见词会红在一堆与模块毫不相干的属性上。
 */
import { defineModule } from '../../registry'
import { scrollConfigFields } from '../../shared/scroll'
import { FEED_SLOT_KEY } from './feed'
import { FEED_SIZE_BOUNDS } from './look'
import { FEED_BORDER_STYLES, FEED_TIME_PLACES } from './options'
import { INFO_FEED_PRESETS } from './presets'

export default defineModule({
  type: 'info-feed',
  description:
    '信息流：直通渲染后端推来的成品文本条目，一条是「级别圆点 ｜ 级别文字 ｜ 正文 ｜ 时间」四件，自带自动滚动；它不做阈值评估也不做数值格式化。预警、公告、日志、告警消息这类条数不固定、内容与级别由后端给的流用它；一行一个点位、由前端按规则表评估数值的固定清单用 info-list。一个数组绑定槽 `feedValues`，三个子槽 `level` / `text` / `time` 全收字符串：`level` 与内置档比对来上色（danger / red / error、warning / warn / yellow、info / blue、success / normal / green），`time` 是后端给的时间文本而不是墙钟。⚠ 本族四个模块里只有它的数组槽是列表式的：条目由用户在绑点面板上手工增删，服务端强制索引连续且从 0 起，中间空一格会被拒——不像另外三个那样把行钉在配置项上。⚠ 气象「橙色」没有内置档（主题只有四支状态色），要橙必须在「级别色板」里配一条。',
  displayName: '信息流',
  category: '数据',
  icon: 'activity',
  keywords: [
    'feed',
    'xinxiliu',
    'yujing',
    'gonggao',
    '信息流',
    '预警',
    '公告',
    '日志',
    '消息流',
  ],
  defaultSize: { width: 400, height: 260, minWidth: 160, minHeight: 96 },
  configPresets: INFO_FEED_PRESETS,
  contentKeys: ['title', 'emptyText'],
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      group: '内容',
      default: '',
      span: 'full',
      placeholder: '留空则不画标题栏',
    },
    {
      key: 'emptyText',
      label: '空态文案',
      type: 'string',
      group: '内容',
      default: '暂无信息',
      span: 'half',
      placeholder: '暂无信息',
      help: '一条都摆不出来时画的一句话。⚠ 没推来文本的条目不占位，所以刚打开、后端还没推的那一刻看到的也是这一句。',
    },
    {
      key: 'showDot',
      label: '显示级别圆点',
      type: 'boolean',
      group: '圆点',
      default: true,
      span: 'half',
      help: '行首那颗按级别着色的圆点。',
    },
    {
      key: 'dotSize',
      label: '圆点直径 (px)',
      type: 'range',
      group: '圆点',
      default: FEED_SIZE_BOUNDS.dotSize.fallback,
      min: FEED_SIZE_BOUNDS.dotSize.min,
      max: FEED_SIZE_BOUNDS.dotSize.max,
      step: 1,
      span: 'half',
      when: { key: 'showDot', in: [true] },
    },
    {
      key: 'dotGlow',
      label: '圆点辉光 (px)',
      type: 'range',
      group: '圆点',
      default: FEED_SIZE_BOUNDS.dotGlow.fallback,
      min: FEED_SIZE_BOUNDS.dotGlow.min,
      max: FEED_SIZE_BOUNDS.dotGlow.max,
      step: 1,
      span: 'half',
      when: { key: 'showDot', in: [true] },
      help: '同色外发光的模糊半径；0 = 纯色点。',
    },
    {
      key: 'showLevel',
      label: '显示级别文字',
      type: 'boolean',
      group: '级别',
      default: true,
      span: 'half',
      help: '圆点与文字是同一件事的两种编码。⚠ 关掉后级别只剩色相一路，色觉障碍、远看与读屏都读不出来。未知级别本来就不编造文字，与这个开关无关。',
    },
    {
      key: 'levelSize',
      label: '级别字号 (px)',
      type: 'range',
      group: '级别',
      default: FEED_SIZE_BOUNDS.levelSize.fallback,
      min: FEED_SIZE_BOUNDS.levelSize.min,
      max: FEED_SIZE_BOUNDS.levelSize.max,
      step: 1,
      span: 'half',
      when: { key: 'showLevel', in: [true] },
    },
    {
      key: 'textSize',
      label: '正文字号 (px)',
      type: 'range',
      group: '正文',
      default: FEED_SIZE_BOUNDS.textSize.fallback,
      min: FEED_SIZE_BOUNDS.textSize.min,
      max: FEED_SIZE_BOUNDS.textSize.max,
      step: 1,
      span: 'half',
      help: '正文超长时单行截断，全文挂在悬停提示上。',
    },
    {
      key: 'showTime',
      label: '显示时间',
      type: 'boolean',
      group: '时间',
      default: true,
      span: 'half',
      help: '⚠ 时间是后端直通的文本，不是墙钟：那一条没推时间就整列留白，故可关。',
    },
    {
      key: 'timeSize',
      label: '时间字号 (px)',
      type: 'range',
      group: '时间',
      default: FEED_SIZE_BOUNDS.timeSize.fallback,
      min: FEED_SIZE_BOUNDS.timeSize.min,
      max: FEED_SIZE_BOUNDS.timeSize.max,
      step: 1,
      span: 'half',
      when: { key: 'showTime', in: [true] },
    },
    {
      key: 'timePlace',
      label: '时间位置',
      type: 'enum',
      group: '时间',
      default: 'right',
      span: 'half',
      when: { key: 'showTime', in: [true] },
      help: '摆行首时时间排在圆点之前，几条的时刻竖着对齐；摆行尾时正文吃满中间的空档。',
      options: [...FEED_TIME_PLACES],
    },
    {
      key: 'rowBorderStyle',
      label: '行分隔线',
      type: 'enum',
      group: '行',
      default: 'dotted',
      span: 'half',
      options: [...FEED_BORDER_STYLES],
    },
    {
      key: 'rowPadX',
      label: '行左右内边距 (px)',
      type: 'range',
      group: '行',
      default: FEED_SIZE_BOUNDS.rowPadX.fallback,
      min: FEED_SIZE_BOUNDS.rowPadX.min,
      max: FEED_SIZE_BOUNDS.rowPadX.max,
      step: 1,
      span: 'half',
    },
    {
      key: 'rowPadY',
      label: '行上下内边距 (px)',
      type: 'range',
      group: '行',
      default: FEED_SIZE_BOUNDS.rowPadY.fallback,
      min: FEED_SIZE_BOUNDS.rowPadY.min,
      max: FEED_SIZE_BOUNDS.rowPadY.max,
      step: 1,
      span: 'half',
    },
    {
      key: 'levels',
      label: '级别色板',
      type: 'array',
      group: '色板',
      itemLabelKey: 'key',
      span: 'full',
      default: [],
      help: '留空 = 走内置档（danger / warning / info / success 与 red / yellow / blue / green 等别名各自映到一个主题状态色）。这里按级别值覆盖：只填了文字或权重的条目，颜色仍回落内置档。⚠ 橙没有内置档——本仓没有橙这一档语义色，要它只能在这里配。',
      itemSchema: [
        {
          key: 'key',
          label: '级别值',
          type: 'string',
          default: '',
          placeholder: '如 orange',
          help: '与推来的级别文本比对，两侧都去首尾空格再转小写。⚠ 同一个级别值配了两条时后一条生效。',
        },
        {
          key: 'label',
          label: '级别文字',
          type: 'string',
          default: '',
          placeholder: '留空取内置档',
        },
        {
          key: 'color',
          label: '颜色',
          type: 'color',
          default: '',
          placeholder: '留空取内置档',
          help: '只填 var(--…) 引用，填死色值换肤时不跟着走。',
        },
        {
          key: 'rank',
          label: '排序权重',
          type: 'number',
          default: 0,
          help: '越大越靠前，只在「按级别排序」开着时才参与。',
        },
      ],
    },
    {
      key: 'sortByRank',
      label: '按级别排序',
      type: 'boolean',
      group: '色板',
      default: false,
      span: 'half',
      help: '按权重降序排，同权重的保持推送顺序。⚠ 缺省关着：本模块的语义是直通，重排会让「最新的一条在最上面」这条默认读法失效。',
    },
    ...scrollConfigFields(),
  ],
  bindings: [
    {
      key: FEED_SLOT_KEY,
      label: '信息流条目',
      // ⚠ 只影响 static 常量那一档的输入控件，不过滤可选点位
      dataType: 'string',
      isArray: true,
      // ⚠ 刻意不声明 isEntityPinned：条目由用户在绑点面板上增删，索引由服务端
      //   强制连续。声明了它，服务端会跳过连续性校验、面板会收起增删键，
      //   而本模块没有 config 侧的条目可钉，整块从此一条也摆不出来
      // ⚠ 一个子槽都不给 isRequired：三个子槽里只绑正文是常态，
      //   给了会让整块被判 unbound 并盖上状态浮层，行级的四档白画
      arrayFields: [
        { key: 'level', label: '级别', dataType: 'string' },
        { key: 'text', label: '内容', dataType: 'string' },
        { key: 'time', label: '时间', dataType: 'string' },
      ],
    },
  ],
  // 一条推送坏掉不该让整块被浮层盖住，另外九条明明有值却一个都看不见。
  // ⚠ 本模块直通渲染成品文本，没有「逐格读数」这回事：未绑定、等首帧与取不到
  //   在 values 里长得一模一样（都是没有文本），故四档收在条目级——没有文本的
  //   条目不占位（一串空白行比缺行更不诚实），一条都不剩时落 emptyText。
  //   参考仓 feed-list 处理空态用的就是这一套，这里只是把它变成契约上的声明
  ownsStatusDisplay: true,
  // 点某一条上抛这一条的正文
  emitsInteractions: true,
  // 整块可点由宿主接管；条目内点击在模板里 `.stop`，否则同一次点击会被兜底再抛一次
  hostClickable: true,
  // ⚠ 不给 bindingRowCounts：它与 isEntityPinned 是同一档口径的两半。
  //   给了绑点面板就不摆增删键，而条目只能从那里来
  // ⚠ 也不给 bindingRowLabels：条目不是配置里的实体，第 3 条叫什么只有推来的
  //   数据知道，编辑期没有任何东西可以自述
  preview: {
    // ⚠ 只提演示值不提演示配置：本模块的内容全部来自绑定，拿 preview 去改标题
    //   或观感会让画布上与运行态长成两个样子
    values: {
      [FEED_SLOT_KEY]: [
        {
          level: 'danger',
          text: '暴雨红色预警：未来 3 小时降雨量将达 100mm',
          time: '10:24',
        },
        {
          level: 'warning',
          text: '大风黄色预警：阵风 8 级，注意高空作业',
          time: '09:10',
        },
        { level: 'info', text: '空气质量良，适宜户外作业', time: '08:00' },
      ],
    },
  },
  component: () => import('./Component.vue'),
})
