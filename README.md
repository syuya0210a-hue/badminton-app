# バドミントン参加者管理プロトタイプ

ブラウザ上だけで動く、シンプルなバドミントン参加者管理ツールです。

- **参加者追加フォーム**: 名前・レート・プレースタイル（ガチ / エンジョイ）を入力できます
- **参加者リスト**: 追加した参加者が、名前・レート・プレースタイルのバッジ付きで一覧表示されます
- **データ保存なし**: ページをリロード / ブラウザを閉じると、すべてリセットされます

## 使い方

### 1. そのまま開く

1. `index.html` をブラウザで開くだけで動作します。
2. 左側のフォームから参加者を追加すると、右側のリストに反映されます。

### 2. 簡易サーバーで動かす（任意）

Python が入っている環境であれば、以下でも起動できます。

```bash
cd badminton-app
python3 -m http.server 4173
```

ブラウザで `http://localhost:4173` を開いてください。

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
