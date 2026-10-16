"use client";

import { knoopGhost } from "../stijl";

// Printknop voor de bestelling/factuur — opent de printdialog van de browser.
export default function PrintKnop() {
  return (
    <button className="niet-printen" style={knoopGhost} onClick={() => window.print()} type="button">
      🖨 Print / bewaar als PDF
    </button>
  );
}
