# Miyulab-fe

This is Pleroma client application for web.

Web用Pleromaフロントエンドアプリケーションです。

## 使い方

以下の環境変数を設定してビルドしてください

デプロイURLは `https://example.com` のような形式で設定してください
バックエンドURLは `example.com` のような形式で設定してください

```
NEXT_PUBLIC_APP_URL=<デプロイURL> // 例 https://example.com
NEXT_PUBLIC_BACKEND_URL=<バックエンドURL> // 例 example.com
```

```sh
yarn
yarn build
```
