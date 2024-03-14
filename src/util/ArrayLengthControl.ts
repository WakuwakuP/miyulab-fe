'use client'

import { MAX_LENGTH } from 'util/environment'

export function ArrayLengthControl<T>(data: T[]) {
  if (data.length > MAX_LENGTH) {
    return data.slice(0, MAX_LENGTH)
  }
  return data
}
