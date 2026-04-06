'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { initAccountResolver } from 'util/accountResolver'
import { getSqliteDb } from 'util/db/sqlite/connection'
import { AppsContext } from './AppsProvider'

// ---------------------------------------------------------------------------
// フェーズ定義
// ---------------------------------------------------------------------------

/**
 * 起動フェーズ。数値の大きい方が後段。
 *
 * 1. init             — 初期状態
 * 2. db-ready         — DB マイグレーション + accountResolver 初期化完了
 * 3. timeline-displayed — DB キャッシュからのタイムライン表示完了
 * 4. rest-fetched     — REST API 取得 + DB 書き込み完了
 * 5. streaming        — WebSocket ストリーミング接続完了
 */
export type StartupPhase =
  | 'init'
  | 'db-ready'
  | 'timeline-displayed'
  | 'rest-fetched'
  | 'streaming'

const PHASE_ORDER: readonly StartupPhase[] = [
  'init',
  'db-ready',
  'timeline-displayed',
  'rest-fetched',
  'streaming',
] as const

function phaseIndex(phase: StartupPhase): number {
  return PHASE_ORDER.indexOf(phase)
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type StartupCoordinatorValue = {
  /** 現在のフェーズ */
  phase: StartupPhase
  /** 指定フェーズ以上に到達しているか */
  isPhaseReached: (target: StartupPhase) => boolean
  /** フェーズを進める（逆行は無視） */
  advanceTo: (target: StartupPhase) => void
}

export const StartupCoordinatorContext = createContext<StartupCoordinatorValue>(
  {
    advanceTo: () => {},
    isPhaseReached: () => false,
    phase: 'init',
  },
)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const StartupCoordinator = ({ children }: { children: ReactNode }) => {
  const apps = useContext(AppsContext)
  const [phase, setPhase] = useState<StartupPhase>('init')
  const refFirstRef = useRef(true)

  const advanceTo = useCallback((target: StartupPhase) => {
    setPhase((prev) => {
      const prevIdx = phaseIndex(prev)
      const targetIdx = phaseIndex(target)
      return targetIdx > prevIdx ? target : prev
    })
  }, [])

  const isPhaseReached = useCallback(
    (target: StartupPhase) => {
      return phaseIndex(phase) >= phaseIndex(target)
    },
    [phase],
  )

  // Phase 1: DB 初期化 + accountResolver
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && refFirstRef.current) {
      refFirstRef.current = false
      return
    }
    if (apps.length <= 0) return

    let cancelled = false

    const init = async () => {
      try {
        // DB 接続（Worker spawn + マイグレーション）を待つ
        await getSqliteDb()

        // local_accounts キャッシュを構築
        // useGraphTimeline の useLocalAccountIds が依存する
        await initAccountResolver()

        if (!cancelled) {
          advanceTo('db-ready')
        }
      } catch (error) {
        console.error('[StartupCoordinator] DB initialization failed:', error)
        // フォールバック: エラーでも db-ready に遷移して他の Provider をブロックしない
        if (!cancelled) {
          advanceTo('db-ready')
        }
      }
    }

    init()

    return () => {
      cancelled = true
    }
  }, [apps, advanceTo])

  const value = useMemo<StartupCoordinatorValue>(
    () => ({ advanceTo, isPhaseReached, phase }),
    [phase, advanceTo, isPhaseReached],
  )

  return (
    <StartupCoordinatorContext.Provider value={value}>
      {children}
    </StartupCoordinatorContext.Provider>
  )
}
