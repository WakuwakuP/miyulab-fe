'use client'

import { useContext, useEffect, useState } from 'react'
import type { DbDiagnosticTransportStatus } from 'util/db/dbDiagnosticTransport'
import {
  acquireDbDiagnosticUploader,
  isDbDiagnosticsClientEnabled,
  updateDbDiagnosticApps,
} from 'util/db/dbDiagnosticUploader'
import { AppsContext } from 'util/provider/AppsProvider'

export function useDbDiagnosticUploader(
  syncOwnerApps = false,
): DbDiagnosticTransportStatus | null {
  const apps = useContext(AppsContext)
  const [status, setStatus] = useState<DbDiagnosticTransportStatus | null>(null)

  useEffect(() => {
    if (!syncOwnerApps) return
    updateDbDiagnosticApps(apps)
    return () => updateDbDiagnosticApps([])
  }, [apps, syncOwnerApps])

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
