import type {
  BlackboardBoardSetKind,
  BlackboardBoardSetListResponse,
  BlackboardBoardSetSummary,
  BlackboardExhibit,
  BlackboardInitialState,
  BlackboardMermaidSourceExhibit,
  BlackboardPersistedState,
  BlackboardRenderedExhibit,
  BlackboardSvgSourceExhibit,
} from '../shared/blackboardProtocol'
import { normalizeExhibitKind, normalizeExhibitPlacement } from './svgExhibitPlacement'
import { renderMermaidExhibit } from './mermaidExhibits'
import { renderSvgExhibit } from './svgFileExhibits'

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  })

  if (!response.ok)
    throw new Error(await response.text() || `Request failed with status ${response.status}`)

  return await response.json() as T
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
  })

  if (!response.ok)
    throw new Error(await response.text() || `Request failed with status ${response.status}`)

  return await response.json() as T
}

export async function fetchBoardSet(endpoint: string, key: string, activate = false) {
  const params = new URLSearchParams({ key })
  if (activate)
    params.set('activate', 'true')
  return await getJson<BlackboardInitialState>(`${endpoint}?${params.toString()}`)
}

export async function fetchBoardSets(endpoint: string) {
  return await getJson<BlackboardBoardSetListResponse>(endpoint)
}

export async function deleteBoardSet(endpoint: string, key: string) {
  const params = new URLSearchParams({ key })
  const response = await fetch(`${endpoint}?${params.toString()}`, {
    method: 'DELETE',
  })

  if (!response.ok)
    throw new Error(await response.text() || `Request failed with status ${response.status}`)

  return await response.json() as BlackboardBoardSetListResponse
}

export async function saveBoardSet(
  endpoint: string,
  kind: Exclude<BlackboardBoardSetKind, 'current-live'>,
  target: { id?: string, name?: string },
  state: BlackboardPersistedState,
) {
  return await postJson<{
    id?: string
    set?: BlackboardBoardSetSummary
    sets?: BlackboardBoardSetSummary[]
    state?: BlackboardInitialState
  }>(endpoint, {
    id: target.id,
    kind,
    name: target.name,
    state,
  })
}

export async function resetLiveBoardSet(endpoint: string, key?: string) {
  return await postJson<BlackboardInitialState>(endpoint, {
    key,
  })
}

export async function loadExhibitPayload(endpoint: string, exhibit: BlackboardExhibit) {
  const payload = await getJson<BlackboardRenderedExhibit | BlackboardMermaidSourceExhibit | BlackboardSvgSourceExhibit>(`${endpoint}?id=${encodeURIComponent(exhibit.id)}`)
  const kind = normalizeExhibitKind(payload.kind || exhibit.kind)
  if (kind === 'mermaid' && 'source' in payload)
    return await renderMermaidExhibit(payload)
  if (kind === 'svg' && 'source' in payload)
    return renderSvgExhibit(payload)

  return {
    ...payload,
    kind,
    placement: normalizeExhibitPlacement((payload as BlackboardRenderedExhibit).placement),
  } as BlackboardRenderedExhibit
}
