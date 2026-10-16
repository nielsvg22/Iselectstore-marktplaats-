/** @jsxImportSource preact */
export function PhotoSelection({ photos, onRemove, onMove, onMain, onRetry, readOnly = false }) {
  return (
    <s-stack direction="block" gap="base">
      {photos.map((photo, index) => (
        <s-box key={photo.id} padding="base" border="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="base" alignItems="center">
              {photo.preview ? <s-thumbnail src={photo.preview} alt={`Foto ${index + 1}: ${photo.filename}`} size="large" /> : photo.loading ? <s-spinner accessibilityLabel="Fotovoorbeeld laden" /> : <s-text>Geen fotovoorbeeld</s-text>}
              <s-stack direction="block" gap="small">
                <s-text>{index + 1}. {photo.filename}</s-text>
                {index === 0 ? <s-badge>Hoofdfoto</s-badge> : null}
                {photo.loading ? <s-text>Fotovoorbeeld laden…</s-text> : null}
                {photo.error ? <s-text>{photo.error}</s-text> : null}
              </s-stack>
            </s-stack>
            {!readOnly ? (
              <s-stack direction="inline" gap="small">
                <s-button accessibilityLabel={`Foto ${index + 1} omhoog`} disabled={index === 0} onClick={() => onMove(photo.id, -1)}>Omhoog</s-button>
                <s-button accessibilityLabel={`Foto ${index + 1} omlaag`} disabled={index === photos.length - 1} onClick={() => onMove(photo.id, 1)}>Omlaag</s-button>
                <s-button disabled={index === 0} onClick={() => onMain(photo.id)}>Als hoofdfoto</s-button>
                <s-button accessibilityLabel={`Verwijder foto ${index + 1}`} onClick={() => onRemove(photo.id)}>Verwijderen</s-button>
                {photo.error ? <s-button onClick={() => onRetry(photo)}>Voorbeeld opnieuw laden</s-button> : null}
              </s-stack>
            ) : null}
          </s-stack>
        </s-box>
      ))}
    </s-stack>
  );
}
