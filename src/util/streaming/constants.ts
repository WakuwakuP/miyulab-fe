/** リトライ待機時間の初期値（ミリ秒） */
export const RETRY_DELAY_MS = 1000

/** エクスポネンシャルバックオフの最大待機時間（ミリ秒） */
export const MAX_RETRY_DELAY_MS = 30000

/**
 * 最大リトライ回数
 * 超過した場合は接続を諦め、ユーザーに手動リロードを促す。
 */
export const MAX_RETRY_COUNT = 10

/**
 * エクスポネンシャルバックオフによるリトライ待機時間を計算する。
 * retryCount が増えるごとに待機時間が倍増し、MAX_RETRY_DELAY_MS で上限を設ける。
 */
export const getRetryDelay = (retryCount: number): number =>
  Math.min(RETRY_DELAY_MS * 2 ** retryCount, MAX_RETRY_DELAY_MS)

/**
 * ストリーム接続数の警告閾値
 *
 * ブラウザの同一ドメインに対する WebSocket 同時接続数制限（Chrome: 6 程度）や
 * 全体の上限（一般的に 256）を考慮した警告値。
 * この値を超えるとコンソールに警告を出力する。
 *
 * タグタイムライン × 複数バックエンドで接続数が急増するため、
 * UI 側でのタグ数上限（推奨: 5 タグ以内）と併せて運用する。
 */
export const MAX_STREAM_COUNT_WARNING = 20
