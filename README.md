# JUGGLER VIEW

Android版 `jaguar-estimator` のデータを知り合いと共有するための閲覧専用Web版です。

## 現在の状態

- 共通PIN画面（初期デモPIN: `2525`）
- 履歴／狙い台／ラボの3タブ
- スマートフォン・PC対応
- ホーム画面追加用Web App Manifest
- `sample-data.json` の読込み

## GitHub Pages

このフォルダの内容を公開用リポジトリのルート、またはPages対象の `docs/` に配置します。

## 次の接続作業

1. AndroidのSQLiteから閲覧用JSONを生成
2. Google Driveへアップロード
3. `loadData()` の接続先を実データAPIへ変更
4. PINをサーバー側で検証

現在のPINは初期画面を確認するための簡易実装であり、データの安全な非公開化にはサーバー側認証が必要です。
