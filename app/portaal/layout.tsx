// Shell van het klantportaal: Poppins, header met het coral-merkteken,
// navigatie en een mini-footer. Geen auth-guard hier (de inlog-routes en
// het fout-scherm hangen er ook onder) — elke ingelogde pagina guarded zichzelf.
import Link from "next/link";
import { getSession } from "@/lib/customerAccount";
import { coral, line, muted, navy } from "./stijl";

export const metadata = {
  title: "Mijn account — iSelectStore",
  description: "Bestellingen, facturen en adresgegevens van je iSelectStore-account.",
};

const font = "'Poppins', system-ui, -apple-system, 'Segoe UI', sans-serif";

function Merkteken() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"
          stroke={coral}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span style={{ fontWeight: 700, fontSize: 17, color: navy, letterSpacing: "-.01em" }}>
        iSelect<span style={{ color: coral }}>Store</span>
      </span>
    </span>
  );
}

export default function PortaalLayout({ children }: { children: React.ReactNode }) {
  const ingelogd = getSession() !== null;

  return (
    <div style={{ fontFamily: font, minHeight: "100vh", background: "#fff", color: navy, display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
        @page { margin: 14mm; }
        @media print {
          .niet-printen { display: none !important; }
          body { background: #fff !important; }
          * { box-shadow: none !important; }
        }
      `}</style>

      <header
        className="niet-printen"
        style={{
          borderBottom: `1px solid ${line}`,
          background: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            maxWidth: 940,
            margin: "0 auto",
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <Link href="/portaal" style={{ textDecoration: "none" }}>
            <Merkteken />
          </Link>

          <nav style={{ display: "flex", gap: 16, fontSize: 14, fontWeight: 500, marginLeft: "auto" }}>
            <Link href="/portaal" style={{ color: navy, textDecoration: "none" }}>
              Bestellingen
            </Link>
            <Link href="/portaal/gegevens" style={{ color: navy, textDecoration: "none" }}>
              Gegevens
            </Link>
            {ingelogd ? (
              <Link href="/portaal/uitloggen" style={{ color: coral, textDecoration: "none", fontWeight: 600 }}>
                Uitloggen
              </Link>
            ) : (
              <Link href="/portaal/inloggen" style={{ color: coral, textDecoration: "none", fontWeight: 600 }}>
                Inloggen
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: 940, width: "100%", margin: "0 auto", padding: "28px 20px 48px" }}>
        {children}
      </main>

      <footer
        className="niet-printen"
        style={{ borderTop: `1px solid ${line}`, padding: "18px 20px", fontSize: 13, color: muted }}
      >
        <div style={{ maxWidth: 940, margin: "0 auto", display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "space-between" }}>
          <span>© iSelectStore — Klantportaal</span>
          <Link href={process.env.SHOPIFY_STOREFRONT_URL || "/"} style={{ color: muted }}>
            Terug naar de webshop →
          </Link>
        </div>
      </footer>
    </div>
  );
}
