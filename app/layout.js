import { Mali } from "next/font/google";
import "./globals.css";

const font = Mali({ subsets: ["thai", "latin"], weight: ["400", "500", "700"] });

export const metadata = {
  title: "Calorie",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Calorie", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
  other: { "mobile-web-app-capable": "yes" },
};
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#EAF4FF",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body className={font.className}>{children}</body>
    </html>
  );
}
