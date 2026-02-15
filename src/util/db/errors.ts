/**
 * IndexedDBエラーのラッパー
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'DatabaseError'
  }
}

/**
 * エラーハンドリング付きDB操作
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  fallback?: T,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    console.error('Database operation failed:', error)

    if (fallback !== undefined) {
      return fallback
    }

    throw new DatabaseError('Database operation failed', error)
  }
}
