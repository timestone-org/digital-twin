/** @fileoverview 省级边界与经纬度投影；边界来源见 docs/MODULE_GREEN_PRODUCTION_MIGRATION.md。 */
import {
  readArray,
  readNumber,
  readRecord,
  readText,
} from '../../shared/config'

const DEGREE = Math.PI / 180

/** 纬度转为墨卡托纵坐标。 */
function latitudeY(value: number): number {
  const bounded = Math.max(-80, Math.min(80, value))
  return Math.log(Math.tan(Math.PI / 4 + (bounded * DEGREE) / 2)) / DEGREE
}

/** 固定画布坐标的投影，单位为经纬度。 */
export function project(
  lng: number,
  lat: number,
  config: Record<string, unknown>,
) {
  const scale = 7 * Math.max(0.5, Math.min(3, readNumber(config.zoom, 1.5)))
  return {
    x: 500 + (lng - readNumber(config.centerLng, 104)) * scale,
    y:
      330 +
      (latitudeY(readNumber(config.centerLat, 35.5)) - latitudeY(lat)) * scale,
  }
}

/** 一个闭合边界环。 */
function ringPath(raw: unknown, config: Record<string, unknown>): string {
  const points = readArray(raw).flatMap((entry) => {
    const pair = readArray(entry)
    if (typeof pair[0] !== 'number' || typeof pair[1] !== 'number') return []
    const point = project(pair[0], pair[1], config)
    return [`${point.x.toFixed(2)},${point.y.toFixed(2)}`]
  })
  return points.length < 3 ? '' : `M${points.join('L')}Z`
}

/** GeoJSON 的两种多边形几何归一。 */
export function regionViews(raw: unknown, config: Record<string, unknown>) {
  return readArray(readRecord(raw).features).map((value) => {
    const feature = readRecord(value)
    const props = readRecord(feature.properties)
    const geometry = readRecord(feature.geometry)
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : readArray(geometry.coordinates)
    const center = readArray(props.center)
    return {
      key: String(props.adcode ?? props.name),
      name: readText(props.name),
      path: polygons
        .flatMap((polygon) =>
          readArray(polygon).map((ring) => ringPath(ring, config)),
        )
        .join(''),
      center:
        typeof center[0] === 'number' && typeof center[1] === 'number'
          ? project(center[0], center[1], config)
          : null,
    }
  })
}
