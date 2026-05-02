import type { BlackboardRenderedExhibit } from './blackboardTypes'
import { placeInlineSvgFragments } from './svgExhibitPlacement'

export function placeTableExhibitSvg(svg: string, x: number, y: number, scale: number, exhibit: BlackboardRenderedExhibit) {
  return placeInlineSvgFragments(svg, x, y, scale, exhibit, 'table')
}
