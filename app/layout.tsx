export const metadata = {
  title: "iSelectStore — Marktplaats integratie",
  description: "Shopify naar Marktplaats: templates, mapping, publiceren en testen.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#f7f7f7", color: "#1f3049" }}>
        {children}
      </body>
    </html>
  );
}
