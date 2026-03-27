import type { DbExec } from '../types'

export function createCardTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_cards (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id       INTEGER NOT NULL UNIQUE,
      card_type_id  INTEGER NOT NULL,
      url           TEXT    NOT NULL,
      title         TEXT    NOT NULL DEFAULT '',
      description   TEXT    NOT NULL DEFAULT '',
      image         TEXT,
      author_name   TEXT,
      author_url    TEXT,
      provider_name TEXT,
      provider_url  TEXT,
      html          TEXT,
      width         INTEGER,
      height        INTEGER,
      embed_url     TEXT,
      blurhash      TEXT,
      FOREIGN KEY (post_id)      REFERENCES posts(id)      ON DELETE CASCADE,
      FOREIGN KEY (card_type_id) REFERENCES card_types(id)
    );
  `)
}
