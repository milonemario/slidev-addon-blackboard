import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { BlackboardBoardSetKind, BlackboardPersistedState } from '../shared/blackboardProtocol'
import {
  BLACKBOARD_BOARD_SETS_ENDPOINT,
  BLACKBOARD_EXHIBIT_ASSET_ENDPOINT,
  BLACKBOARD_EXHIBITS_ENDPOINT,
  BLACKBOARD_GUIDES_ENDPOINT,
  BLACKBOARD_RESET_LIVE_ENDPOINT,
  BLACKBOARD_STATE_ENDPOINT,
  BLACKBOARD_VIRTUAL_ID,
  normalizeBoardTheme,
  parseBoardSetKey,
} from '../shared/blackboardProtocol'
import {
  type BlackboardSetupOptions,
  normalizeBlackboardConfig,
  resolveExhibitDir,
  resolveGuideDir,
  resolvePersistDir,
  resolvePrefilledLiveDir,
  resolvePublicDir,
  resolveSavedLiveRootDir,
} from './blackboardConfig'
import type { BlackboardExhibitSource } from './blackboardExhibits'
import { listExhibits, loadExhibit, loadImageExhibitAsset, publicExhibitMetadata } from './blackboardExhibits'
import {
  activateBoardSet,
  boardSetRootDir,
  isSafeBoardSetId,
  listBoardSets,
  loadBoardSetState,
  loadDefaultBoardSetSelection,
  loadSeededPersistedState,
  resetLiveFromPrefilled,
  saveBoardSet,
} from './blackboardSets'
import { loadPersistedState, writePersistedState } from './blackboardStateStore'

const RESOLVED_VIRTUAL_ID = `\0${BLACKBOARD_VIRTUAL_ID}`
const setKinds = new Set<BlackboardBoardSetKind>(['current-live', 'guide', 'prefilled-live', 'saved-live'])

interface BlackboardSetSaveRequest {
  id?: string
  kind?: BlackboardBoardSetKind
  name?: string
  state?: BlackboardPersistedState
}

interface BlackboardResetLiveRequest {
  id?: string
  key?: string
}

function disabledInitialState() {
  return {
    boardSets: {
      endpoint: BLACKBOARD_BOARD_SETS_ENDPOINT,
      resetEndpoint: BLACKBOARD_RESET_LIVE_ENDPOINT,
    },
    boards: [],
    build: {
      append: false,
      background: 'whiteboard',
    },
    enabled: false,
    endpoint: BLACKBOARD_STATE_ENDPOINT,
    exhibitEndpoint: BLACKBOARD_EXHIBITS_ENDPOINT,
    exhibits: [],
    export: {
      background: 'whiteboard',
      include: false,
    },
    guide: {
      enabled: false,
      endpoint: BLACKBOARD_GUIDES_ENDPOINT,
      opacity: 0.22,
    },
    guideBoards: [],
    persist: false,
    theme: 'blackboard',
  }
}

async function readBodyJson(req: IncomingMessage) {
  return await new Promise<unknown>((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('error', reject)
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      }
      catch (error) {
        reject(error)
      }
    })
  })
}

function writeJson(res: ServerResponse, value: unknown) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(value))
}

function writeError(res: ServerResponse, statusCode: number, message: string) {
  res.statusCode = statusCode
  res.end(message)
}

function normalizeBoardSetKind(kind: string | undefined): BlackboardBoardSetKind | undefined {
  return kind && setKinds.has(kind as BlackboardBoardSetKind)
    ? kind as BlackboardBoardSetKind
    : undefined
}

