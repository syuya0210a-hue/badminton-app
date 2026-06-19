# 施設空きチェック → LINE 通知

福岡市公共施設の空き状況を定期的にチェックし、**空きが出たら LINE に通知**するスクリプトです。

LINE の API は **LINE Official Account Manager** で作成したチャネルの **Channel ID** と **Channel secret** を使って利用します（Webhook URL は Manager 側で設定します）。

---

## 1. 入力する場所（設定）

設定は **`scripts` フォルダ内の `.env` ファイル** に書きます。

### 手順

1. **`scripts` フォルダに入る**
   ```bash
   cd scripts
   ```

2. **設定のひな形をコピーする**
   ```bash
   cp .env.example .env
   ```

3. **`.env` を開いて、次の項目を入力する**

   **必須**
   | 項目 | 入力するもの |
   |------|----------------|
   | `RESERVATION_USER_ID` | 福岡市公共施設予約サイトの**利用者ID** |
   | `RESERVATION_PASSWORD` | 同上の**パスワード** |
   | `LINE_CHANNEL_ID` | LINE Official Account Manager の**Channel ID** |
   | `LINE_CHANNEL_SECRET` | 同上の **Channel secret** |
   | `LINE_USER_ID` | 通知を受け取る LINE の**ユーザーID**（`U` で始まる） |

   **施設・期間・時間帯（任意。指定しない場合は既定値で動作）**
   | 項目 | 説明 | 例 |
   |------|------|-----|
   | `FACILITY_NAME` | 施設が1つのときの施設名（通知の〇〇部分） | 西体育館 |
   | `FACILITY_NAMES` | **複数指定する場合**はカンマ区切り。FACILITY_NAME より優先 | 西体育館,東体育館,南体育館 |
   | `FACILITY_NAME_PART` | 検索結果の絞り込み用。未指定時は上記の施設名を使用 | 西体育館 |
   | `CHECK_DATE` | チェックする日（1日だけ指定する場合） | 2026-03-15 |
   | `CHECK_DATE_END` | 期間で指定するときの終了日（CHECK_DATE〜ここまで）。**未指定なら実行日から3ヶ月後まで**が対象 | 2026-03-22 |
   | `TIME_SLOT_LABEL` | 時間帯の表示名（通知の「夜間枠」部分） | 夜間枠 |
   | `PURPOSE_LABEL` | 利用目的（既定: バドミントン） | バドミントン |

   - 予約サイトの ID/パスワードは [福岡市公共施設案内・予約システム](https://www3.11489.jp/fukuoka/user/Home) で使っているもの
   - Channel ID / Channel secret は **LINE Official Account Manager** でチャネルを作成すると表示・コピーできます
   - **Webhook URL** は Manager の画面で設定します（後述の「LINE_USER_ID の取得」で使うときなど）。このスクリプトが送信するだけなら、Webhook は空でも動きますが、ユーザーID取得時には必要です

### LINE Official Account Manager での準備

1. [LINE Official Account Manager](https://manager.line.biz/) にログインする  
2. 使う LINE 公式アカウントを選び、**API 設定**（または Messaging API 関連）の画面を開く  
3. 表示されている **Channel ID** と **Channel secret** をコピーし、`.env` の `LINE_CHANNEL_ID` と `LINE_CHANNEL_SECRET` に貼る  
4. **Webhook URL** の欄には、後述の「LINE_USER_ID の取得」で使う URL を設定する（通知送信だけなら必須ではありません）

### LINE_USER_ID の取得

通知を受け取る LINE アカウントのユーザーID（`U` で始まる英数字）が必要です。

1. このリポジトリで **`npm run line-user-id`** を実行し、Webhook 受信用サーバーを起動する  
2. [ngrok](https://ngrok.com/) などで **https の URL** を用意し、LINE Official Account Manager の **Webhook URL** にその URL を設定する  
3. 対象の LINE 公式アカウントを**友だち追加**し、**1通メッセージを送る**（例：「こんにちは」）  
4. `npm run line-user-id` を実行したターミナルに `LINE_USER_ID=Uxxxx...` が表示されるので、それを `.env` の `LINE_USER_ID` に貼る  

---

## 2. 実行方法

**いずれも `scripts` フォルダで**実行してください。

### 初回だけ（依存関係のインストール）

```bash
cd scripts
npm install
npx playwright install chromium
```

### 1回だけチェックして終わる

```bash
cd scripts
npm run check
```

- 空きが出ていれば LINE に通知され、なければ何も送られません（初回は「空きあり/なし」がログに出ます）。
- 通知は **「【空き通知】南体育館の三月○日(木)の夜間枠に空きが出ました。」** のように、**施設名が先頭**で届きます。`.env` の `FACILITY_NAME` または `FACILITY_NAMES` に、南体育館・博多体育館など実際の施設名を指定してください。

### 10分ごとに繰り返し実行する（PC を起動したまま）

```bash
cd scripts
npm run schedule
```

- 10分ごとに自動でチェックし、空きが出たときだけ LINE に通知します。  
- 止めるときは **Ctrl+C** で終了してください。

### サーバーや Cron で定期実行する場合

10分ごとに実行する例（`crontab -e` で追加）:

```cron
*/10 * * * * cd /Users/あなたのユーザー名/Desktop/badminton-app/scripts && npm run check >> /tmp/facility-check.log 2>&1
```

- `cd` の後のパスは、**あなたの PC 上の `badminton-app/scripts` の絶対パス**に書き換えてください。

---

## 3. パソコンを起動していなくても動かす（10分ごと）

自宅の PC を付けていなくても、**常時オンラインのサーバー**で動かせば 10 分ごとにチェックされ、空きがあれば LINE に通知されます。

**2 つの方法**があります。どちらか一方を選んで設定してください。

| 方法 | 特徴 | おすすめ |
|------|------|----------|
| **A: VPS + cron** | 10分ごとに確実に動く。月数百円〜（無料枠ありのサービスもある） | 10分ごとで確実に動かしたい人 |
| **B: GitHub Actions** | 設定は GitHub 上だけ。無料枠あり（30分ごとなら無料で収まりやすい） | サーバーを借りたくない人 |

---

### 方法 A: VPS・クラウドサーバー + cron（詳細手順）

**流れ**: ① VPS を借りる → ② サーバーに SSH で入る → ③ Node とプログラムを入れる → ④ 設定ファイルを置く → ⑤ 10分ごとに実行する cron を登録する

#### ステップ 1: VPS（サーバー）を用意する

**VPS** は、インターネット上で 24 時間動いている「借り物のパソコン」です。ここでスクリプトを 10 分ごとに動かします。

**サービス例**（いずれか 1 つで可）

- **Oracle Cloud** … 無料枠あり。アカウント作成後、Ubuntu の仮想マシン（VM）を 1 台作成。
- **さくらのVPS** … 月額数百円〜。Ubuntu を選んで申し込む。
- **ConoHa VPS** … 同上。
- **AWS EC2** … 無料枠あり（12ヶ月）。Ubuntu を選べる。

**やること**

1. サービスに会員登録し、**Ubuntu 22.04 LTS**（または 20.04）の **仮想マシンを 1 台作成**する。
2. **SSH 用の鍵** をダウンロードするか、パスワードを設定する。**IP アドレス**をメモする。
3. ファイアウォールで **22 番ポート（SSH）** が開いているか確認する。

**このあと使うもの**: サーバーの **IP アドレス**、**ログイン方法**（鍵のパスまたはユーザー名・パスワード）。

#### ステップ 2: サーバーに SSH でログインする

手元の PC のターミナルで、サーバーに接続します。

**Mac・Linux の例**（鍵でログイン）:

```bash
ssh -i ダウンロードした鍵のパス ubuntu@123.45.67.89
```

- `123.45.67.89` を**あなたのサーバーの IP アドレス**に変える。
- ユーザー名はサービスにより `ubuntu` や `root` など違うので、マニュアルを確認。
- 初回「接続しますか？」と出たら `yes` と入力して Enter。

**Windows** の場合は、PowerShell で同じ `ssh` コマンドを使うか、**TeraTerm** や **PuTTY** で IP と鍵（またはパスワード）を指定して接続する。

ログインできたら `ubuntu@サーバー名:~$` のような **プロンプト** が出ます。以降のコマンドは **すべてこのサーバー上** で実行します。

#### ステップ 3: Node.js をインストールする

サーバー上で、次のコマンドを **1 行ずつ** 実行する。

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
```

```bash
sudo apt-get install -y nodejs
```

確認:

```bash
node -v
npm -v
```

バージョンが表示されれば OK。

#### ステップ 4: リポジトリを置く

**Git のインストール**（入っていない場合）:

```bash
sudo apt-get update
sudo apt-get install -y git
```

**クローン**（GitHub に上げている場合）:

```bash
cd ~
git clone https://github.com/あなたのGitHubユーザー名/badminton-app.git
cd badminton-app/scripts
```

`あなたのGitHubユーザー名` を実際のユーザー名に変える。**Private リポジトリ**の場合は、後述の「Private の場合」を参照。

#### ステップ 5: 依存関係と Chromium をインストールする

```bash
cd ~/badminton-app/scripts
npm install
```

```bash
npx playwright install chromium
```

```bash
npx playwright install-deps
```

`playwright install-deps` は Linux で Chromium を動かすためのライブラリで、**初回だけ**実行すればよい。

#### ステップ 6: 設定ファイル `.env` をサーバーに置く

**やること**: 手元の PC の **`scripts/.env` の内容全体** を、サーバーの **`~/badminton-app/scripts/.env`** にコピーする。

**方法 1: サーバーで nano で作成**

```bash
nano ~/badminton-app/scripts/.env
```

手元の `scripts/.env` の内容をすべてコピーして貼り付ける。保存: **Ctrl+O** → Enter。終了: **Ctrl+X**。

**方法 2: SCP で送る**（手元の PC で実行）

```bash
scp -i 鍵のパス 手元のパス/scripts/.env ubuntu@123.45.67.89:~/badminton-app/scripts/.env
```

IP とユーザー名をあなたの環境に合わせて変更する。

#### ステップ 7: 10 分ごとに実行する cron を登録する

1. サーバーで:
   ```bash
   crontab -e
   ```
2. エディタ選択が出たら **nano** なら `1` で Enter。
3. ファイルの **末尾** に次の 1 行を追加する:
   ```cron
   */10 * * * * cd /home/ubuntu/badminton-app/scripts && /usr/bin/npm run check >> /home/ubuntu/facility-check.log 2>&1
   ```
   - ユーザー名が `ubuntu` でない場合: `/home/ubuntu` を **`/home/$(whoami)`** に変える（または `whoami` で出た名前にする）。
   - npm のパスは `which npm` で確認できる。
4. 保存: **Ctrl+O** → Enter → **Ctrl+X**。

**ログを見る**:

```bash
tail -f ~/facility-check.log
```

これで、サーバーが動いている間は PC を付けていなくても 10 分ごとにチェックされ、空きがあれば LINE に通知されます。

**Private リポジトリの場合**: GitHub で **Personal access token** を発行し、次のようにクローンする:

```bash
git clone https://トークン@github.com/あなたのユーザー名/badminton-app.git
```

---

### 方法 B: GitHub Actions で定期実行（詳細手順）

**流れ**: ① リポジトリを GitHub に push する → ② シークレットに `.env` の全文を登録する → ③ 実行間隔を確認・変更する（任意）

**注意**: 10 分ごとだと 1 ヶ月で約 4,000 分以上使うため、**Private の無料枠（2,000 分/月）を超えます**。無料で使う場合は **30 分ごと** や **1 時間ごと** にするとよいです。

#### ステップ 1: リポジトリを GitHub に push する

1. GitHub で **新しいリポジトリ** を作成する（または既存を使う）。
2. 手元の PC で:
   ```bash
   git remote add origin https://github.com/あなたのユーザー名/badminton-app.git
   git branch -M main
   git push -u origin main
   ```
   すでに `remote` がある場合は `git push` だけでよい。
3. **`scripts/.env` は push しない**。`.gitignore` に `.env` が含まれているか確認する。

#### ステップ 2: シークレット「ENV_CONTENT」を登録する

1. リポジトリの **「Settings」** をクリック。
2. 左メニューで **「Secrets and variables」** → **「Actions」** をクリック。
3. **「New repository secret」** をクリック。
4. **Name** に **`ENV_CONTENT`** と入力（大文字・小文字を正確に）。
5. **Secret** の欄に、**手元の `scripts/.env` の内容をすべて** コピーして貼り付ける（1 行目から最後まで、改行もそのまま）。
6. **「Add secret」** をクリックして保存。

#### ステップ 3: 実行間隔を確認・変更する（任意）

- リポジトリに **`.github/workflows/check-availability.yml`** があれば、push 後に **自動で有効** になる。
- **30 分ごと** にしたい: そのファイルを開き、`cron: '*/10 * * * *'` を `cron: '*/30 * * * *'` に変更して保存。
- **1 時間ごと** にしたい: `cron: '0 * * * *'` に変更。

**手動で 1 回だけ実行**: リポジトリの **「Actions」** タブ → **「Check facility availability」** → **「Run workflow」** をクリック。

**うまく動かないとき**

- 「ENV_CONTENT が未設定」→ シークレット名が `ENV_CONTENT` か、値が空でないか確認。
- 実行はされるが LINE に届かない → Actions の実行ログを開き、エラーや「空きあり」のメッセージを確認。`.env` の内容（LINE の ID や施設名）も見直す。

---

## まとめ

| やりたいこと | 入力する場所 | 実行コマンド |
|--------------|----------------|--------------|
| 予約サイトのID・パスワード、LINE の Channel ID / secret / ユーザーID | `scripts/.env` | （設定のみ） |
| 1回だけ空きチェック | 上記のまま | `cd scripts` → `npm run check` |
| 10分ごとにチェック（PC を起動したまま） | 上記のまま | `cd scripts` → `npm run schedule` |
| **PC を付けずに 10 分ごと** | 上記のまま | **「3. パソコンを起動していなくても動かす」** の VPS+cron または GitHub Actions を参照 |

- **Channel ID** と **Channel secret** は LINE Official Account Manager の API 設定画面で確認・コピーできます。  
- **Webhook URL** は Manager の画面で設定します。通知を送るだけなら空でも動作しますが、LINE_USER_ID を取得するときには Webhook に URL を設定する必要があります。  
- エラーが出たときは、ターミナルのメッセージを確認し、`.env` の各項目が正しく入力されているか見直してください。
