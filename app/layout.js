import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const font = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "700"] });

export const metadata = {
  title: "Calorie",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Calorie", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#EEF3EC",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body className={font.className}>{children}</body>
    </html>
  );
}
