# CLAUDE.md

## コミットとメールアドレス
- コミットの作成者・コミッターに、個人のメールアドレス（Gmail など）を使わないこと
- 作成者を指定するときは `yuu10 <6914131+yuu10@users.noreply.github.com>` を使う。指定がなければ、環境の noreply アドレスのままでよい
- `git config user.email` を個人のアドレスに書き換えないこと
- push する前に `git log --format='%ae %ce'` で、noreply 以外のアドレスが入っていないか確かめること

## リポジトリについて
- 拡張機能の本体は `extension/` にある（Manifest V3、Chrome / Edge / Firefox 対応）
- 機能を変えたら `extension/manifest.json` の `version` を上げ、README の説明も合わせて直す
- README やコミットメッセージは日本語で書く
