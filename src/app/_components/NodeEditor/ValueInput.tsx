'use client'

// ============================================================
// ValueInput — 補完付き値入力コンポーネント
// ============================================================
//
// TableFilter の値入力に使用する。
// - knownValues がある場合: Select / MultiSelect (IN/NOT IN 時)
// - テキスト型カラム: DB 値のインクリメンタル検索
// - 数値型カラム: number input
// - IN/NOT IN 演算子: MultiCombobox による複数選択

import { type ComboboxItem, MultiCombobox } from 'app/_parts/MultiCombobox'
import { Input } from 'components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FilterOp, FilterValue } from 'util/db/query-ir/nodes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ValueInputProps = {
  /** カラム名 */
  column: string
  /** カラム型 */
  columnType: 'integer' | 'text' | 'real'
  /** レジストリ定義の既知値 */
  knownValues?: string[]
  onChange: (value: FilterValue) => void
  /** 現在の演算子 */
  op: FilterOp
  /** DB からの値検索関数 */
  searchValues?: (
    table: string,
    column: string,
    prefix: string,
  ) => Promise<string[]>
  /** テーブル名 */
  table: string
  value: FilterValue
}

// ---------------------------------------------------------------------------
// Multi-value badge input (for IN / NOT IN with knownValues)
// ---------------------------------------------------------------------------

