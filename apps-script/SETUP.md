# Google Drive 接続設定

## 1. Apps Scriptを作成
1. https://script.google.com/ を開く
2. 「新しいプロジェクト」を選ぶ
3. Code.gsを全置換して、このフォルダの Code.gs を貼り付ける

## 2. スクリプトプロパティ
「プロジェクトの設定」→「スクリプト プロパティ」に次を追加する。

- FOLDER_ID: Google Driveの「ジャグラーWeb共有」フォルダID
- WEB_PIN: 自分で決めた6桁以上の共通PIN

PINはGitHub、Code.gs、config.jsには書かない。

## 3. デプロイ
1. 「デプロイ」→「新しいデプロイ」
2. 種類: ウェブアプリ
3. 次のユーザーとして実行: 自分
4. アクセスできるユーザー: 全員
5. デプロイし、末尾が /exec のURLをコピー

## 4. Webへ接続
コピーした /exec URLだけを config.js の JUGGLER_API_URL に設定する。

バックアップJSONとGoogle Driveフォルダは非公開のままにする。
