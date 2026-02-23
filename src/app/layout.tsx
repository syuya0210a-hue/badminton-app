import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "バドミントンサークルマッチ管理",
  description: "参加者管理・ペア生成・レート管理・勝率表示ができるバドミントンサークル用アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
