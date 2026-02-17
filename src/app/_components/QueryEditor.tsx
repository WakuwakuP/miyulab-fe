'use client'

import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  getDistinctColumnValues,
  getDistinctJsonValues,
  getDistinctTags,
  getDistinctTimelineTypes,
  getJsonKeysFromSample,
  QUERY_COMPLETIONS,
  validateCustomQuery,
} from 'util/db/sqlite/statusStore'

type QueryEditorProps = {
  onChange: (value: string) => void
  value: string
}

/**
 * SQL WHERE 句入力欄（補完付き）
 *
 * テーブルエイリアス (s., stt., sbt.) を入力すると
 * カラム名の補完候補を表示する。
 * `$.` を入力すると json_extract パスの補完候補を表示する。
 * `sbt.tag = '` や `stt.timelineType = '` の後に
 * DB 内の実データ値の補完候補を表示する。
 * SQL キーワード・関数の補完も提供する。
 */
export const QueryEditor = ({ onChange, value }: QueryEditorProps) => {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [dynamicTags, setDynamicTags] = useState<string[]>([])
  const [dynamicTimelineTypes, setDynamicTimelineTypes] = useState<string[]>([])
  const [dynamicJsonPaths, setDynamicJsonPaths] = useState<string[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // DB から動的データを取得
  useEffect(() => {
    getDistinctTags().then(setDynamicTags)
    getDistinctTimelineTypes().then(setDynamicTimelineTypes)
    getJsonKeysFromSample(20).then(setDynamicJsonPaths)
  }, [])

  // 全ての補完候補を事前に構築
  const allCompletions = useMemo(() => {
    const items: string[] = []

    // テーブルエイリアス付きカラム名
    for (const alias of QUERY_COMPLETIONS.aliases) {
      const cols =
        QUERY_COMPLETIONS.columns[
          alias as keyof typeof QUERY_COMPLETIONS.columns
        ]
      for (const col of cols) {
        items.push(`${alias}.${col}`)
      }
    }

    // SQL キーワード
    items.push(...QUERY_COMPLETIONS.keywords)

    return items
  }, [])

  // クエリ変更時にバリデーション（デバウンス）
  useEffect(() => {
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current)
    }

    if (!value.trim()) {
      setValidationError(null)
      return
    }

    validationTimerRef.current = setTimeout(async () => {
      setIsValidating(true)
      const error = await validateCustomQuery(value)
      setValidationError(error)
      setIsValidating(false)
    }, 500)

    return () => {
      if (validationTimerRef.current) {
        clearTimeout(validationTimerRef.current)
      }
    }
  }, [value])

  // JSON パス候補をマージ（静的 + 動的）
  const mergedJsonPaths = useMemo(() => {
    const pathSet = new Set<string>(QUERY_COMPLETIONS.jsonPaths)
    for (const p of dynamicJsonPaths) {
      pathSet.add(p)
    }
    return Array.from(pathSet).sort()
  }, [dynamicJsonPaths])

  const updateSuggestions = useCallback(
    (text: string, cursorPos: number) => {
      // カーソル位置の直前のワードを取得
      const beforeCursor = text.slice(0, cursorPos)

      // `$.` パス補完のチェック（json_extract 内の `'$.` に続くパス）
      const jsonPathMatch = beforeCursor.match(/'\$\.[\w.[\]]*$/)
      if (jsonPathMatch) {
        const currentPath = jsonPathMatch[0].slice(1) // 先頭の `'` を除去
        const filtered = mergedJsonPaths.filter((item) =>
          item.toLowerCase().startsWith(currentPath.toLowerCase()),
        )
        if (filtered.length > 0) {
          setSuggestions(filtered.slice(0, 12))
          setSelectedIndex(0)
          setShowSuggestions(true)
          return
        }
      }

      // json_extract 値補完: json_extract(s.json, '$.path') = ' の後
      const jsonValueMatch = beforeCursor.match(
        /json_extract\s*\(\s*s\.json\s*,\s*'(\$[.\w[\]]+)'\s*\)\s*(?:=|!=|<>)\s*'([^']*)$/i,
      )
      if (jsonValueMatch) {
        const jsonPath = jsonValueMatch[1]
        const partial = jsonValueMatch[2].toLowerCase()
        // 非同期で値を取得してサジェスト
        void getDistinctJsonValues(jsonPath).then((values) => {
          const filtered = values.filter((v) =>
            v.toLowerCase().startsWith(partial),
          )
          if (filtered.length > 0) {
            setSuggestions(filtered.slice(0, 12))
            setSelectedIndex(0)
            setShowSuggestions(true)
          }
        })
        return
      }

      // タグ値補完: sbt.tag = ' または sbt.tag IN ('..., ' の後
      const tagValueMatch = beforeCursor.match(
        /sbt\.tag\s*(?:=|IN\s*\((?:'[^']*',\s*)*)\s*'([^']*)$/i,
      )
      if (tagValueMatch) {
        const partial = tagValueMatch[1].toLowerCase()
        const filtered = dynamicTags.filter((t) =>
          t.toLowerCase().startsWith(partial),
        )
        if (filtered.length > 0) {
          setSuggestions(filtered.slice(0, 12))
          setSelectedIndex(0)
          setShowSuggestions(true)
          return
        }
      }

      // タイムラインタイプ値補完: stt.timelineType = ' の後
      const timelineValueMatch = beforeCursor.match(
        /stt\.timelineType\s*(?:=|IN\s*\((?:'[^']*',\s*)*)\s*'([^']*)$/i,
      )
      if (timelineValueMatch) {
        const partial = timelineValueMatch[1].toLowerCase()
        const filtered = dynamicTimelineTypes.filter((t) =>
          t.toLowerCase().startsWith(partial),
        )
        if (filtered.length > 0) {
          setSuggestions(filtered.slice(0, 12))
          setSelectedIndex(0)
          setShowSuggestions(true)
          return
        }
      }

      // カラム値補完: s.backendUrl = ' の後
      const columnValueMatch = beforeCursor.match(
        /s\.backendUrl\s*(?:=|IN\s*\((?:'[^']*',\s*)*)\s*'([^']*)$/i,
      )
      if (columnValueMatch) {
        const partial = columnValueMatch[1].toLowerCase()
        void getDistinctColumnValues('statuses', 'backendUrl').then(
          (values) => {
            const filtered = values.filter((v) =>
              v.toLowerCase().startsWith(partial),
            )
            if (filtered.length > 0) {
              setSuggestions(filtered.slice(0, 12))
              setSelectedIndex(0)
              setShowSuggestions(true)
            }
          },
        )
        return
      }

      const match = beforeCursor.match(/[\w.]*$/)
      const currentWord = match ? match[0] : ''

      if (currentWord.length < 1) {
        setShowSuggestions(false)
        return
      }

      const filtered = allCompletions.filter((item) =>
        item.toLowerCase().startsWith(currentWord.toLowerCase()),
      )

      if (
        filtered.length > 0 &&
        filtered[0].toLowerCase() !== currentWord.toLowerCase()
      ) {
        setSuggestions(filtered.slice(0, 8))
        setSelectedIndex(0)
        setShowSuggestions(true)
      } else {
        setShowSuggestions(false)
      }
    },
    [allCompletions, dynamicTags, dynamicTimelineTypes, mergedJsonPaths],
  )

  const applySuggestion = useCallback(
    (suggestion: string) => {
      const textarea = inputRef.current
      if (!textarea) return

      const cursorPos = textarea.selectionStart
      const text = value
      const beforeCursor = text.slice(0, cursorPos)
      const afterCursor = text.slice(cursorPos)

      // `$.` パス補完の場合
      const jsonPathMatch = beforeCursor.match(/'\$\.[\w.[\]]*$/)
      if (jsonPathMatch) {
        const matchStart = beforeCursor.length - jsonPathMatch[0].length + 1 // `'` の次
        const newBeforeCursor = beforeCursor.slice(0, matchStart)
        const newValue = `${newBeforeCursor}${suggestion}${afterCursor}`
        onChange(newValue)
        setShowSuggestions(false)

        const newPos = newBeforeCursor.length + suggestion.length
        requestAnimationFrame(() => {
          textarea.setSelectionRange(newPos, newPos)
          textarea.focus()
        })
        return
      }

      // 値補完の場合（タグ、タイムラインタイプ、json_extract値、カラム値）
      const tagValueMatch = beforeCursor.match(
        /sbt\.tag\s*(?:=|IN\s*\((?:'[^']*',\s*)*)\s*'([^']*)$/i,
      )
      const timelineValueMatch = beforeCursor.match(
        /stt\.timelineType\s*(?:=|IN\s*\((?:'[^']*',\s*)*)\s*'([^']*)$/i,
      )
      const jsonValueMatch = beforeCursor.match(
        /json_extract\s*\(\s*s\.json\s*,\s*'\$[.\w[\]]+'\s*\)\s*(?:=|!=|<>)\s*'([^']*)$/i,
      )
      const columnValueMatch = beforeCursor.match(
        /s\.backendUrl\s*(?:=|IN\s*\((?:'[^']*',\s*)*)\s*'([^']*)$/i,
      )
      const valueMatch =
        tagValueMatch ||
        timelineValueMatch ||
        jsonValueMatch ||
        columnValueMatch
      if (valueMatch) {
        const matchedPartial = valueMatch[1]
        const replaceStart = beforeCursor.length - matchedPartial.length
        const newBeforeCursor = beforeCursor.slice(0, replaceStart)
        const newValue = `${newBeforeCursor}${suggestion}${afterCursor}`
        onChange(newValue)
        setShowSuggestions(false)

        const newPos = newBeforeCursor.length + suggestion.length
        requestAnimationFrame(() => {
          textarea.setSelectionRange(newPos, newPos)
          textarea.focus()
        })
        return
      }

      // 通常の補完
      const match = beforeCursor.match(/[\w.]*$/)
      const currentWordLen = match ? match[0].length : 0
      const newBeforeCursor = beforeCursor.slice(
        0,
        -currentWordLen || undefined,
      )

      const newValue = `${currentWordLen > 0 ? newBeforeCursor : beforeCursor}${suggestion}${afterCursor}`
      onChange(newValue)
      setShowSuggestions(false)

      // カーソル位置を更新
      const newPos =
        (currentWordLen > 0 ? newBeforeCursor.length : beforeCursor.length) +
        suggestion.length
      requestAnimationFrame(() => {
        textarea.setSelectionRange(newPos, newPos)
        textarea.focus()
      })
    },
    [value, onChange],
  )

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      onChange(newValue)
      updateSuggestions(newValue, e.target.selectionStart)
    },
    [onChange, updateSuggestions],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showSuggestions) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0,
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1,
          )
          break
        case 'Tab':
        case 'Enter':
          if (suggestions[selectedIndex]) {
            e.preventDefault()
            applySuggestion(suggestions[selectedIndex])
          }
          break
        case 'Escape':
          setShowSuggestions(false)
          break
      }
    },
    [showSuggestions, suggestions, selectedIndex, applySuggestion],
  )

  // クリックで候補を選択
  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      applySuggestion(suggestion)
    },
    [applySuggestion],
  )

  // 外部クリックで閉じる
  useEffect(() => {
    const handleClickOutside = () => setShowSuggestions(false)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  return (
    <div className="space-y-1">
      <div className="relative">
        <textarea
          className={`w-full rounded bg-gray-700 px-2 py-1 text-sm text-white font-mono resize-y min-h-[60px] ${
            validationError
              ? 'border border-red-500'
              : value.trim() && !isValidating
                ? 'border border-green-600'
                : ''
          }`}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="e.g. stt.timelineType = 'home' AND sbt.tag = 'photo'"
          ref={inputRef}
          rows={2}
          value={value}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 mt-1 w-full max-h-40 overflow-y-auto rounded bg-gray-900 border border-gray-600 shadow-lg">
            {suggestions.map((suggestion, index) => (
              <button
                className={`w-full text-left px-2 py-1 text-xs font-mono ${
                  index === selectedIndex
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
                key={suggestion}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSuggestionClick(suggestion)
                }}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* バリデーション結果 */}
      {isValidating && <p className="text-xs text-gray-500">チェック中...</p>}
      {validationError && (
        <p className="text-xs text-red-400">⚠ {validationError}</p>
      )}
      {value.trim() && !isValidating && !validationError && (
        <p className="text-xs text-green-500">✓ クエリに問題はありません</p>
      )}

      <p className="text-xs text-gray-500">
        Available tables: <code className="text-gray-400">s</code> (statuses),{' '}
        <code className="text-gray-400">stt</code> (timeline types),{' '}
        <code className="text-gray-400">sbt</code> (tags). LIMIT/OFFSET are set
        automatically.
      </p>
      {QUERY_COMPLETIONS.examples.length > 0 && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer hover:text-gray-400">
            Examples
          </summary>
          <ul className="mt-1 space-y-1 pl-2">
            {QUERY_COMPLETIONS.examples.map((example) => (
              <li key={example.query}>
                <button
                  className="text-left font-mono text-gray-400 hover:text-white"
                  onClick={() => onChange(example.query)}
                  type="button"
                >
                  {example.query}
                </button>
                <p className="text-gray-500 ml-2">{example.description}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
