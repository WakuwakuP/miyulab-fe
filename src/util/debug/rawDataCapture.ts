import type { Backend } from 'types/types'

// ============================================================
// Types
// ============================================================

export type CaptureSource = 'stream' | 'api'

export type CapturedEvent = {
  /** Auto-incremented by IndexedDB */
  id?: number
  /** ISO 8601 timestamp */
  capturedAt: string
  /** Where the data came from */
  source: CaptureSource
  /** Which library produced this data */
  origin: 'megalodon' | 'misskey-js'
  /** Backend SNS type */
  backend: Backend
  /** Server base URL */
  backendUrl: string
  /**
   * Event or endpoint name.
   *   stream: 'update' | 'status_update' | 'notification' | 'delete' | 'note' | etc.
   *   api:    'getHomeTimeline' | 'getNotifications' | 'raw:notes/timeline' | etc.
   */
  eventType: string
  /**
   * For stream events: 'home' | 'local' | 'public' | 'tag' | 'main'
   * For API events: the endpoint name
   */
  streamType?: string
  /** Tag (for tag streams / tag timeline API) */
  tag?: string
  /** The raw data before any transformation */
  rawData: unknown
  /** The data after mapping (e.g. Misskey Note → megalodon Entity) */
  convertedData?: unknown
  /** Number of items (for array responses) */
  dataCount?: number
}

export type CaptureStats = {
  total: number
  stream: number
  api: number
}

export type ExportFilter = 'all' | 'stream' | 'api'

export type RawCaptureExport = {
  exportedAt: string
  appVersion: string
  filter: ExportFilter
  metadata: {
    totalEvents: number
    backends: string[]
    servers: string[]
    dateRange: {
      earliest: string
      latest: string
    }
  }
  events: CapturedEvent[]
}

// ============================================================
// Constants
// ============================================================

const DB_NAME = 'miyulab-raw-capture'
const DB_VERSION = 1
const STORE_NAME = 'events'

/** Maximum number of events to keep — older events are discarded */
const MAX_EVENTS = 10_000

// ============================================================
// Module state
// ============================================================

let captureEnabled = false
let dbInstance: IDBDatabase | null = null
let dbOpenPromise: Promise<IDBDatabase> | null = null

// ============================================================
// Enable / disable
// ============================================================

export function setRawDataCaptureEnabled(enabled: boolean): void {
  captureEnabled = enabled
  if (enabled) {
    // Eagerly open DB so first capture is fast
    getDb().catch(() => {})
  }
}

export function isRawDataCaptureEnabled(): boolean {
  return captureEnabled
}

// ============================================================
// IndexedDB helpers
// ============================================================

function getDb(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)
  if (dbOpenPromise) return dbOpenPromise

  dbOpenPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          autoIncrement: true,
          keyPath: 'id',
        })
        store.createIndex('source', 'source', { unique: false })
        store.createIndex('capturedAt', 'capturedAt', { unique: false })
        store.createIndex('backend', 'backend', { unique: false })
      }
    }

    request.onsuccess = () => {
      dbInstance = request.result
      dbInstance.onclose = () => {
        dbInstance = null
        dbOpenPromise = null
      }
      resolve(dbInstance)
    }

    request.onerror = () => {
      dbOpenPromise = null
      reject(request.error)
    }
  })

  return dbOpenPromise
}

// ============================================================
// Write — fire-and-forget capture
// ============================================================

/**
 * Capture a stream event. Fails silently if capture is disabled or DB errors.
 */
export function captureStreamEvent(params: {
  origin: 'megalodon' | 'misskey-js'
  backend: Backend
  backendUrl: string
  eventType: string
  streamType: string
  tag?: string
  rawData: unknown
  convertedData?: unknown
}): void {
  if (!captureEnabled) return

  const event: CapturedEvent = {
    ...params,
    capturedAt: new Date().toISOString(),
    source: 'stream',
  }

  persistEvent(event)
}

/**
 * Capture an API response. Fails silently if capture is disabled or DB errors.
 */
export function captureApiResponse(params: {
  origin: 'megalodon' | 'misskey-js'
  backend: Backend
  backendUrl: string
  eventType: string
  rawData: unknown
  convertedData?: unknown
  dataCount?: number
}): void {
  if (!captureEnabled) return

  const event: CapturedEvent = {
    ...params,
    capturedAt: new Date().toISOString(),
    source: 'api',
  }

  persistEvent(event)
}

function persistEvent(event: CapturedEvent): void {
  getDb()
    .then((db) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.add(event)

      tx.oncomplete = () => {
        // Prune old events if over limit (best-effort, non-blocking)
        pruneIfNeeded(db)
      }
    })
    .catch((err) => {
      console.warn('[rawDataCapture] Failed to persist event:', err)
    })
}

function pruneIfNeeded(db: IDBDatabase): void {
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const countReq = store.count()

    countReq.onsuccess = () => {
      const count = countReq.result
      if (count <= MAX_EVENTS) return

      const deleteCount = count - MAX_EVENTS
      const cursorReq = store.openCursor()
      let deleted = 0

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor && deleted < deleteCount) {
          cursor.delete()
          deleted++
          cursor.continue()
        }
      }
    }
  } catch {
    // Ignore pruning errors
  }
}

// ============================================================
// Read — stats and export
// ============================================================

export async function getCaptureStats(): Promise<CaptureStats> {
  try {
    const db = await getDb()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('source')

    const [total, stream, api] = await Promise.all([
      idbCount(store),
      idbCount(index, IDBKeyRange.only('stream')),
      idbCount(index, IDBKeyRange.only('api')),
    ])

    return { api, stream, total }
  } catch {
    return { api: 0, stream: 0, total: 0 }
  }
}

export async function buildExport(
  filter: ExportFilter,
): Promise<RawCaptureExport> {
  const db = await getDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const store = tx.objectStore(STORE_NAME)

  let events: CapturedEvent[]

  if (filter === 'all') {
    events = await idbGetAll<CapturedEvent>(store)
  } else {
    const index = store.index('source')
    events = await idbGetAll<CapturedEvent>(index, IDBKeyRange.only(filter))
  }

  // Sort ascending by capturedAt
  events.sort(
    (a, b) =>
      new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
  )

  const backends = [...new Set(events.map((e) => e.backend))]
  const servers = [...new Set(events.map((e) => e.backendUrl))]

  return {
    appVersion: 'miyulab-fe',
    events,
    exportedAt: new Date().toISOString(),
    filter,
    metadata: {
      backends,
      dateRange: {
        earliest: events[0]?.capturedAt ?? '',
        latest: events[events.length - 1]?.capturedAt ?? '',
      },
      servers,
      totalEvents: events.length,
    },
  }
}

export function downloadJson(data: RawCaptureExport): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d+Z$/, '')

  const a = document.createElement('a')
  a.href = url
  a.download = `miyulab-raw-${data.filter}-${timestamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  URL.revokeObjectURL(url)
}

export async function clearCaptureData(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  store.clear()
  await idbTxComplete(tx)
}

// ============================================================
// Low-level IDB promise wrappers
// ============================================================

function idbCount(
  source: IDBObjectStore | IDBIndex,
  query?: IDBKeyRange,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = query ? source.count(query) : source.count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbGetAll<T>(
  source: IDBObjectStore | IDBIndex,
  query?: IDBKeyRange,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = query ? source.getAll(query) : source.getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

function idbTxComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
