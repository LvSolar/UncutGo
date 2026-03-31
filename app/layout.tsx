import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UncutGo",
  description: "输入电影名，快速比较各平台片长，判断哪里更可能是无删减版。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
