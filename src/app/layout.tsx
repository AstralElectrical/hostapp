import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "HostApp", description: "Casia, la recepcionista con IA de tu restaurante." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
