/** 初期データフェッチの最大同時実行数（Worker キューの圧迫を防ぐ） */
export const INITIAL_FETCH_CONCURRENCY = 3

/**
 * タスク配列を最大 concurrency 個ずつ並行実行する。
 * 各タスクの失敗はタスク内で catch 済みの想定。
 */
export function runWithConcurrencyLimit(
  tasks: (() => Promise<void>)[],
  concurrency: number,
): void {
  let index = 0
  function next(): void {
    if (index >= tasks.length) return
    const task = tasks[index++]
    task().finally(next)
  }
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    next()
  }
}