function KnownValuesMultiSelect({
  knownValues,
  onChange,
  value,
}: {
  knownValues: string[]
  onChange: (value: string[]) => void
  value: string[]
}) {
  const toggle = useCallback(
    (v: string) => {
      const next = value.includes(v)
        ? value.filter((x) => x !== v)
        : [...value, v]
      onChange(next)
    },
    [value, onChange],
  )

  return (
    <div className="flex flex-wrap gap-1">
      {knownValues.map((v) => (
        <button
          className={`rounded px-1.5 py-0.5 text-xs border transition-colors ${
            value.includes(v)
              ? 'bg-blue-600/30 border-blue-500/50 text-blue-300'
              : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'
          }`}
          key={v}
          onClick={() => toggle(v)}
          type="button"
        >
          {v}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Autocomplete text input (DB search backed)
// ---------------------------------------------------------------------------

function AutocompleteInput({
  column,
  onChange,
  searchValues,
  table,
  value,
}: {
  column: string
  onChange: (value: string) => void
  searchValues: (
    table: string,
    column: string,
    prefix: string,
  ) => Promise<string[]>
  table: string
  value: string
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useCallback(
    (prefix: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!prefix) {
        setSuggestions([])
        setShowSuggestions(false)
        return
      }
      debounceRef.current = setTimeout(() => {
        void searchValues(table, column, prefix).then((results) => {
          setSuggestions(results)
          setSelectedIndex(0)
          setShowSuggestions(results.length > 0)
        })
      }, 200)
    },
    [searchValues, table, column],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value
      onChange(v)
      search(v)
    },
    [onChange, search],
  )

  const applySuggestion = useCallback(
    (suggestion: string) => {
      onChange(suggestion)
      setShowSuggestions(false)
      inputRef.current?.focus()
    },
    [onChange],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
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

  return (
    <div className="relative flex-1">
      <Input
        className="h-7 text-xs bg-gray-800 border-gray-600"
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        onChange={handleChange}
        onFocus={() => {
          if (value) search(value)
        }}
        onKeyDown={handleKeyDown}
        placeholder="値"
        ref={inputRef}
        value={value}
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-32 overflow-y-auto rounded bg-gray-900 border border-gray-600 shadow-lg">
          {suggestions.map((s, i) => (
            <button
              className={`w-full text-left px-2 py-1 text-xs font-mono ${
                i === selectedIndex
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700'
              }`}
              key={s}
              onMouseDown={(e) => {
                e.preventDefault()
                applySuggestion(s)
              }}
              type="button"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main ValueInput
// ---------------------------------------------------------------------------

export function ValueInput({
  column,
  columnType,
  knownValues,
  onChange,
  op,
  searchValues,
  table,
  value,
}: ValueInputProps) {
  const isNullOp = op === 'IS NULL' || op === 'IS NOT NULL'
  const isArrayOp = op === 'IN' || op === 'NOT IN'

  // DB 検索を ComboboxItem[] に変換する関数 (hooks ルール準拠のため常に宣言)
  const comboboxSearch = useMemo(() => {
    if (!searchValues) return undefined
    return async (query: string): Promise<ComboboxItem[]> => {
      const results = await searchValues(table, column, query)
      return results.map((r) => ({ label: r, value: r }))
    }
  }, [searchValues, table, column])

  if (isNullOp) return null

  // knownValues がある場合
  if (knownValues && knownValues.length > 0) {
    if (isArrayOp) {
      const arrayVal = Array.isArray(value) ? (value as string[]) : []
      return (
        <KnownValuesMultiSelect
          knownValues={knownValues}
          onChange={onChange}
          value={arrayVal}
        />
      )
    }
    // 単一値: Select
    return (
      <Select onValueChange={(v) => onChange(v)} value={String(value ?? '')}>
        <SelectTrigger className="h-7 text-xs bg-gray-800 border-gray-600 flex-1">
          <SelectValue placeholder="値を選択" />
        </SelectTrigger>
        <SelectContent>
          {knownValues.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // 数値型
  if (columnType === 'integer' || columnType === 'real') {
    if (isArrayOp) {
      const arrayVal = Array.isArray(value)
        ? value.map(String)
        : String(value ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
      return (
        <MultiCombobox
          emptyText="数値を検索..."
          onChange={(vals) => {
            const nums = vals.map(Number).filter((n) => !Number.isNaN(n))
            onChange(nums)
          }}
          onSearch={comboboxSearch}
          placeholder="値を選択"
          value={arrayVal}
        />
      )
    }
    return (
      <Input
        className="h-7 text-xs bg-gray-800 border-gray-600 flex-1"
        onChange={(e) => {
          const num = Number(e.target.value)
          onChange(
            e.target.value !== '' && !Number.isNaN(num) ? num : e.target.value,
          )
        }}
        placeholder="値"
        type="number"
        value={String(value ?? '')}
      />
    )
  }

  // テキスト型 + DB検索
  if (searchValues) {
    if (isArrayOp) {
      const arrayVal = Array.isArray(value)
        ? (value as string[])
        : String(value ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
      return (
        <MultiCombobox
          onChange={(vals) => onChange(vals)}
          onSearch={comboboxSearch}
          placeholder="値を検索して選択"
          value={arrayVal}
        />
      )
    }
    return (
      <AutocompleteInput
        column={column}
        onChange={(v) => onChange(v)}
        searchValues={searchValues}
        table={table}
        value={String(value ?? '')}
      />
    )
  }

  // フォールバック: 素の Input (単一値) / MultiCombobox (配列)
  if (isArrayOp) {
    const arrayVal = Array.isArray(value)
      ? value.map(String)
      : String(value ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
    return (
      <MultiCombobox
        onChange={(vals) => {
          const nums = vals.map(Number)
          const allNumeric = vals.every(
            (v) => v !== '' && !Number.isNaN(Number(v)),
          )
          onChange(allNumeric ? nums : vals)
        }}
        placeholder="値を入力して選択"
        value={arrayVal}
      />
    )
  }

  const displayValue = String(value ?? '')
  return (
    <Input
      className="h-7 text-xs bg-gray-800 border-gray-600 flex-1"
      onChange={(e) => {
        const raw = e.target.value
        const num = Number(raw)
        onChange(raw !== '' && !Number.isNaN(num) ? num : raw)
      }}
      placeholder="値"
      value={displayValue}
    />
  )
}
