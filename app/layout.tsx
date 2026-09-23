import type { Metadata } from "next";
import { Courier_Prime, Public_Sans } from "next/font/google";
import { Header } from "@/components/Header";
import { currentRole } from "@/lib/roles";
import "./globals.css";

const ui = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", weight: ["400", "500", "600", "700", "800"] });
const print = Courier_Prime({ subsets: ["latin"], variable: "--font-courier-prime", weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "Intake Desk",
  description:
    "Document triage for a clinic's intake desk: the assistant reads and extracts, rules route, a person approves, and every value traces back to the page it came from.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const role = await currentRole();
  return (
    <html lang="en" className={`${ui.variable} ${print.variable}`}>
      <body>
        <Header role={role} />
        {children}
      </body>
    </html>
  );
}
