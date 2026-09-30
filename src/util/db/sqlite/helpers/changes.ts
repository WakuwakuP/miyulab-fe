import type { DbExecCompat } from './types'

export function lastChangeCount(db: DbExecCompat): number {
  const rows = db.exec('SELECT changes();', {
    returnValue: 'resultRows',
  }) as number[][]
  return rows.length > 0 ? Number(rows[0][0]) : 0
}
