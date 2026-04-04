export type {
  Cardinality,
  ColumnMeta,
  JoinPath,
  TableRegistry,
  TableRegistryEntry,
} from './types'

import { ACCOUNT_TABLES } from './account-tables'
import { LOOKUP_TABLES } from './lookup-tables'
import { POST_TABLES } from './post-tables'
import { SOURCE_TABLES } from './source-tables'
import type { TableRegistry } from './types'

export const TABLE_REGISTRY: TableRegistry = {
  ...ACCOUNT_TABLES,
  ...LOOKUP_TABLES,
  ...POST_TABLES,
  ...SOURCE_TABLES,
}
