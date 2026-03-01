# Supabase でデータを共有する設定

メンバー・試合履歴を Supabase に保存し、どの端末から開いても同じデータを表示できます。

---

## 1. Supabase でプロジェクトを作成

1. [https://supabase.com](https://supabase.com) にアクセスし、サインアップまたはログイン
2. **New project** でプロジェクトを作成（名前・パスワードは任意）
3. プロジェクトができたら、**Project URL と API キーをコピー**する。場所は次のどちらかです。

### 場所A: 「Connect」ボタンから（おすすめ）

- プロジェクトを開いたときの画面で、**「Connect」** というボタン（または「Project API keys」などのリンク）を探してクリック
- 開いたダイアログやページに **Project URL**（`https://xxxx.supabase.co`）と **anon key**（長い文字列）が表示されているので、それぞれコピー

### 場所B: 設定の API から

- 左メニューで **歯車アイコン（Project Settings）** をクリック
- 左のサブメニューで **「API」** をクリック（「Configuration」や「General」の近くにあることが多い）
- ページ内に **「Project URL」** または **「API URL」** と書いてある欄を探す（`https://xxxx.supabase.co` の形式）
- その下か近くに **「Project API keys」** や **「anon」** という項目があり、**anon public** のキー（長い文字列）が表示される。隠れている場合は **「Reveal」** をクリックして表示してからコピー

**「Project URL」という文字が画面上にない場合**  
同じ API のページに **「Configuration」** タブや **「API URL」** という名前で出ていることがあります。`https://` で始まり `.supabase.co` で終わるアドレスがそれです。

4. コピーした **Project URL** と **anon キー** は、あとで Step 3 で `.env.local` に貼り付けます。

---

## 2. テーブルを作成

1. Supabase の左メニュー **SQL Editor** を開く
2. **New query** をクリック
3. このリポジトリの **`supabase/schema.sql`** を開き、中身をすべてコピーして SQL Editor に貼り付ける
4. **Run**（または Ctrl+Enter）で実行

---

## 3. 環境変数を設定（Step 1 でコピーしたものを使う）

**「プロジェクト直下」** = `badminton-app` フォルダの中（`package.json` や `src` フォルダと同じ階層）です。

**「設定」** = **ファイルを1つ作って、その中に2行書く**だけです。ターミナルで何かコマンドを実行するのではありません。

### 手順

1. **Cursor で**、左のファイル一覧の **一番上（badminton-app の直下）** を右クリック → **New File**
2. ファイル名を **`.env.local`** にして作成
3. そのファイルを開き、次の2行を書く（`xxxx` と `eyJ...` の部分を **Step 1 でコピーしたあなたの URL とキー** に置き換える）

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....
```

**注意**: `.env.local` は `.gitignore` に含まれており、GitHub にはプッシュされません。

4. 保存したら、**ターミナルで** `npm run dev` を実行（すでに動いていれば一度止めてからもう一度実行）

---

## 4. Vercel にデプロイする場合

Vercel のプロジェクト設定で **Environment Variables** に、次の2つ（URL と anon キー）を追加してください。**Name** は `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` にします。  
本番でも同じ Supabase を参照し、全員でデータを共有できます。

---

## 動作

- **Supabase の URL・キーが設定されているとき**: データは Supabase に保存され、全員で共有されます
- **設定していないとき**: 従来どおりブラウザの localStorage に保存され、端末ごとのデータになります
