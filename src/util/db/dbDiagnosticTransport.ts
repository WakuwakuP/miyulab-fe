import {
  type DbDiagnosticRecorder,
  getDbDiagnosticSessionId,
} from './dbDiagnostics'
import {
  DB_DIAGNOSTIC_BATCH_SIZE,
  DB_DIAGNOSTIC_MAX_WINDOWS,
  type DbDiagnosticWindow,
} from './dbDiagnosticTypes'

export type DbDiagnosticSaveResult =
  | { success: true; accepted: number; count: number }
  | { success: false; error: string }
export type DbDiagnosticTransportStatus = {
  sessionId: string
  pendingWindows: number
  uploading: boolean
  savedWindows: number
  lastSavedAt: string | null
  lastError: string | null
}

export class DbDiagnosticTransport {
  private readonly windows = new Map<number, DbDiagnosticWindow>()
  private readonly sending = new Set<number>()
  private readonly listeners = new Set<() => void>()
  private uploading = false
  private savedWindows = 0
  private lastSavedAt: string | null = null
  private lastError: string | null = null
  readonly sessionId: string

  constructor(
    private readonly recorder: DbDiagnosticRecorder,
    private readonly submit: (
      sessionId: string,
      windows: DbDiagnosticWindow[],
    ) => Promise<DbDiagnosticSaveResult>,
    sessionId = getDbDiagnosticSessionId(),
  ) {
    this.sessionId = sessionId
  }

  getStatus(): DbDiagnosticTransportStatus {
    return {
      lastError: this.lastError,
      lastSavedAt: this.lastSavedAt,
      pendingWindows: this.windows.size,
      savedWindows: this.savedWindows,
      sessionId: this.sessionId,
      uploading: this.uploading,
    }
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  async captureAndFlush(): Promise<void> {
    const window = this.recorder.capture()
    if (window) {
      if (this.windows.size >= DB_DIAGNOSTIC_MAX_WINDOWS) {
        const oldest = [...this.windows.keys()].find(
          (sequence) => !this.sending.has(sequence),
        )
        if (oldest !== undefined) {
          this.windows.delete(oldest)
          this.recorder.recordDroppedWindow()
        }
      }
      this.windows.set(window.sequence, window)
    }
    this.notify()
    await this.flush()
  }

  async flush(): Promise<void> {
    if (this.uploading || !this.windows.size) return
    this.uploading = true
    const batch = [...this.windows.values()].slice(0, DB_DIAGNOSTIC_BATCH_SIZE)
    for (const window of batch) this.sending.add(window.sequence)
    this.notify()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        this.submit(this.sessionId, batch),
        new Promise<DbDiagnosticSaveResult>((resolve) => {
          timer = setTimeout(
            () =>
              resolve({ error: 'Diagnostic upload timed out', success: false }),
            30_000,
          )
        }),
      ])
      if (!response.success || response.accepted !== batch.length) {
        this.lastError = response.success
          ? 'Incomplete diagnostic acknowledgement'
          : response.error
        this.recorder.recordTransportFailure()
        return
      }
      for (const window of batch) this.windows.delete(window.sequence)
      this.savedWindows += batch.length
      this.lastSavedAt = new Date().toISOString()
      this.lastError = null
    } catch {
      this.lastError = 'Diagnostic upload failed'
      this.recorder.recordTransportFailure()
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      this.sending.clear()
      this.uploading = false
      this.notify()
    }
  }
}
