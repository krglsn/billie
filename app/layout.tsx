import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Billie",
  description: "Pay invoices issued by human-backed agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
