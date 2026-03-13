# Miyulab-fe

This is Pleroma client application for web.

Web用Pleromaフロントエンドアプリケーションです。

## 使い方

以下の環境変数を設定してビルドしてください。

各URLは `https://example.com` のような形式で設定してください。

```env
NEXT_PUBLIC_APP_URL=<デプロイURL> // 例 https://example.com
NEXT_PUBLIC_BACKEND_URL=<バックエンドURL> // 例 https://example.com
```

オプション設定

Pleroma以外への対応

```env
NEXT_PUBLIC_BACKEND_SNS=<SNS名> // 例 'mastodon' | 'pleroma' | 'friendica' | 'firefish'
```

```sh
yarn
yarn build
```

## maintenance

SQLite WASM のバージョン更新するときは node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm を public/sqlite3.wasm にファイルをコピーする
