import { slidesTitle } from '@slidev/client'
import { customRef, reactive, ref, watch } from 'vue'

type StoredRef<T> = ReturnType<typeof ref<T>>

export function blackboardStoragePrefix() {
  const path = typeof window === 'undefined' ? '' : window.location.pathname
  const deckTitle = slidesTitle || 'slidev'
  const deckId = encodeURIComponent(`${deckTitle}:${path}`)
  return `slidev-blackboard:${deckId}`
}

export function readStoredValue<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined')
    return fallback

  const raw = window.localStorage.getItem(key)
  if (raw == null)
    return fallback

  try {
    return JSON.parse(raw) as T
  }
  catch {
    return fallback
  }
}

export function writeStoredValue<T>(key: string, value: T) {
  if (typeof window !== 'undefined')
    window.localStorage.setItem(key, JSON.stringify(value))
}

export function storedRef<T>(key: string, fallback: T): StoredRef<T> {
  let value = readStoredValue(key, fallback)
  writeStoredValue(key, value)

  return customRef<T>((track, trigger) => ({
    get() {
      track()
      return value
    },
    set(next) {
      value = next
      writeStoredValue(key, value)
      trigger()
    },
  })) as StoredRef<T>
}

export function storedReactive<T extends object>(key: string, fallback: T): T {
  const value = reactive(readStoredValue(key, fallback)) as T
  watch(value, (next) => {
    writeStoredValue(key, next)
  }, { deep: true, flush: 'sync', immediate: true })
  return value
}
