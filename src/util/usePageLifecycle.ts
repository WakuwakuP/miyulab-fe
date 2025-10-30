import { useEffect, useState } from 'react'

/**
 * Custom hook to track page visibility state using Page Lifecycle API
 * Returns whether the page is currently visible
 *
 * This is useful for optimizing WebSocket connections and other resources
 * that should be paused when the page is hidden (e.g., when user switches tabs)
 *
 * @see https://developer.chrome.com/docs/web-platform/page-lifecycle-api
 */
export const usePageLifecycle = () => {
  const [isVisible, setIsVisible] = useState<boolean>(
    typeof document !== 'undefined'
      ? document.visibilityState === 'visible'
      : true
  )

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible')
    }

    // Listen for visibility changes
    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange
    )

    return () => {
      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange
      )
    }
  }, [])

  return isVisible
}
