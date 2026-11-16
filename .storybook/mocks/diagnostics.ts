export const updateDbDiagnosticApps = () => {}
export const ensureDbDiagnosticAuthorization = async () => {}
export const isDbDiagnosticsClientEnabled = () => false
export const acquireDbDiagnosticUploader = () => ({
  getStatus: () => null,
  release: () => {},
  subscribe: () => () => {},
})
