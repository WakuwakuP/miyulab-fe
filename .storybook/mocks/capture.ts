import { fn } from 'storybook/test'
export const setRawDataCaptureEnabled = fn()
export const isRawDataCaptureEnabled = () => false
export const captureStreamEvent = fn()
export const captureApiResponse = fn()
export const getCaptureStats = async () => ({ api: 0, stream: 0, total: 0 })
export const clearCaptureData = fn(async () => {})
export const buildExport = fn(async () => ({ events: [] }))
export const downloadJson = fn()
