import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JinGPT - 크래프톤 포트폴리오사 지식베이스",
  description: "크래프톤 포트폴리오사 지식베이스 전문 어시스턴트",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
