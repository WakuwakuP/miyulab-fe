'use client'

const MAX_LENGTH = 1000

export function ArrayLengthControl<T>(data: T[]) {
  if (data.length > MAX_LENGTH) {
    return data.slice(0, MAX_LENGTH)
  }
  return data
}
