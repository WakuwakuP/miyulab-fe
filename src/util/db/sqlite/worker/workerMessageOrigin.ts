/**
 * Dedicated Worker へ親が postMessage したとき、Chromium は event.origin を空文字にする。
 * 空文字はオーナーからのメッセージとして受け、空でない別オリジンだけ拒否する。
 */
export function isAcceptedWorkerMessageOrigin(
  eventOrigin: string,
  locationOrigin: string,
): boolean {
  return eventOrigin === '' || eventOrigin === locationOrigin
}