function createBlackboardVitePlugin(options: BlackboardSetupOptions): Plugin {
  const config = normalizeBlackboardConfig(options)
  const persistDir = resolvePersistDir(options)
  const guideDir = resolveGuideDir(options)
  const prefilledLiveDir = resolvePrefilledLiveDir(options)
  const savedLiveRootDir = resolveSavedLiveRootDir(options)
  const exhibitDir = resolveExhibitDir(options)
  const exhibitSources: BlackboardExhibitSource[] = [
    { dir: exhibitDir },
    {
      categoryPrefix: 'Deck Assets',
      dir: resolvePublicDir(options),
      idPrefix: 'public:',
    },
  ]

  return {
    name: 'slidev-addon-blackboard:persist',
    resolveId(id) {
      return id === BLACKBOARD_VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined
    },
    async load(id) {
      if (id !== RESOLVED_VIRTUAL_ID)
        return undefined

      if (!config.enabled)
        return `export default ${JSON.stringify(disabledInitialState())}`

      const state = await loadSeededPersistedState(persistDir, prefilledLiveDir, options)
      const guideSelection = await loadDefaultBoardSetSelection(guideDir, 'guide')
      const guideState = guideSelection.state
      const exhibits = await listExhibits(exhibitSources)
      return `export default ${JSON.stringify({
        activeBoardId: state.activeBoardId,
        boardSets: {
          endpoint: BLACKBOARD_BOARD_SETS_ENDPOINT,
          resetEndpoint: BLACKBOARD_RESET_LIVE_ENDPOINT,
        },
        boards: state.boards,
        build: config.build,
        enabled: true,
        endpoint: BLACKBOARD_STATE_ENDPOINT,
        exhibitEndpoint: BLACKBOARD_EXHIBITS_ENDPOINT,
        exhibits: exhibits.map(publicExhibitMetadata),
        export: config.export,
        guide: {
          enabled: config.guide.enabled,
          endpoint: BLACKBOARD_GUIDES_ENDPOINT,
          opacity: config.guide.opacity,
        },
        guideActiveBoardId: guideState.activeBoardId,
        guideActiveSetId: guideSelection.id,
        guideBoards: guideState.boards,
        persist: !!persistDir,
        theme: normalizeBoardTheme(state.theme),
      })}`
    },
    configureServer(server) {
      if (!config.enabled)
        return

      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.url ? new URL(req.url, 'http://localhost') : undefined
        if (!requestUrl)
          return next()

        const pathname = requestUrl.pathname

        if (pathname === BLACKBOARD_EXHIBITS_ENDPOINT && req.method === 'GET') {
          try {
            const id = requestUrl.searchParams.get('id') || ''
            if (!id)
              return writeError(res, 400, 'Missing exhibit id')

            writeJson(res, await loadExhibit(exhibitSources, id))
          }
          catch (error) {
            console.error('[blackboard] Failed to load exhibit', error)
            writeError(res, 422, error instanceof Error ? error.message : 'Failed to load exhibit')
          }
          return
        }

        if (pathname === BLACKBOARD_EXHIBIT_ASSET_ENDPOINT && req.method === 'GET') {
          try {
            const id = requestUrl.searchParams.get('id') || ''
            if (!id)
              return writeError(res, 400, 'Missing exhibit id')

            const asset = await loadImageExhibitAsset(exhibitSources, id)
            res.statusCode = 200
            res.setHeader('Content-Type', asset.mimeType)
            res.setHeader('Cache-Control', 'no-cache')
            res.end(asset.buffer)
          }
          catch (error) {
            console.error('[blackboard] Failed to load exhibit asset', error)
            writeError(res, 404, error instanceof Error ? error.message : 'Failed to load exhibit asset')
          }
          return
        }

        if (pathname === BLACKBOARD_BOARD_SETS_ENDPOINT && req.method === 'GET') {
          try {
            const key = requestUrl.searchParams.get('key')
            const parsedKey = key ? parseBoardSetKey(key) : undefined
            const kind = normalizeBoardSetKind(requestUrl.searchParams.get('kind') || parsedKey?.kind)
            const id = requestUrl.searchParams.get('id') || parsedKey?.id || ''
            if (kind && id) {
              if (requestUrl.searchParams.get('activate') === 'true' && kind !== 'current-live' && isSafeBoardSetId(id))
                await activateBoardSet(kind, id, guideDir, prefilledLiveDir, savedLiveRootDir)
              writeJson(res, await loadBoardSetState(kind, id, persistDir, guideDir, prefilledLiveDir, savedLiveRootDir))
            }
            else {
              writeJson(res, {
                sets: await listBoardSets(persistDir, guideDir, prefilledLiveDir, savedLiveRootDir),
              })
            }
          }
          catch (error) {
            console.error('[blackboard] Failed to load blackboard sets', error)
            writeError(res, 500, 'Failed to load blackboard sets')
          }
          return
        }

        if (pathname === BLACKBOARD_BOARD_SETS_ENDPOINT && req.method === 'POST') {
          try {
            const body = await readBodyJson(req) as BlackboardSetSaveRequest
            const kind = normalizeBoardSetKind(body.kind)
            if (!kind || kind === 'current-live')
              return writeError(res, 400, 'Missing board set kind')

            const rootDir = boardSetRootDir(kind, guideDir, prefilledLiveDir, savedLiveRootDir)
            if (!rootDir)
              return writeError(res, 404, 'This blackboard set kind is not enabled')

            const saved = await saveBoardSet(kind, rootDir, body.id, body.name, body.state || { boards: [] }, options)
            if (!saved)
              return writeError(res, 500, 'Failed to save blackboard set')

            writeJson(res, {
              id: saved.id,
              set: saved.set,
              sets: await listBoardSets(persistDir, guideDir, prefilledLiveDir, savedLiveRootDir),
              state: saved.state,
            })
          }
          catch (error) {
            console.error('[blackboard] Failed to save blackboard set', error)
            writeError(res, 500, 'Failed to save blackboard set')
          }
          return
        }

        if (pathname === BLACKBOARD_RESET_LIVE_ENDPOINT && req.method === 'POST') {
          if (!persistDir)
            return writeError(res, 404, 'Live blackboard persistence is not enabled')

          try {
            const body = await readBodyJson(req).catch(() => ({})) as BlackboardResetLiveRequest
            const parsedKey = body.key ? parseBoardSetKey(body.key) : undefined
            const state = await resetLiveFromPrefilled(persistDir, prefilledLiveDir, options, body.id || parsedKey?.id || 'default')
            if (!state)
              return writeError(res, 404, 'No pre-made live blackboards were found')

            writeJson(res, state)
          }
          catch (error) {
            console.error('[blackboard] Failed to reset live blackboards', error)
            writeError(res, 500, 'Failed to reset live blackboards')
          }
          return
        }

        if (pathname === BLACKBOARD_GUIDES_ENDPOINT && req.method === 'POST') {
          if (!guideDir)
            return writeError(res, 404, 'Blackboard guides are not enabled')

          try {
            const body = await readBodyJson(req) as BlackboardPersistedState & { id?: string, name?: string }
            const id = requestUrl.searchParams.get('id') || body.id || 'default'
            const saved = await saveBoardSet('guide', guideDir, id, body.name, body, options)
            writeJson(res, saved?.state || await loadDefaultBoardSetSelection(guideDir, 'guide').then(selection => selection.state))
          }
          catch (error) {
            console.error('[blackboard] Failed to persist guides', error)
            writeError(res, 500, 'Failed to persist blackboard guides')
          }
          return
        }

        if (pathname !== BLACKBOARD_STATE_ENDPOINT || req.method !== 'POST')
          return next()

        try {
          const body = await readBodyJson(req) as BlackboardPersistedState
          await writePersistedState(persistDir, body, options)
          res.statusCode = 204
          res.end()
        }
        catch (error) {
          console.error('[blackboard] Failed to persist boards', error)
          res.statusCode = 500
          res.end('Failed to persist blackboards')
        }
      })
    },
  }
}

export default function setupBlackboardVitePlugins(options: BlackboardSetupOptions): Plugin[] {
  return [createBlackboardVitePlugin(options)]
}
