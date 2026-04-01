'use client'

import * as React from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react'
import { Check, ChevronDown, X } from 'lucide-react'

import { cn } from 'components/lib/utils'

const Combobox = ComboboxPrimitive.Root

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      className={cn(
        'flex items-center justify-center text-muted-foreground',
        className,
      )}
      data-slot="combobox-trigger"
      {...props}
    >
      {children ?? <ChevronDown className="size-4" />}
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxClear({
  className,
  ...props
}: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      className={cn(
        'flex items-center justify-center rounded-sm p-0.5 text-muted-foreground opacity-50 hover:opacity-100',
        className,
      )}
      data-slot="combobox-clear"
      {...props}
    >
      <X className="size-3.5" />
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxInput({
  className,
  disabled = false,
  showClear = false,
  showTrigger = true,
  ...props
}: ComboboxPrimitive.Input.Props & {
  showClear?: boolean
  showTrigger?: boolean
}) {
  return (
    <div
      className={cn(
        'flex h-9 items-center gap-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      data-slot="combobox-input-wrapper"
    >
      <ComboboxPrimitive.Input
        className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        disabled={disabled}
        {...props}
      />
      {showClear && <ComboboxClear disabled={disabled} />}
      {showTrigger && <ComboboxTrigger disabled={disabled} />}
    </div>
  )
}

function ComboboxContent({
  align = 'start',
  alignOffset = 0,
  anchor,
  className,
  side = 'bottom',
  sideOffset = 4,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'anchor' | 'side' | 'sideOffset'
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <ComboboxPrimitive.Popup
          className={cn(
            'max-h-(--available-height) w-(--anchor-width) min-w-[8rem] origin-(--transform-origin) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          data-slot="combobox-content"
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      className={cn(
        'max-h-[min(18rem,var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain p-1',
        className,
      )}
      data-slot="combobox-list"
      {...props}
    />
  )
}

function ComboboxItem({
  children,
  className,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      data-slot="combobox-item"
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <Check className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxGroup({
  className,
  ...props
}: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      className={cn(className)}
      data-slot="combobox-group"
      {...props}
    />
  )
}

function ComboboxLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)}
      data-slot="combobox-label"
      {...props}
    />
  )
}

function ComboboxEmpty({
  className,
  ...props
}: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      className={cn(
        'hidden w-full justify-center py-2 text-center text-sm text-muted-foreground group-data-empty/combobox-content:flex',
        className,
      )}
      data-slot="combobox-empty"
      {...props}
    />
  )
}

function ComboboxSeparator({
  className,
  ...props
}: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      data-slot="combobox-separator"
      {...props}
    />
  )
}

function ComboboxChips({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> &
  ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      className={cn(
        'flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring has-data-[slot=combobox-chip]:px-1',
        className,
      )}
      data-slot="combobox-chips"
      {...props}
    />
  )
}

function ComboboxChip({
  children,
  className,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean
}) {
  return (
    <ComboboxPrimitive.Chip
      className={cn(
        'flex h-5 w-fit items-center justify-center gap-0.5 rounded-sm bg-muted px-1.5 text-xs font-medium whitespace-nowrap text-foreground',
        className,
      )}
      data-slot="combobox-chip"
      {...props}
    >
      {children}
      {showRemove && (
        <ComboboxPrimitive.ChipRemove
          className="-ml-0.5 rounded-sm p-0.5 opacity-50 hover:opacity-100"
          data-slot="combobox-chip-remove"
        >
          <X className="size-3" />
        </ComboboxPrimitive.ChipRemove>
      )}
    </ComboboxPrimitive.Chip>
  )
}

function ComboboxChipsInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      className={cn(
        'min-w-16 flex-1 bg-transparent outline-none placeholder:text-muted-foreground',
        className,
      )}
      data-slot="combobox-chip-input"
      {...props}
    />
  )
}

export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
}
