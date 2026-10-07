import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Boo Ballot · Office Costume Contest",
  description: "October 29, 2026. Verify your work email, meet the costumes, and vote in the Lebanon Social Club costume contest.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
