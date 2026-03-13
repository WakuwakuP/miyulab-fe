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
import { RiCheckLine, RiClipboardLine } from 'react-icons/ri'
import {
  ALIAS_TO_TABLE,
  QUERY_COMPLETIONS,
  searchDistinctColumnValues,
  validateCustomQuery,
} from 'util/db/sqlite/statusStore'

type QueryEditorProps = {
  onChange: (value: string) => void
  onCopyExplain?: () => Promise<void>
  value: string
}

/**
 * SQL WHERE 句入力欄（補完付き）
 *
 * テーブルエイリアス (s., stt., sbt.) を入力すると
 * カラム名の補完候補を表示する。
 * `sbt.tag = '` や `stt.timelineType = '` の後に
 * DB 内の実データ値の補完候補を表示する。
 * SQL キーワード・関数の補完も提供する。
 */
export const QueryEditor = ({
  onChange,
  onCopyExplain,
  value,
}: QueryEditorProps) => {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [explainCopied, setExplainCopied] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const explainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 比較演算子の補完候補 */
  const comparisonOperators = useMemo(
    () => [
      '= ',
      'IN (',
      'NOT IN (',
      'LIKE ',
      'IS NULL',
      'IS NOT NULL',
      '!= ',
      '> ',
      '>= ',
      '< ',
      '<= ',
    ],
    [],
  )

  /** 論理演算子の補完候補 */
  const logicalOperators = useMemo(() => ['AND ', 'OR '], [])

  // explainTimerRef のクリーンアップ
  useEffect(() => {
    return () => {
      if (explainTimerRef.current != null) {
        clearTimeout(explainTimerRef.current)
      }
    }
  }, [])

  const handleCopyExplain = useCallback(async () => {
    if (!onCopyExplain) return
    try {
      await onCopyExplain()
      setExplainCopied(true)
      if (explainTimerRef.current != null) {
        clearTimeout(explainTimerRef.current)
      }
      explainTimerRef.current = setTimeout(() => {
        setExplainCopied(false)
        explainTimerRef.current = null
      }, 2000)
    } catch (error) {
      console.error('Failed to copy EXPLAIN:', error)
    }
  }, [onCopyExplain])

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

  const updateSuggestions = useCallback(
    (text: string, cursorPos: number) => {
      // カーソル位置の直前のワードを取得
      const beforeCursor = text.slice(0, cursorPos)

      // 汎用カラム値補完: alias.column = '...' or alias.column IN ('...', '...' の後
      // すべてのエイリアス・カラムの組み合わせで動的 DB 検索を実行
      const columnValueMatch = beforeCursor.match(
        /(\w+)\.(\w+)\s*(?:=|!=|<>|IN\s*\((?:'[^']*',\s*)*|NOT\s+IN\s*\((?:'[^']*',\s*)*)\s*'([^']*)$/i,
      )
      if (columnValueMatch) {
        const alias = columnValueMatch[1]
        const column = columnValueMatch[2]
        const partial = columnValueMatch[3]
        // ALIAS_TO_TABLE に登録されたエイリアス・カラムの場合のみ DB 検索
        if (ALIAS_TO_TABLE[alias]?.columns[column]) {
          void searchDistinctColumnValues(alias, column, partial, 12).then(
            (values) => {
              if (values.length > 0) {
                setSuggestions(values)
                setSelectedIndex(0)
                setShowSuggestions(true)
              } else {
                setShowSuggestions(false)
              }
            },
          )
          return
        }
      }

      // 論理演算子補完: 完全な条件式の後（閉じクォート、数値、IS NULL/IS NOT NULL、閉じ括弧の後のスペース）
      const logicalMatch = beforeCursor.match(
        /(?:'[^']*'|\d+|IS\s+(?:NOT\s+)?NULL|\))\s+(\w*)$/i,
      )
      if (logicalMatch) {
        const partial = logicalMatch[1]
        // 入力がない場合（スペースのみ）、またはANDやORの入力中
        if (partial === '' || /^[A-Za-z]/.test(partial)) {
          const filtered = logicalOperators.filter((op) =>
            op.toLowerCase().startsWith(partial.toLowerCase()),
          )
          // カラム名やキーワードの候補も含める（通常補完に fallthrough するため、ここではロジカル演算子のみ）
          if (filtered.length > 0 && partial.length > 0) {
            // 入力中のプレフィクスに一致する場合のみ表示
            const allFiltered = [
              ...filtered,
              ...allCompletions.filter(
                (item) =>
                  item.toLowerCase().startsWith(partial.toLowerCase()) &&
                  !filtered.includes(item),
              ),
            ]
            setSuggestions(allFiltered.slice(0, 12))
            setSelectedIndex(0)
            setShowSuggestions(true)
            return
          }
        }
      }

      // 比較演算子補完: alias.column の後のスペース
      const operatorMatch = beforeCursor.match(
        /(\w+)\.(\w+)\s+([A-Za-z!><=]*)$/,
      )
      if (operatorMatch) {
        const alias = operatorMatch[1]
        const column = operatorMatch[2]
        const partial = operatorMatch[3]
        // QUERY_COMPLETIONS のエイリアスに登録されたカラムの場合のみ
        const aliasColumns =
          QUERY_COMPLETIONS.columns[
            alias as keyof typeof QUERY_COMPLETIONS.columns
          ]
        if ((aliasColumns as readonly string[] | undefined)?.includes(column)) {
          const filtered = comparisonOperators.filter((op) =>
            op.toLowerCase().startsWith(partial.toLowerCase()),
          )
          if (filtered.length > 0) {
            setSuggestions(filtered.slice(0, 12))
            setSelectedIndex(0)
            setShowSuggestions(true)
            return
          }
        }
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
    [allCompletions, comparisonOperators, logicalOperators],
  )

  const applySuggestion = useCallback(
    (suggestion: string) => {
      const textarea = inputRef.current
      if (!textarea) return

      const cursorPos = textarea.selectionStart
      const text = value
      const beforeCursor = text.slice(0, cursorPos)
      const afterCursor = text.slice(cursorPos)

      // 汎用カラム値補完の場合
      const genericColumnValueMatch = beforeCursor.match(
        /(\w+)\.(\w+)\s*(?:=|!=|<>|IN\s*\((?:'[^']*',\s*)*|NOT\s+IN\s*\((?:'[^']*',\s*)*)\s*'([^']*)$/i,
      )
      if (genericColumnValueMatch) {
        const matchedPartial = genericColumnValueMatch[3]
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

      // 比較演算子補完の場合: alias.column の後のスペース + 部分入力
      const operatorMatch = beforeCursor.match(
        /(\w+)\.(\w+)\s+([A-Za-z!><=]*)$/,
      )
      if (
        operatorMatch &&
        comparisonOperators.some((op) =>
          op.toLowerCase().startsWith(operatorMatch[3].toLowerCase()),
        )
      ) {
        const partial = operatorMatch[3]
        const replaceStart = beforeCursor.length - partial.length
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

      // 論理演算子補完の場合: 完全条件式の後
      const logicalMatch = beforeCursor.match(
        /(?:'[^']*'|\d+|IS\s+(?:NOT\s+)?NULL|\))\s+(\w*)$/i,
      )
      if (
        logicalMatch &&
        logicalOperators.some((op) =>
          op.toLowerCase().startsWith(logicalMatch[1].toLowerCase()),
        )
      ) {
        const partial = logicalMatch[1]
        const replaceStart = beforeCursor.length - partial.length
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
    [value, onChange, comparisonOperators, logicalOperators],
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

      {/* EXPLAIN コピーボタン */}
      {onCopyExplain && (
        <div className="flex gap-1">
          <button
            className={`flex items-center gap-1 rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-700 ${
              explainCopied ? 'text-green-400' : ''
            }`}
            onClick={handleCopyExplain}
            title="EXPLAIN QUERY PLAN をクリップボードにコピー"
            type="button"
          >
            {explainCopied ? (
              <RiCheckLine size={14} />
            ) : (
              <RiClipboardLine size={14} />
            )}
            {explainCopied ? 'コピーしました' : 'EXPLAIN コピー'}
          </button>
        </div>
      )}

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
        <code className="text-gray-400">sbt</code> (tags),{' '}
        <code className="text-gray-400">sm</code> (mentions),{' '}
        <code className="text-gray-400">sb</code> (backends),{' '}
        <code className="text-gray-400">n</code> (notifications). You can
        combine statuses and notifications using OR. LIMIT/OFFSET are set
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
                  className="text-left hover:text-white"
                  onClick={() => onChange(example.query)}
                  type="button"
                >
                  <p>{example.description}</p>
                  <p className="font-mono text-gray-400 ml-2 line-clamp-1">
                    {example.query}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
