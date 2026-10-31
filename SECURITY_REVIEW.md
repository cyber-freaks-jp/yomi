# Yomi 個人forkの確認結果

確認日: 2026-10-31。上流: RikaiDev/yomi。
確認開始時の上流コミット: `44ed2cec80e365ca22dbbe21a50e4fd22d92ede7`。
目的: 上流やnpmの将来の変更を、自動で実行コードやMCPの指示へ取り込まない。

## 判断

上流版をそのまま使用する判断はしなかった。下記を修正し、テキストの
読み取り・明示した会話のローカル検索に限定した固定版をCodexに接続する。
送信・画像取得・既読・グループ操作・自動収集・意味検索はこの構成の対象外。

## 見つかった点と対処

- `src/auth/credential-store.ts`: macOSでもKeychainの値を平文JSONに複製し、
  次回はそのファイルを優先していた。保護された保存経路ではファイルを
  読み書きせず、Keychainの失敗も呼び出し元へ返すよう修正した。
- `src/auth/keychain.ts`: `security add-generic-password -A`で全アプリにアクセスを
  許可していた。`-A`を除き、CLIの許可を`/usr/bin/security`に限定した。
  fork専用の`jp.cyber-freaks.yomi-reviewed.credentials`を使用する。
- `src/mcp/server.ts`: 説明資料にはない起動時の全会話収集と継続ポーリングが
  実装されていた。起動経路から除去した。
- `src/mcp/handlers/search.ts`: 空の索引を検索すると全会話を自動収集していた。
  自動収集を除き、収集時は1〜20件のchatIdsを必須にした。検索はキーワードのみ。
- 更新チェックの返答がモデル向けinstructionsへ入る経路を除去した。
  npm/npxやgitを通常の起動に使用しない。将来のソース・依存更新は手動再確認する。
- 送信ツールには任意のローカルファイルをLINEへ送れるものもあった。
  MCPは14ツールの許可リストで公開・実行し、未知の名前や非公開ツールの直接呼出しも拒否する。
- 受信内容・表示名・タイトル・診断文字列を一律に非信頼データとして扱う指示を追加。
  読み取り結果のテキストはJSONで引用して出所を表示する。これは完全な注入防御ではない。
- `src/line/client/transport.ts`: デコード失敗時に応答の先頭・末尾をログ出力していた。
  本文のダンプを除去した。メディアの認証付きfetchにはリダイレクト拒否も追加したが、
  メディア取得自体は本構成では公開しない。
- 依存監査でMCP SDK等に既知の問題を検出。SDK server/clientを2.3.0、Zodを4.6.6に固定。
  HTTP向けの問題など、stdio構成では発現しない項目も含まれる。
  参考: https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-jm63-cq47-j5jp

## 固定方法

作業checkoutと実行物を分離する。`reviewed-runtime/package-lock.json`で
本番用の4直接依存を固定し、インストール時のパッケージスクリプトを実行しない。
開発用の画像・ONNXモデル・その他開発ツールのパッケージは本番にインストールしない。

`scripts/install-reviewed.mjs`はコミット済みのビルドをユーザー領域の
`.local/share/yomi-reviewed/releases/<commit>/`にコピーする。
実行物・依存・プライバシー文書のSHA-256一覧と、その一覧自体のハッシュを固定する。
起動時に変更・追加・欠落を検出したら停止する。通常起動で再ビルド・再取得はしない。
子プロセスにはクラウドトークン、NODE_OPTIONS、上流用の環境変数を引き継がない。
GitHub Actionsはこのforkでは無効化し、上流remoteへのpushもローカルで無効化した。

Codexにはローカルlauncherを登録し、ホスト側にも14ツールの許可リストと
`default_tools_approval_mode = "prompt"`を設定する。
公式設定仕様: https://learn.chatgpt.com/docs/extend/mcp?surface=cli

## 確認したこと

- `npm run typecheck` / `npm run build`: 成功。
- `npm run lint` / `npm run lint:comments` / `npm run test:fixture-hygiene`: 成功。
- Bun 1.3.14でテスト210件成功、1件スキップ、失敗0件。
  スキップはローカルONNX推論テストで、本番構成には含めない。
- Keychainをmockした回帰テスト: 平文複製しない、古い平文を読まない、保存失敗を隠さない。
- ポリシーテスト: 禁止ツールの直接呼出し拒否、過大な件数・全会話収集の拒否、
  悪意ある文字列をJSON外へ抜け出させないことを確認。
- `python3 scripts/smoke-reviewed.py`: 実際のstdio接続で初期化、14ツールの列挙、
  禁止ツール拒否、空の検索、ポリシー取得を検証。通信を試みると終了するpreloaderで
  外部通信がないことを確認。実アカウントへのログインは行わない。
- `node scripts/test-reviewed-launcher.mjs`: ファイル変更・追加・欠落・manifest変更の拒否と、
  子プロセスへのトークン非継承を検証。
- `npm audit --omit=dev --prefix reviewed-runtime`: 既知の脆弱性0件。
  開発用依存全体の監査結果ではない。画像・モデル・開発ツールには未解消の項目がある。

## 残る範囲と制約

これは主な信頼境界と実行経路の手動確認、依存監査、回帰テストであり、
全依存コード・暗号実装・LINE独自プロトコルの完全な監査や無害性の証明ではない。

受信メッセージからのプロンプトインジェクションは、固定版でも起こりうる。
モデルが持つ別のMCP、シェル、ファイルアクセスまで本サーバーは制限できない。
権限を絞ったLINE用会話で利用し、受信文だけを根拠に別ツールを実行しない。
同じOSユーザーのプロセスはローカルデータやKeychain CLIにアクセスしうる。
`security`経由の保存は引数を使用するため、同一ユーザーのプロセス観測まで隔離しない。
OS・Node本体・launcherを含む同一ユーザーによる能動的な改ざんへの防御ではない。

検索索引とE2EEキャッシュは端末内の平文ファイルで、所有者のみの権限にする。
索引除外は明示した直接読み取りまで禁止するアクセス制御ではない。
Codexへ渡した本文はAI提供元で処理され、保存・学習の扱いは利用環境の設定に依存する。
LINE非公式クライアントとしてのアカウント停止リスクと、将来の未修正脆弱性は残る。

初回ログインはCodexの`login`ツールから行い、スマホで新端末の認証を完了する。
実機ログイン、実際の会話の読み取り、公式LINE Desktopとの併用可否は未検証。
