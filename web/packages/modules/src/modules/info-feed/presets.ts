/**
 * @fileoverview info-feed 的两套外观预设：参考仓 feed-list 的那一套观感落成
 * `feed-plain`，中国气象预警那套级别色板落成 `weather-alert`
 * （MODULE_INFO_CARD_DESIGN §1.3 第 12 行）。
 *
 * ⚠ 两套都把「观感」那 16 个键写全，色板每一条也把四个子键按 itemSchema 的顺序
 * 写全。应用预设是**浅合并**：少写一个键，上一套留在 configJson 里的那个值就原样
 * 残留，而点亮判定做的是子集比较、照样把按钮点亮——既错了又没有任何提示。
 * ⚠ `title` 与 `emptyText` 两个内容键一个都不写：预设换的是观感，写了会把用户
 * 自己写的标题与空态文案抹掉。
 */
import type { ConfigPreset } from '@dt/contracts'

/**
 * 气象预警五色里的橙。
 * ⚠ 本仓没有橙这一档语义色：`--state-warning` 是黄、`--state-danger` 是红，
 * 顺手把橙映到 warning 会让橙与黄两档在屏上同色，五档预警当场塌成四档。
 * 这里由两个 token 调出介于两者之间的一档橙——不写死色值，换肤时跟着两端一起走。
 * ⚠ 逐字的气象橙用 token 拼不出来（红那一端自带蓝分量），要精确到那个色号只能由
 * 用户自己在色板里填一个死值，代价是换肤时它不跟着变。
 */
const WEATHER_ORANGE =
  'color-mix(in srgb, var(--state-warning) 55%, var(--state-danger))'

export const INFO_FEED_PRESETS: ConfigPreset[] = [
  {
    id: 'feed-plain',
    label: '消息流',
    hint: '圆点 + 级别 + 正文 + 右侧时间，点线分隔。',
    config: {
      showDot: true,
      dotSize: 8,
      dotGlow: 6,
      showLevel: true,
      levelSize: 12,
      textSize: 13,
      showTime: true,
      timeSize: 12,
      timePlace: 'right',
      rowBorderStyle: 'dotted',
      rowPadX: 4,
      rowPadY: 7,
      // 空色板 = 全部走内置档，级别色跟着主题走
      levels: [],
      sortByRank: false,
      autoScroll: true,
      scrollSpeed: 3,
    },
  },
  {
    id: 'weather-alert',
    label: '气象预警',
    hint: '预警五色（含橙）+ 按级别排序：红橙黄蓝四档，外加一档解除。',
    config: {
      showDot: true,
      dotSize: 8,
      dotGlow: 6,
      showLevel: true,
      levelSize: 12,
      textSize: 13,
      showTime: true,
      timeSize: 12,
      timePlace: 'right',
      rowBorderStyle: 'dotted',
      rowPadX: 4,
      rowPadY: 7,
      // ⚠ 权重重排成 5..1 而不是沿用内置档的 4..1：橙要插在红与黄之间，
      //   四档内置权重里没有它的位置
      // ⚠ 文字写的是「红色预警」这类官方说法而不是「红色」：级别文字的职责是
      //   给色相之外再来一路编码，复述颜色名等于没写
      levels: [
        {
          key: 'red',
          label: '红色预警',
          color: 'var(--state-danger)',
          rank: 5,
        },
        {
          key: 'orange',
          label: '橙色预警',
          color: WEATHER_ORANGE,
          rank: 4,
        },
        {
          key: 'yellow',
          label: '黄色预警',
          color: 'var(--state-warning)',
          rank: 3,
        },
        {
          key: 'blue',
          label: '蓝色预警',
          color: 'var(--state-info)',
          rank: 2,
        },
        {
          key: 'green',
          label: '预警解除',
          color: 'var(--state-success)',
          rank: 1,
        },
      ],
      sortByRank: true,
      autoScroll: true,
      scrollSpeed: 3,
    },
  },
]
