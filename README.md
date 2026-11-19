# SAMURAI WATCH

サッカー男子日本A代表の非公式情報アプリです。スマートフォンとPCで試合日程、代表招集、登録選手、クラブ出場、負傷・復帰情報を確認できます。直近の試合結果をグラフにし、登録選手は名前・所属クラブ・ポジションで絞り込めます。

## ローカルで起動する

リポジトリのルートで実行し、ブラウザーで `http://localhost:8000/` を開きます。ブラウザーがJSONを読み込むため、HTTPサーバー経由で開いてください。アプリにビルドやパッケージのインストールは不要です。

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

## スマートフォンからアクセスできるようにする

1. アプリのファイルを GitHub リポジトリの既定ブランチ `main` へ反映し、GitHub Actions を有効にします。
2. GitHub リポジトリの **Settings → Pages** で **Build and deployment → Source → GitHub Actions** を選びます。
3. **Actions → Deploy site to GitHub Pages → Run workflow** を実行します。成功すると、Pages の設定画面にスマートフォンでも開ける URL が表示されます。
4. **Refresh Japan fixtures and call-ups** を手動実行し、アプリの「更新情報」で JFA の試合日程と招集発表が取得できたか確認します。以後は原則3時間ごとに自動更新します。

更新ワークフローは取得した JSON を既定ブランチに保存します。ブランチ保護などで Actions による書き込みが禁止されている場合は、その運用に合わせて反映してください。Pages の公開範囲は GitHub のプランとリポジトリ設定に従います。

## データと更新

| 項目 | 出典と更新方法 |
| --- | --- |
| 試合日程、招集発表 | [JFA](https://www.jfa.jp/samuraiblue/) から発表の日付・概要・リンクを取得します。取得失敗時は直近のデータを保持し、画面で取得状態を確認できます。 |
| 試合結果 | JFA と [International football results](https://github.com/martj42/international_results) の公開データを使用します。 |
| 選手、所属クラブ | 初期データは2026年ワールドカップ登録時の記録です。現所属や現時点の招集を確かめるには、公式発表に基づいて `data/players.json` を更新します。 |
| クラブ出場、負傷 | API-FOOTBALL を利用できます。公開サイトでのデータ利用が契約上可能なことと、対象大会のデータが取得できることを確認し、GitHub の **Settings → Secrets and variables → Actions** に `API_FOOTBALL_KEY` を登録します。日本時間の毎日04:41と手動実行に対応しています。取得対象とリクエスト上限により報告範囲が異なります。 |
| 復帰日、復帰見込み | 所属クラブや JFA の発表で確認できた内容を `data/players.json` の選手別 `reports` に追加します。復帰日は出場記録や負傷名から推定しません。 |

選手を API-FOOTBALL で照合できない場合は、確認済みの `clubLatin`、`apiFootballTeamId`、`apiFootballId` を選手レコードに設定できます。クラブの移籍が確認された際には、表示と自動取得先の両方を更新してください。

公式の招集名簿をアプリに載せる場合は、`data/players.json` の `callups` に `id`、発表日の `date`、`title`、`source`（`label` と `url`）、`players` を追加します。`players` には確認できた全選手を入れ、同一選手には既存の `id` を使います。記事リンクは自動取得の対象ですが、招集者の個別名簿は手動で確認します。

レポートには `date`（`YYYY-MM-DD`）、`type`（`club`、`injury`、`return` のいずれか）、`title`、公式発表への `source`（`label` と `url`）を記録します。必要に応じて `summary` を追加できます。

トップページの画像は生成したイメージです。実在の選手や実際の試合・負傷を撮影した写真ではありません。
