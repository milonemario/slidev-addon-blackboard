import type { BlackboardRenderedExhibit } from './blackboardTypes'
import { placeLockedExhibitSvg } from './svgExhibitPlacement'

export function placeImageExhibitSvg(svg: string, x: number, y: number, scale: number, exhibit: BlackboardRenderedExhibit) {
  return placeLockedExhibitSvg(svg, x, y, scale, {
    ...exhibit,
    kind: 'image',
    placement: 'locked',
  })
}
