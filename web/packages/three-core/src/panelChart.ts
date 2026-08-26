/**
 * @fileoverview 信息牌上的两种迷你图：趋势线与柱群。
 *
 * ⚠ 序列是**本次会话内攒出来的**，不是历史库里查来的：牌上一路读数只有当下这一个值，
 * 要画走势就只能把收到的值留下来。所以刚打开大屏时图是空的，攒够两个点才有线——
 * 这一点编辑器上必须写明，否则用户会以为是绑定没生效。
 * ⚠ 只建一次 DOM，之后改的都是属性：每来一个读数就重建节点会让浏览器重排整张牌，
 * 几十张牌一起时肉眼可见地卡。
 */
const SVG_NS = 'http://www.w3.org/2000/svg'

/** 留最近多少个读数。再多在一张牌的宽度里就挤成一团墨。 */
export const SERIES_LENGTH = 24

/** 迷你图的画布尺寸，与 viewBox 同一套坐标。 */
const CHART_WIDTH = 100
const CHART_HEIGHT = 30

/** 一个迷你图。`push` 收一个 0–1 的占比，`null` = 这一轮没有可用读数。 */
export interface PanelChart {
  el: Element
  push: (ratio: number | null) => void
}

/** 最近若干个占比，新的在后；取不到读数的那一轮不占位。 */
function rollingPush(points: number[], ratio: number | null): void {
  if (ratio === null) return
  points.push(ratio)
  if (points.length > SERIES_LENGTH) points.shift()
}

/**
 * 折线点串。
 * ⚠ 最新的一个钉在右端、其余按固定步长往左排：把现有点均摊到整幅宽度的话，
 * 每来一个新读数整条线都会横向拉伸一次，看着像数据在抖。
 */
function polylinePoints(points: readonly number[]): string {
  const stride = CHART_WIDTH / (SERIES_LENGTH - 1)
  return points
    .map((ratio, index) => {
      const x = CHART_WIDTH - (points.length - 1 - index) * stride
      const y = CHART_HEIGHT - ratio * CHART_HEIGHT
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

/** 折线下方那片渐变：折线两端各垂一笔到底边。 */
function areaPoints(line: string, count: number): string {
  if (count < 2) return ''
  const stride = CHART_WIDTH / (SERIES_LENGTH - 1)
  const left = CHART_WIDTH - (count - 1) * stride
  return `${left.toFixed(2)},${CHART_HEIGHT} ${line} ${CHART_WIDTH},${CHART_HEIGHT}`
}

/**
 * 迷你趋势线。
 * ⚠ 外面套一个盒子：折线本身在没数据时什么都不画，只有盒子上的底纹与基线
 * 能说明「这里是一张图，还没有读数」——不套的话用户看到的是一片空白。
 */
export function createSparkline(): PanelChart {
  const box = document.createElement('div')
  box.className = 'twin-panel__spark-box'
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'twin-panel__spark')
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`)
  // 牌宽由用户定，图得跟着拉伸而不是两边留白
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  const area = document.createElementNS(SVG_NS, 'polygon')
  area.setAttribute('class', 'twin-panel__spark-area')
  const line = document.createElementNS(SVG_NS, 'polyline')
  line.setAttribute('class', 'twin-panel__spark-line')
  svg.append(area, line)

  box.append(svg)

  const points: number[] = []
  return {
    el: box,
    push(ratio) {
      rollingPush(points, ratio)
      const drawn = polylinePoints(points)
      // 只有一个点时 polyline 画不出任何东西，索性留空，别留一段假线头
      line.setAttribute('points', points.length > 1 ? drawn : '')
      area.setAttribute('points', areaPoints(drawn, points.length))
      box.dataset.empty = points.length === 0 ? 'on' : 'off'
    },
  }
}

/** 一根柱子的高度占比；柱子本身由样式表按它算高。 */
function setBar(bar: HTMLElement, ratio: number | undefined): void {
  bar.style.setProperty('--tp-bar', (ratio ?? 0).toFixed(3))
}

/** 迷你柱群：与趋势线同一份序列，看节拍比看走势清楚。 */
export function createMiniBars(): PanelChart {
  const wrap = document.createElement('div')
  wrap.className = 'twin-panel__bars'
  const bars: HTMLElement[] = []
  for (let index = 0; index < SERIES_LENGTH; index += 1) {
    const bar = document.createElement('i')
    wrap.append(bar)
    bars.push(bar)
  }

  const points: number[] = []
  return {
    el: wrap,
    push(ratio) {
      rollingPush(points, ratio)
      // 右对齐：最新的一根永远在最右，与趋势线同一个读法
      const offset = SERIES_LENGTH - points.length
      bars.forEach((bar, index) => {
        setBar(bar, index < offset ? 0 : points[index - offset])
      })
      // 一个读数都没到时整排都是底座，样式表拿它区分「空槽」与「读数为零」
      wrap.dataset.empty = points.length === 0 ? 'on' : 'off'
    },
  }
}
