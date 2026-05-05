import type { Ref } from 'vue'

export type BlackboardLazyMode = 'live' | 'guide'

export function createBlackboardTiming(enabled: boolean) {
  function log(label: string, startedAt: number) {
    if (enabled)
      console.debug(`[blackboard timing] ${label}: ${Math.round((performance.now() - startedAt) * 10) / 10} ms`)
  }

  async function timed<T>(label: string, callback: () => Promise<T>) {
    const startedAt = performance.now()
    try {
      return await callback()
    }
    finally {
      log(label, startedAt)
    }
  }

  return {
    log,
    timed,
  }
}

export function createBoardLoadingTracker(
  initialLiveIds: Iterable<string>,
  initialGuideIds: Iterable<string>,
  version: Ref<number>,
) {
  const loaded = {
    guide: new Set(initialGuideIds),
    live: new Set(initialLiveIds),
  }
  const loading = {
    guide: new Set<string>(),
    live: new Set<string>(),
  }

  function touch() {
    version.value += 1
  }

  function loadedIds(mode: BlackboardLazyMode) {
    return loaded[mode]
  }

  function isLoaded(mode: BlackboardLazyMode, boardId: string | undefined) {
    version.value
    return !boardId || loaded[mode].has(boardId)
  }

  function isLoading(mode: BlackboardLazyMode, boardId: string | undefined) {
    version.value
    return !!boardId && !isLoaded(mode, boardId) && loading[mode].has(boardId)
  }

  function markLoaded(mode: BlackboardLazyMode, boardIds: Iterable<string>) {
    for (const id of boardIds) {
      if (id)
        loaded[mode].add(id)
    }
    touch()
  }

  function markLoading(mode: BlackboardLazyMode, boardId: string, value: boolean) {
    if (value)
      loading[mode].add(boardId)
    else
      loading[mode].delete(boardId)
    touch()
  }

  function remove(mode: BlackboardLazyMode, boardId: string) {
    loaded[mode].delete(boardId)
    loading[mode].delete(boardId)
    touch()
  }

  return {
    isLoaded,
    isLoading,
    loadedIds,
    markLoaded,
    markLoading,
    remove,
  }
}

export function unloadedNeighborFirstIds<T extends { id: string }>(
  boards: T[],
  activeId: string,
  isLoaded: (id: string) => boolean,
) {
  const activeIndex = boards.findIndex(board => board.id === activeId)
  const ordered = [
    boards[activeIndex - 1],
    boards[activeIndex + 1],
    ...boards,
  ].filter(Boolean) as T[]
  const seen = new Set<string>()

  return ordered.flatMap((board) => {
    if (seen.has(board.id) || isLoaded(board.id))
      return []

    seen.add(board.id)
    return [board.id]
  })
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
