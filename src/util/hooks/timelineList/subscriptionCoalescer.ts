export function createChangeCoalescer(
  onMatched: (
    changedTables: ReadonlySet<string>,
    changedPostIds: ReadonlySet<number> | undefined,
  ) => void,
  onHintless: () => void,
): {
  dispose: () => void
  push: (options: {
    hintless: boolean
    matched: boolean
    tables?: Iterable<string>
    postIds?: Iterable<number>
  }) => void
} {
  let disposed = false
  let scheduled = false
  let hintless = false
  let hasMatch = false
  let postIdsUnknown = false
  const matchedTables = new Set<string>()
  const matchedPostIds = new Set<number>()

  return {
    dispose() {
      disposed = true
    },
    push({ hintless: h, matched, tables, postIds }) {
      if (disposed) return
      if (h) hintless = true
      if (matched) {
        hasMatch = true
        if (tables) {
          for (const t of tables) matchedTables.add(t)
        }
        if (postIds === undefined) {
          postIdsUnknown = true
        } else {
          for (const id of postIds) matchedPostIds.add(id)
        }
      }
      if (!scheduled) {
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          if (disposed) return
          const hasHintless = hintless
          hintless = false
          const matchedNow = hasMatch
          hasMatch = false
          const tables = new Set(matchedTables)
          matchedTables.clear()
          const postIds = postIdsUnknown ? undefined : new Set(matchedPostIds)
          postIdsUnknown = false
          matchedPostIds.clear()
          if (hasHintless) {
            onHintless()
            return
          }
          if (matchedNow) {
            onMatched(tables, postIds)
          }
        })
      }
    },
  }
}
