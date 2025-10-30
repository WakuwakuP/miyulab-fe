import { useEffect, useState } from 'react'

/**
 * Page lifecycle state type
 * @see https://developer.chrome.com/docs/web-platform/page-lifecycle-api
 */
export type PageLifecycleState =
  | 'active' // Page is visible and has focus
  | 'passive' // Page is visible but doesn't have focus
  | 'hidden' // Page is not visible (backgrounded/minimized)
  | 'frozen' // Page is suspended to save resources
  | 'terminated' // Page is being unloaded

export type PageLifecycleInfo = {
  /** Current lifecycle state */
  state: PageLifecycleState
  /** Whether the page is currently visible (active or passive) */
  isVisible: boolean
  /** Whether the page is frozen */
  isFrozen: boolean
  /** Timestamp when the page was last hidden (null if currently visible) */
  lastHiddenAt: number | null
  /** Timestamp when the page was last frozen (null if not frozen) */
  lastFrozenAt: number | null
}

/**
 * Custom hook to track page lifecycle state using Page Lifecycle API
 * Tracks all lifecycle states including visibility, focus, freeze, and termination
 *
 * This is useful for optimizing WebSocket connections and other resources
 * that should be paused when the page is hidden or frozen
 *
 * @see https://developer.chrome.com/docs/web-platform/page-lifecycle-api
 */
export const usePageLifecycle = (): PageLifecycleInfo => {
  const getInitialState = (): PageLifecycleState => {
    if (typeof document === 'undefined') return 'active'

    if (document.visibilityState === 'hidden') {
      return 'hidden'
    }

    return document.hasFocus() ? 'active' : 'passive'
  }

  const [state, setState] =
    useState<PageLifecycleState>(getInitialState)
  const [lastHiddenAt, setLastHiddenAt] = useState<
    number | null
  >(null)
  const [lastFrozenAt, setLastFrozenAt] = useState<
    number | null
  >(null)

  useEffect(() => {
    // Check if we're in a browser environment
    if (typeof document === 'undefined') return

    const updateState = () => {
      if (document.visibilityState === 'hidden') {
        setState('hidden')
        setLastHiddenAt(Date.now())
      } else {
        setState(document.hasFocus() ? 'active' : 'passive')
        setLastHiddenAt(null)
      }
    }

    const handleVisibilityChange = () => {
      updateState()
    }

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        setState('active')
      }
    }

    const handleBlur = () => {
      if (document.visibilityState === 'visible') {
        setState('passive')
      }
    }

    const handleFreeze = () => {
      setState('frozen')
      setLastFrozenAt(Date.now())
    }

    const handleResume = () => {
      setLastFrozenAt(null)
      updateState()
    }

    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) {
        // Page is going into back/forward cache
        setState('frozen')
        setLastFrozenAt(Date.now())
      } else {
        // Page is being unloaded
        setState('terminated')
      }
    }

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        // Page is being restored from back/forward cache
        setLastFrozenAt(null)
        updateState()
      }
    }

    // Listen for visibility changes
    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange
    )

    // Listen for focus changes
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    // Listen for freeze/resume events (for page lifecycle)
    document.addEventListener('freeze', handleFreeze)
    document.addEventListener('resume', handleResume)

    // Listen for page hide/show (for back/forward cache)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange
      )
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('freeze', handleFreeze)
      document.removeEventListener('resume', handleResume)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])

  return {
    state,
    isVisible: state === 'active' || state === 'passive',
    isFrozen: state === 'frozen',
    lastHiddenAt,
    lastFrozenAt,
  }
}
