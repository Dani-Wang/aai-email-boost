import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "AAI Email Boost",
  description: "Asia Accountability Initiative — Corporate outreach email tool",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-gray-50 min-h-screen">
        {children}
      </body>
    </html>
  )
}
