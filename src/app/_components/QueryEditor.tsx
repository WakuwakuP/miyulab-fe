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
import { QUERY_COMPLETIONS } from 'util/db/sqlite/statusStore'

type QueryEditorProps = {
  onChange: (value: string) => void
  value: string
}

/**
 * SQL WHERE 句入力欄（補完付き）
 *
 * テーブルエイリアス (s., stt., sbt.) を入力すると
 * カラム名の補完候補を表示する。
 * SQL キーワードの補完も提供する。
 */
export const QueryEditor = ({ onChange, value }: QueryEditorProps) => {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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

  const updateSuggestions = useCallback(
    (text: string, cursorPos: number) => {
      // カーソル位置の直前のワードを取得
      const beforeCursor = text.slice(0, cursorPos)
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
    [allCompletions],
  )

  const applySuggestion = useCallback(
    (suggestion: string) => {
      const textarea = inputRef.current
      if (!textarea) return

      const cursorPos = textarea.selectionStart
      const text = value
      const beforeCursor = text.slice(0, cursorPos)
      const afterCursor = text.slice(cursorPos)

      // 現在のワードを置換
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
      <span className="text-xs font-semibold text-gray-300">
        Advanced Query (SQL WHERE clause)
      </span>
      <div className="relative">
        <textarea
          className="w-full rounded bg-gray-700 px-2 py-1 text-sm text-white font-mono resize-y min-h-[60px]"
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
          <ul className="mt-1 space-y-0.5 pl-2">
            {QUERY_COMPLETIONS.examples.map((example) => (
              <li key={example}>
                <button
                  className="text-left font-mono text-gray-400 hover:text-white"
                  onClick={() => onChange(example)}
                  type="button"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
