import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "求职Agent｜央国企求职规划助手",
    template: "%s｜求职Agent",
  },
  description:
    "以真实知识依据和行动计划，帮助学生完成央国企求职准备。",
  applicationName: "求职Agent",
  openGraph: {
    type: "website",
    locale: "zh_CN",
    title: "求职Agent｜央国企求职规划助手",
    description: "把央国企求职，变成一条看得见的路。",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "求职Agent——把央国企求职，变成一条看得见的路",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "求职Agent｜央国企求职规划助手",
    description: "AI 规划、真实依据与行动闭环。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
