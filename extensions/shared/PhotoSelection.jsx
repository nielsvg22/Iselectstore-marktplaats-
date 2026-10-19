/** @jsxImportSource preact */
// photo.preview (een data-URL) komt alleen van de AI-foto-omweg, die de
// afbeelding server-side al meelevert — lokaal gekozen bestanden tonen hier
// geen thumbnail (zie ActionExtension.jsx voor waarom), alleen de
// bestandsnaam + status; de echte foto is te zien zodra die na het aanmaken
// naar Shopify is geüpload.
export function PhotoSelection({ photos, onRemove, onMove, onMain, readOnly = false }) {
  return (
    <s-stack direction="block" gap="base">
      {photos.map((photo, index) => (
        <s-box key={photo.id} padding="base" border="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="base" alignItems="center">
              {photo.preview ? <s-thumbnail src={photo.preview} alt={`Foto ${index + 1}: ${photo.filename}`} size="large" /> : null}
              <s-stack direction="block" gap="small">
                <s-text>{index + 1}. {photo.filename}</s-text>
                {index === 0 ? <s-badge>Hoofdfoto</s-badge> : null}
              </s-stack>
            </s-stack>
            {!readOnly ? (
              <s-stack direction="inline" gap="small">
                <s-button accessibilityLabel={`Foto ${index + 1} omhoog`} disabled={index === 0} onClick={() => onMove(photo.id, -1)}>Omhoog</s-button>
                <s-button accessibilityLabel={`Foto ${index + 1} omlaag`} disabled={index === photos.length - 1} onClick={() => onMove(photo.id, 1)}>Omlaag</s-button>
                <s-button disabled={index === 0} onClick={() => onMain(photo.id)}>Als hoofdfoto</s-button>
                <s-button accessibilityLabel={`Verwijder foto ${index + 1}`} onClick={() => onRemove(photo.id)}>Verwijderen</s-button>
              </s-stack>
            ) : null}
          </s-stack>
        </s-box>
      ))}
    </s-stack>
  );
}
