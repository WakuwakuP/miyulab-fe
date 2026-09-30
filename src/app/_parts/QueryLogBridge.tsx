'use client'

/**
 * スロークエリログの Worker → Server Action ブリッジコンポーネント
 *
 * レイアウトに配置して、Worker からのスロークエリ通知を
 * Server Action に転送する。レンダリング出力は持たない。
 */

import { useDbDiagnosticUploader } from 'hooks/useDbDiagnosticUploader'
import { useWorkerQueryLogBridge } from 'hooks/useWorkerQueryLogBridge'

export function QueryLogBridge() {
  useWorkerQueryLogBridge()
  useDbDiagnosticUploader()
  return null
}
