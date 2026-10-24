import { query } from "@/lib/db";

export interface PurchaseDeclaration {
  id: number;
  voornaam: string;
  achternaam: string;
  email: string | null;
  adres: string;
  postcode: string;
  woonplaats: string;
  datumVerkoop: string;
  product: string;
  bedrag: number;
  verklaringEigenaar: boolean;
  verklaringAbonnement: boolean;
  verklaringThuiskopie: boolean;
  handtekening: string;
  status: string;
  createdAt: string;
}

interface PurchaseDeclarationRow {
  id: number;
  voornaam: string;
  achternaam: string;
  email: string | null;
  adres: string;
  postcode: string;
  woonplaats: string;
  datum_verkoop: string;
  product: string;
  bedrag: string;
  verklaring_eigenaar: boolean;
  verklaring_abonnement: boolean;
  verklaring_thuiskopie: boolean;
  handtekening: string;
  status: string;
  created_at: string;
}

function fromRow(row: PurchaseDeclarationRow): PurchaseDeclaration {
  return {
    id: row.id,
    voornaam: row.voornaam,
    achternaam: row.achternaam,
    email: row.email,
    adres: row.adres,
    postcode: row.postcode,
    woonplaats: row.woonplaats,
    datumVerkoop: row.datum_verkoop,
    product: row.product,
    bedrag: Number(row.bedrag),
    verklaringEigenaar: row.verklaring_eigenaar,
    verklaringAbonnement: row.verklaring_abonnement,
    verklaringThuiskopie: row.verklaring_thuiskopie,
    handtekening: row.handtekening,
    status: row.status,
    createdAt: row.created_at,
  };
}

export interface CreatePurchaseDeclarationInput {
  voornaam: string;
  achternaam: string;
  email: string;
  adres: string;
  postcode: string;
  woonplaats: string;
  datumVerkoop: string;
  product: string;
  bedrag: number;
  verklaringEigenaar: boolean;
  verklaringAbonnement: boolean;
  verklaringThuiskopie: boolean;
  handtekening: string;
}

export async function createPurchaseDeclaration(input: CreatePurchaseDeclarationInput): Promise<PurchaseDeclaration> {
  const rows = await query<PurchaseDeclarationRow>(
    `INSERT INTO purchase_declarations
       (voornaam, achternaam, email, adres, postcode, woonplaats, datum_verkoop, product, bedrag,
        verklaring_eigenaar, verklaring_abonnement, verklaring_thuiskopie, handtekening)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      input.voornaam,
      input.achternaam,
      input.email || null,
      input.adres,
      input.postcode,
      input.woonplaats,
      input.datumVerkoop,
      input.product,
      input.bedrag,
      input.verklaringEigenaar,
      input.verklaringAbonnement,
      input.verklaringThuiskopie,
      input.handtekening,
    ]
  );
  return fromRow(rows[0]);
}

export async function listPurchaseDeclarations(): Promise<PurchaseDeclaration[]> {
  const rows = await query<PurchaseDeclarationRow>(`SELECT * FROM purchase_declarations ORDER BY created_at DESC`);
  return rows.map(fromRow);
}

export async function getPurchaseDeclarationById(id: number): Promise<PurchaseDeclaration | null> {
  const rows = await query<PurchaseDeclarationRow>(`SELECT * FROM purchase_declarations WHERE id = $1`, [id]);
  return rows[0] ? fromRow(rows[0]) : null;
}
