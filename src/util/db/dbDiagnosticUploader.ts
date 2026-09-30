import { createDbDiagnosticLogs } from 'app/actions/dbDiagnostics.server'
import {
  authorizeDbDiagnostics,
  getDbDiagnosticAuthorizationTarget,
} from 'app/actions/dbDiagnosticsAuth.server'
import type { App } from 'types/types'
import { createDbDiagnosticAuthorizer } from './dbDiagnosticAuth'
import { dbDiagnosticRecorder } from './dbDiagnostics'
import {
  type DbDiagnosticSaveResult,
  DbDiagnosticTransport,
} from './dbDiagnosticTransport'
import {
  DB_DIAGNOSTIC_WINDOW_MS,
  type DbDiagnosticWindow,
} from './dbDiagnosticTypes'

let transport: DbDiagnosticTransport | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let pagehideHandler: (() => void) | null = null
let visibilityHandler: (() => void) | null = null
let subscriberCount = 0
let currentApps: App[] = []

export function updateDbDiagnosticApps(apps: App[]): void {
  currentApps = apps
}

export const ensureDbDiagnosticAuthorization = createDbDiagnosticAuthorizer({
  apps: () => currentApps,
  authorize: authorizeDbDiagnostics,
  getTarget: getDbDiagnosticAuthorizationTarget,
})

export function isDbDiagnosticsClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DB_DIAGNOSTICS_ENABLED !== 'false'
}

async function submitWithOwnerAuthorization(
  sessionId: string,
  windows: DbDiagnosticWindow[],
): Promise<DbDiagnosticSaveResult> {
  try {
    await ensureDbDiagnosticAuthorization()
  } catch {
    return { error: 'Owner authorization required', success: false }
  }
  return createDbDiagnosticLogs(sessionId, windows)
}

function flush(): void {
  void transport?.captureAndFlush()
}

export function acquireDbDiagnosticUploader(): {
  release: () => void
  transport: DbDiagnosticTransport
} {
  transport ??= new DbDiagnosticTransport(
    dbDiagnosticRecorder,
    submitWithOwnerAuthorization,
  )
  if (intervalId == null) {
    intervalId = setInterval(flush, DB_DIAGNOSTIC_WINDOW_MS)
    if (typeof globalThis.addEventListener === 'function') {
      pagehideHandler = flush
      globalThis.addEventListener('pagehide', pagehideHandler)
    }
    if (typeof document !== 'undefined') {
      visibilityHandler = () => {
        if (document.visibilityState === 'hidden') flush()
      }
      document.addEventListener('visibilitychange', visibilityHandler)
    }
  }
  subscriberCount++

  let released = false
  const release = (): void => {
    if (released) return
    released = true
    subscriberCount--
    if (subscriberCount > 0) return
    subscriberCount = 0
    if (intervalId != null) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (pagehideHandler != null) {
      globalThis.removeEventListener('pagehide', pagehideHandler)
      pagehideHandler = null
    }
    if (visibilityHandler != null) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  return { release, transport }
}
