'use client'

const MAX_LENGTH = 1000

export function ArrayLengthControl<T>(data: T[]) {
  if (data.length > MAX_LENGTH) {
    return data.slice(MAX_LENGTH - data.length)
  }
  return data
}
