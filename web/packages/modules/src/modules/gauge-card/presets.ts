/**
 * @fileoverview gauge-card 的六套外观预设：参考仓 target-progress 落成第一套，
 * entity-gauge 的四档几何各落一套，第六套是它们排成网格的多仪表档
 * （MODULE_INFO_CARD_DESIGN §1.3 与 §7）。
 *
 * ⚠ 每套都把「观感」那 27 个键写全，且簇内子键顺序与该字段 `default` 逐字相同。
 * 应用预设是**浅合并**：少写一个键，上一套留在 configJson 里的那个值就原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮——既错了又没有任何提示。
 * ⚠ `title` / `items` / `emptyText` 三个内容键一个都不写：预设换的是观感，
 * 写了它们就会把用户配好的仪表整片抹掉。
 * ⚠ 取值一律以参考仓源码为准，不以覆盖表的缩写为准。四档 entity-gauge 在覆盖表里
 * 是**并集**写法，逐档回源码后有三处对不上：横向条的标签在读数右侧 11 号
 * （`.eg-label--inline`）不是下方 12 号、储罐读数钉死 16 号
 * （`.eg-tank-center .eg-value`）不是自适应、储罐填充是渐变（`.eg-tank-fill`）不是纯色。
 */
import type { ConfigPreset } from '@dt/contracts'

