import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pactora — Private financial records, built on trust",
  description: "A private family-and-friends ledger for loans, repayments, receipts, and agreements.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
