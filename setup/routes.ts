import type { RouteRecordRaw } from 'vue-router'
import type { SlideRoute } from '@slidev/types'
import { slides } from '#slidev/slides'
import { defineComponent, h } from 'vue'
import BlackboardBuildSlide from '../components/BlackboardBuildSlide.vue'
import type { BlackboardInitialState } from '../shared/blackboardProtocol'
// @ts-expect-error - The addon provides this virtual module from setup/vite-plugins.ts.
import blackboardInitialState from 'virtual:slidev-blackboard'

let buildAppendixSlidesAppended = false

function nonEmptyBuildBoards(initialState: BlackboardInitialState) {
  if (!initialState.build?.append)
    return []

  return (initialState.boards || []).filter(board => board.drawing.trim().length > 0)
}

function appendBuildBlackboardSlides(initialState: BlackboardInitialState) {
  if (buildAppendixSlidesAppended)
    return

  const boards = nonEmptyBuildBoards(initialState)
  if (!boards.length)
    return

  buildAppendixSlidesAppended = true
  const baseNo = slides.value.length
  const appendixSlides = boards.map((board, index): SlideRoute => {
    const no = baseNo + index + 1
    const title = board.title || `Blackboard ${index + 1}`
    const frontmatter = {
      blackboardAppendix: true,
      blackboardBoardId: board.id,
      hideInToc: false,
      layout: 'none',
      title,
    }
    const component = defineComponent({
      name: `BlackboardBuildAppendixSlide${no}`,
      setup() {
        return () => h(BlackboardBuildSlide, { boardId: board.id })
      },
    })
    const source = {
      content: '',
      contentRaw: '',
      contentStart: 0,
      end: 0,
      filepath: 'virtual:slidev-blackboard',
      frontmatter,
      index,
      raw: '',
      revision: '',
      start: 0,
      title,
    }

    return {
      component,
      load: async () => ({ default: component }),
      meta: {
        slide: {
          content: '',
          frontmatter,
          index: no - 1,
          level: 1,
          no,
          note: '',
          revision: '',
          source,
          title,
        },
      },
      no,
    }
  })

  slides.value = [...slides.value, ...appendixSlides]
}

export default function setupBlackboardRoutes(routes: RouteRecordRaw[]) {
  const initialState = blackboardInitialState as BlackboardInitialState
  if (initialState.enabled === false)
    return routes

  appendBuildBlackboardSlides(initialState)

  for (const route of routes) {
    if (route.name === 'print')
      route.component = () => import('../pages/blackboard-print.vue')
    else if (route.name === 'export')
      route.component = () => import('../pages/blackboard-export.vue')
  }

  return routes
}