export const GAUGE_CARD_PRESETS: ConfigPreset[] = [
  {
    id: 'target-track',
    label: '目标进度',
    hint: '顶行标题与读数，下方带刻度与目标标记的粗轨道。',
    config: {
      layout: 'single',
      columns: 'auto',
      gap: 10,
      // 参考仓 .tp-body 的 padding: 6px 16px
      padX: 16,
      padY: 6,
      shape: 'track',
      // 18 = .tp-track 的轨道高；后三个子键这一档不吃，留在缺省档上
      geometry: {
        thickness: 18,
        arcSpan: 270,
        tankWidth: 56,
        tubeWidth: 14,
        bulbSize: 26,
      },
      // .tp-fill 是 90deg 的两段渐变，向右加深
      fillStyle: 'gradient',
      // 参考仓的刻度写死四个等距，量程端点由首末刻度顶替，故不另画端点
      scale: {
        showRange: false,
        ticks: true,
        tickCount: 4,
        wanFormat: false,
        wanDigits: 2,
      },
      // .tp-tick 是 10px
      tickSize: 10,
      targetMark: true,
      targetLabel: '计划',
      showPercent: true,
      readout: 'value',
      // 轨道要吃满整行，读数只能落在轨道上方那一行（.tp-head）
      readoutPlace: 'beside',
      // .tp-num 是 clamp(22px, 2.4vw, 40px)
      valueSize: 0,
      valueColor: 'var(--accent-primary)',
      // .tp-num 的 text-shadow 是 0 0 12px
      valueGlow: 12,
      // .tp-unit：13px、次要色、与读数隔 5px——独立单位只有这一个参考模块有
      unitSize: 13,
      unitPlace: 'baseline',
      // .tp-title 在头行左侧，15px 标题色
      labelPlace: 'left',
      labelSize: 15,
      labelTone: 'title',
      fillColor: '',
      trackColor: '',
      thousands: true,
      rules: [],
    },
  },
  {
    id: 'arc-gauge',
    label: '弧度盘',
    hint: '270° 圆弧 + 居中读数 + 量程端点。',
    config: {
      layout: 'single',
      columns: 'auto',
      gap: 10,
      // 参考仓 .eg-body 的 padding: 6px，四档 entity-gauge 共用
      padX: 6,
      padY: 6,
      shape: 'arc',
      // 厚度 0 = 随几何档取 9（参考仓 `style === 'linear' ? 12 : 9`）；
      // 张角 270 就是那两个起止角 225°→495°
      geometry: {
        thickness: 0,
        arcSpan: 270,
        tankWidth: 56,
        tubeWidth: 14,
        bulbSize: 26,
      },
      // .eg-arc-fill 是纯色描边
      fillStyle: 'solid',
      // 参考仓这一档的量程端点开关缺省是开的（.eg-range--arc）
      scale: {
        showRange: true,
        ticks: false,
        tickCount: 4,
        wanFormat: false,
        wanDigits: 2,
      },
      // .eg-range 是 11px
      tickSize: 11,
      // 参考仓 entity-gauge 没有目标标记，也没有轨道内的完成率 pill
      targetMark: false,
      targetLabel: '计划',
      showPercent: false,
      readout: 'value',
      readoutPlace: 'center',
      // .eg-value 是 clamp(16px, 1.6vw, 34px)
      valueSize: 0,
      valueColor: 'var(--accent-primary)',
      // .eg-value 没有 text-shadow
      valueGlow: 0,
      // ⚠ 参考仓把单位拼进读数字符串（`${num}${unit}`），没有独立单位节点，
      //   于是四档恒为「紧跟读数」；字号只能另给一个，取的是字段缺省
      unitSize: 12,
      unitPlace: 'attached',
      // .eg-label 在居中读数下方，12px 次要色
      labelPlace: 'below',
      labelSize: 12,
      labelTone: 'secondary',
      fillColor: '',
      trackColor: '',
      // 参考仓走 toLocaleString 且没关分组，四档都带千分位
      thousands: true,
      rules: [],
    },
  },
  {
    id: 'linear-bar',
    label: '横向条',
    hint: '细长胶囊条 + 上方读数，窄块用。',
    config: {
      layout: 'single',
      columns: 'auto',
      gap: 10,
      padX: 6,
      padY: 6,
      shape: 'linear',
      // 厚度 0 = 随几何档取 12（.eg-linear-track 的高）
      geometry: {
        thickness: 0,
        arcSpan: 270,
        tankWidth: 56,
        tubeWidth: 14,
        bulbSize: 26,
      },
      fillStyle: 'solid',
      scale: {
        showRange: true,
        ticks: false,
        tickCount: 4,
        wanFormat: false,
        wanDigits: 2,
      },
      tickSize: 11,
      targetMark: false,
      targetLabel: '计划',
      showPercent: false,
      readout: 'value',
      // .eg-linear-main 是一列：读数行在上、轨道在中、量程端点在下
      readoutPlace: 'beside',
      valueSize: 0,
      valueColor: 'var(--accent-primary)',
      valueGlow: 0,
      unitSize: 12,
      unitPlace: 'attached',
      // ⚠ .eg-label--inline：与读数同基线、左边距 6px、11px——这一档的标签在读数
      //   右侧而不是下方，字号也比另外三档小一号
      labelPlace: 'right',
      labelSize: 11,
      labelTone: 'secondary',
      fillColor: '',
      trackColor: '',
      thousands: true,
      rules: [],
    },
  },
  {
    id: 'tank',
    label: '储罐',
    hint: '竖向液面 + 液面高光 + 居中读数。',
    config: {
      layout: 'single',
      columns: 'auto',
      gap: 10,
      padX: 6,
      padY: 6,
      shape: 'tank',
      // 56 = .eg-tank 的宽（另受「不超过半块宽」约束）
      geometry: {
        thickness: 0,
        arcSpan: 270,
        tankWidth: 56,
        tubeWidth: 14,
        bulbSize: 26,
      },
      // ⚠ .eg-tank-fill 是 0deg 的两段渐变（自下而上淡出），不是纯色
      fillStyle: 'gradient',
      // 参考仓这一档不画量程端点：罐身太窄，两端摆不下
      scale: {
        showRange: false,
        ticks: false,
        tickCount: 4,
        wanFormat: false,
        wanDigits: 2,
      },
      tickSize: 10,
      targetMark: false,
      targetLabel: '计划',
      showPercent: false,
      readout: 'value',
      readoutPlace: 'center',
      // ⚠ .eg-tank-center .eg-value 把 clamp 覆盖成 16px：罐身只有 56px 宽，
      //   自适应字号会顶出罐外
      valueSize: 16,
      valueColor: 'var(--accent-primary)',
      valueGlow: 0,
      unitSize: 12,
      unitPlace: 'attached',
      labelPlace: 'below',
      labelSize: 12,
      labelTone: 'secondary',
      fillColor: '',
      trackColor: '',
      thousands: true,
      rules: [],
    },
  },
  {
    id: 'thermometer',
    label: '温度计',
    hint: '管 + 球 + 右侧读数。',
    config: {
      layout: 'single',
      columns: 'auto',
      gap: 10,
      padX: 6,
      padY: 6,
      shape: 'thermometer',
      // 14 = .eg-thermo-tube 的管宽，26 = .eg-thermo-bulb 的球径
      geometry: {
        thickness: 0,
        arcSpan: 270,
        tankWidth: 56,
        tubeWidth: 14,
        bulbSize: 26,
      },
      // .eg-thermo-fill 是纯色
      fillStyle: 'solid',
      scale: {
        showRange: false,
        ticks: false,
        tickCount: 4,
        wanFormat: false,
        wanDigits: 2,
      },
      tickSize: 10,
      targetMark: false,
      targetLabel: '计划',
      showPercent: false,
      readout: 'value',
      // .eg-thermo-wrap 是一行：管在左、读数列在右
      readoutPlace: 'beside',
      valueSize: 0,
      valueColor: 'var(--accent-primary)',
      valueGlow: 0,
      unitSize: 12,
      unitPlace: 'attached',
      // .eg-thermo-readout 是一列：读数在上、标签在下
      labelPlace: 'below',
      labelSize: 12,
      labelTone: 'secondary',
      fillColor: '',
      trackColor: '',
      thousands: true,
      rules: [],
    },
  },
  {
    id: 'gauge-grid',
    label: '仪表阵列',
    hint: '一行几个同款仪表，网格等分。',
    config: {
      layout: 'grid',
      // ⚠ 字符串档值：写成数字 3 判不中白名单、静默回落「自动」，
      //   墙上少了列数而两边都不报错
      columns: '3',
      gap: 12,
      padX: 8,
      padY: 8,
      shape: 'arc',
      geometry: {
        thickness: 0,
        arcSpan: 270,
        tankWidth: 56,
        tubeWidth: 14,
        bulbSize: 26,
      },
      fillStyle: 'solid',
      // 一格几十像素宽，量程端点与刻度都摆不下
      scale: {
        showRange: false,
        ticks: false,
        tickCount: 4,
        wanFormat: false,
        wanDigits: 2,
      },
      tickSize: 10,
      targetMark: false,
      targetLabel: '计划',
      showPercent: false,
      readout: 'value',
      readoutPlace: 'center',
      valueSize: 0,
      valueColor: 'var(--accent-primary)',
      valueGlow: 0,
      unitSize: 12,
      unitPlace: 'attached',
      labelPlace: 'below',
      labelSize: 12,
      labelTone: 'secondary',
      fillColor: '',
      trackColor: '',
      thousands: true,
      rules: [],
    },
  },
]
