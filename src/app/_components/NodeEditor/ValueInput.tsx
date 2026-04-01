'use client'

// ============================================================
// ValueInput — 補完付き値入力コンポーネント
// ============================================================
//
// TableFilter の値入力に使用する。
// - knownValues がある場合: Combobox (multiple) / Select
// - テキスト型カラム: Combobox (DB 非同期検索)
// - 数値型カラム: number input
// - IN/NOT IN 演算子: Combobox multiple による複数選択

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from 'components/ui/combobox'
import { Input } from 'components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { useCallback, useEffect, useRef, useState } from 'react'
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
// Async multi-select combobox (DB search backed)
// ---------------------------------------------------------------------------

function AsyncMultiCombobox({
  column,
  onChange,
  placeholder = '値を検索して選択',
  searchValues,
  table,
  value,
}: {
  column: string
  onChange: (values: string[]) => void
  placeholder?: string
  searchValues: (
    table: string,
    column: string,
    prefix: string,
  ) => Promise<string[]>
  table: string
  value: string[]
}) {
  const [searchResults, setSearchResults] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 選択済み + 検索結果をマージ (重複除去)
  const items = [...new Set([...value, ...searchResults])]

  const handleInputChange = useCallback(
    (inputValue: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!inputValue) {
        setSearchResults([])
        return
      }
      let cancelled = false
      debounceRef.current = setTimeout(() => {
        void searchValues(table, column, inputValue).then((results) => {
          if (!cancelled) setSearchResults(results)
        })
      }, 200)
      return () => {
        cancelled = true
      }
    },
    [searchValues, table, column],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <Combobox
      filter={null}
      items={items}
      multiple
      onInputValueChange={handleInputChange}
      onValueChange={onChange}
      value={value}
    >
      <ComboboxChips className="min-h-7 text-xs bg-gray-800 border-gray-600">
        {value.map((item) => (
          <ComboboxChip className="text-[10px]" key={item}>
            {item}
          </ComboboxChip>
        ))}
        <ComboboxChipsInput className="text-xs" placeholder={placeholder} />
      </ComboboxChips>
      <ComboboxContent>
        <ComboboxEmpty>候補が見つかりません</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem className="text-xs" key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

// ---------------------------------------------------------------------------
// Autocomplete single input (DB search backed)
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
  const [searchResults, setSearchResults] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const items = [...new Set([...(value ? [value] : []), ...searchResults])]

  const handleInputChange = useCallback(
    (inputValue: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!inputValue) {
        setSearchResults([])
        return
      }
      let cancelled = false
      debounceRef.current = setTimeout(() => {
        void searchValues(table, column, inputValue).then((results) => {
          if (!cancelled) setSearchResults(results)
        })
      }, 200)
      return () => {
        cancelled = true
      }
    },
    [searchValues, table, column],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <Combobox
      filter={null}
      items={items}
      onInputValueChange={handleInputChange}
      onValueChange={(val) => onChange(val as string)}
      value={value}
    >
      <ComboboxInput
        className="h-7 text-xs bg-gray-800 border-gray-600"
        placeholder="値"
        showTrigger={false}
      />
      <ComboboxContent>
        <ComboboxEmpty>候補が見つかりません</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem className="text-xs" key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

// ---------------------------------------------------------------------------
// Static multi-select combobox (known values)
// ---------------------------------------------------------------------------

function StaticMultiCombobox({
  items,
  onChange,
  value,
}: {
  items: string[]
  onChange: (values: string[]) => void
  value: string[]
}) {
  return (
    <Combobox items={items} multiple onValueChange={onChange} value={value}>
      <ComboboxChips className="min-h-7 text-xs bg-gray-800 border-gray-600">
        {value.map((item) => (
          <ComboboxChip className="text-[10px]" key={item}>
            {item}
          </ComboboxChip>
        ))}
        <ComboboxChipsInput className="text-xs" placeholder="値を選択" />
      </ComboboxChips>
      <ComboboxContent>
        <ComboboxEmpty>候補が見つかりません</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem className="text-xs" key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
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

  if (isNullOp) return null

  // knownValues がある場合
  if (knownValues && knownValues.length > 0) {
    if (isArrayOp) {
      const arrayVal = Array.isArray(value) ? (value as string[]) : []
      return (
        <StaticMultiCombobox
          items={knownValues}
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
      if (searchValues) {
        return (
          <AsyncMultiCombobox
            column={column}
            onChange={(vals) => {
              const nums = vals.map(Number).filter((n) => !Number.isNaN(n))
              onChange(nums)
            }}
            placeholder="数値を検索..."
            searchValues={searchValues}
            table={table}
            value={arrayVal}
          />
        )
      }
      return (
        <StaticMultiCombobox
          items={arrayVal}
          onChange={(vals) => {
            const nums = vals.map(Number).filter((n) => !Number.isNaN(n))
            onChange(nums)
          }}
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
        <AsyncMultiCombobox
          column={column}
          onChange={(vals) => onChange(vals)}
          searchValues={searchValues}
          table={table}
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

  // フォールバック: 素の Input
  if (isArrayOp) {
    const arrayVal = Array.isArray(value)
      ? value.map(String)
      : String(value ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
    return (
      <StaticMultiCombobox
        items={arrayVal}
        onChange={(vals) => {
          const nums = vals.map(Number)
          const allNumeric = vals.every(
            (v) => v !== '' && !Number.isNaN(Number(v)),
          )
          onChange(allNumeric ? nums : vals)
        }}
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
