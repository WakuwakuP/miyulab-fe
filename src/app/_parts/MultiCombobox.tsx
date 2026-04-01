'use client'

// ============================================================
// MultiCombobox — 複数選択コンボボックス
// ============================================================
//
// Popover + Command (cmdk) + Badge による複数選択 UI。
// - 静的リスト (items) からの選択
// - DB 非同期検索 (onSearch) からの選択
// - 選択済みアイテムを Badge で表示し、× で個別削除可能

import { Badge } from 'components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from 'components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from 'components/ui/popover'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComboboxItem = {
  /** 表示ラベル */
  label: string
  /** 実際の値 */
  value: string
}

type MultiComboboxProps = {
  /** 空の状態で表示するテキスト */
  emptyText?: string
  /** 静的な選択肢リスト */
  items?: ComboboxItem[]
  /** 値変更コールバック */
  onChange: (values: string[]) => void
  /** DB 非同期検索関数 (入力テキストを受け取り候補を返す) */
  onSearch?: (query: string) => Promise<ComboboxItem[]>
  /** プレースホルダー */
  placeholder?: string
  /** 現在選択中の値 */
  value: string[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MultiCombobox({
  emptyText = '候補が見つかりません',
  items,
  onChange,
  onSearch,
  placeholder = '選択...',
  value,
}: MultiComboboxProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ComboboxItem[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 非同期検索
  useEffect(() => {
    if (!onSearch) return
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!searchQuery) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    let cancelled = false
    setIsSearching(true)
    debounceRef.current = setTimeout(() => {
      void onSearch(searchQuery).then((results) => {
        if (!cancelled) {
          setSearchResults(results)
          setIsSearching(false)
        }
      })
    }, 200)

    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery, onSearch])

  // 表示する候補リスト
  const displayItems = onSearch ? searchResults : (items ?? [])

  const toggle = useCallback(
    (itemValue: string) => {
      const next = value.includes(itemValue)
        ? value.filter((v) => v !== itemValue)
        : [...value, itemValue]
      onChange(next)
    },
    [value, onChange],
  )

  const remove = useCallback(
    (itemValue: string) => {
      onChange(value.filter((v) => v !== itemValue))
    },
    [value, onChange],
  )

  // 選択済みアイテムのラベル解決
  const getLabel = useCallback(
    (val: string): string => {
      const found =
        items?.find((i) => i.value === val) ??
        searchResults.find((i) => i.value === val)
      return found?.label ?? val
    },
    [items, searchResults],
  )

  return (
    <div className="flex flex-col gap-1.5">
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center justify-between rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 transition-colors min-h-[28px] w-full"
            type="button"
          >
            <span className="truncate">
              {value.length > 0 ? `${value.length}件選択中` : placeholder}
            </span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0" sideOffset={4}>
          <Command shouldFilter={!onSearch}>
            <CommandInput
              className="h-8 text-xs"
              onValueChange={setSearchQuery}
              placeholder="検索..."
              value={searchQuery}
            />
            <CommandList>
              <CommandEmpty className="py-3 text-xs text-center">
                {isSearching ? '検索中...' : emptyText}
              </CommandEmpty>
              <CommandGroup>
                {displayItems.map((item) => (
                  <CommandItem
                    className="text-xs"
                    key={item.value}
                    onSelect={() => toggle(item.value)}
                    value={item.value}
                  >
                    <Check
                      className={`mr-2 h-3 w-3 ${
                        value.includes(item.value) ? 'opacity-100' : 'opacity-0'
                      }`}
                    />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* 選択済みバッジ */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((v) => (
            <Badge
              className="gap-1 px-1.5 py-0 text-[10px] bg-blue-600/30 border-blue-500/50 text-blue-300 hover:bg-blue-600/40"
              key={v}
              variant="outline"
            >
              <span className="truncate max-w-[120px]">{getLabel(v)}</span>
              <button
                className="ml-0.5 rounded-full hover:bg-blue-500/30 p-0.5"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(v)
                }}
                type="button"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
