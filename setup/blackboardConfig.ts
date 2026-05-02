import path from 'node:path'
import type { BlackboardBuildOptions, BlackboardExportOptions } from '../shared/blackboardProtocol'
import { normalizeBlackboardBuildOptions, normalizeBlackboardExportOptions } from '../shared/blackboardProtocol'

interface BlackboardGuideConfig {
  enabled: boolean
  opacity: number
}

interface BlackboardConfig {
  build: BlackboardBuildOptions
  enabled: boolean
  export: BlackboardExportOptions
  guide: BlackboardGuideConfig
  persist: boolean | string | undefined
}

export interface BlackboardSetupOptions {
  data?: {
    config?: {
      aspectRatio?: number
      blackboard?: unknown
      canvasWidth?: number
    }
  }
  entry: string
  mode?: string
}

function configObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object'
    ? raw as Record<string, unknown>
    : {}
}

export function normalizeGuideConfig(raw: unknown): BlackboardGuideConfig {
  const config = configObject(raw)
  const opacity = Number(config.opacity)

  return {
    enabled: raw === true || !!(raw && typeof raw === 'object' && config.enabled !== false),
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.22,
  }
}

function normalizeModeOption(raw: unknown, mode: string | undefined, fallback: boolean) {
  if (raw == null)
    return fallback

  if (typeof raw === 'boolean')
    return raw

  if (typeof raw !== 'string')
    return fallback

  const value = raw.trim().toLowerCase()
  if (value === 'true')
    return true
  if (value === 'false')
    return false

  if (value === 'dev' || value === 'build' || value === 'export')
    return value === mode

  return fallback
}

function normalizeBlackboardEnabled(raw: unknown, config: Record<string, unknown>, mode: string | undefined) {
  const enabledSource = raw && typeof raw === 'object'
    ? config.enabled
    : raw
  const enabled = normalizeModeOption(enabledSource, mode, raw !== false)

  if (!enabled)
    return false

  if (mode === 'build')
    return normalizeModeOption(config.build, mode, true)

  if (mode === 'dev')
    return normalizeModeOption(config.dev, mode, true)

  return true
}

export function normalizeBlackboardConfig(options: BlackboardSetupOptions): BlackboardConfig {
  const raw = options.data?.config?.blackboard
  const config = configObject(raw)
  const persistSource = typeof raw === 'boolean' ? raw : config.persist
  const persist = typeof persistSource === 'boolean' || typeof persistSource === 'string'
    ? persistSource
    : undefined
  const enabled = normalizeBlackboardEnabled(raw, config, options.mode)
  const exportOptions = normalizeBlackboardExportOptions(config.export)
  const buildOptions = options.mode === 'build' && enabled
    ? normalizeBlackboardBuildOptions(config.build, exportOptions)
    : normalizeBlackboardBuildOptions(false, exportOptions)

  return {
    build: buildOptions,
    enabled,
    export: exportOptions,
    guide: normalizeGuideConfig(config.guide),
    persist,
  }
}

export function sanitizeDeckName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'deck'
}

export function resolveBlackboardRootDir(options: BlackboardSetupOptions) {
  const config = normalizeBlackboardConfig(options)
  const entryDir = path.dirname(options.entry)

  if (typeof config.persist === 'string')
    return path.dirname(path.resolve(entryDir, config.persist))

  return path.resolve(entryDir, '.slidev', 'blackboards')
}

export function resolvePersistDir(options: BlackboardSetupOptions) {
  const config = normalizeBlackboardConfig(options)
  if (!config.enabled || !config.persist)
    return undefined

  const entryDir = path.dirname(options.entry)
  if (typeof config.persist === 'string')
    return path.resolve(entryDir, config.persist)

  const deckName = sanitizeDeckName(path.basename(options.entry, path.extname(options.entry)))
  return path.resolve(resolveBlackboardRootDir(options), deckName)
}

export function resolveGuideDir(options: BlackboardSetupOptions) {
  const config = normalizeBlackboardConfig(options)
  if (!config.enabled || !config.guide.enabled)
    return undefined

  return path.resolve(resolveBlackboardRootDir(options), 'guides')
}

export function resolvePrefilledLiveDir(options: BlackboardSetupOptions) {
  return path.resolve(resolveBlackboardRootDir(options), 'prefilled-live')
}

export function resolveSavedLiveRootDir(options: BlackboardSetupOptions) {
  return path.resolve(resolveBlackboardRootDir(options), 'saved-live')
}

export function resolveExhibitDir(options: BlackboardSetupOptions) {
  return path.resolve(resolveBlackboardRootDir(options), 'exhibits')
}

export function resolvePublicDir(options: BlackboardSetupOptions) {
  return path.resolve(path.dirname(options.entry), 'public')
}
