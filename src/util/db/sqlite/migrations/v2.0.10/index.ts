import { addColumnIfNotExists } from '../helpers'
import type { Migration } from '../types'

export const v2_0_10_migration: Migration = {
  description: 'Store confirmed emoji reactions per account and post',
  up({ db }) {
    addColumnIfNotExists(
      db,
      'post_interactions',
      'confirmed_reactions_json',
      'TEXT',
    )
  },
  version: { major: 2, minor: 0, patch: 10 },
}
