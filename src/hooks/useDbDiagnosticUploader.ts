'use client'

import { useEffect, useState } from 'react'
import type { DbDiagnosticTransportStatus } from 'util/db/dbDiagnosticTransport'
import {
  acquireDbDiagnosticUploader,
  isDbDiagnosticsClientEnabled,
} from 'util/db/dbDiagnosticUploader'

export function useDbDiagnosticUploader(): DbDiagnosticTransportStatus | null {
  const [status, setStatus] = useState<DbDiagnosticTransportStatus | null>(null)

  useEffect(() => {
    if (!isDbDiagnosticsClientEnabled()) return
    const { release, transport } = acquireDbDiagnosticUploader()
    setStatus(transport.getStatus())
    const unsubscribe = transport.subscribe(() => {
      setStatus(transport.getStatus())
    })
    return () => {
      unsubscribe()
      release()
    }
  }, [])

  return status
}
