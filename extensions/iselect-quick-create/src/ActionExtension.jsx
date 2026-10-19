import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { getTemplate, listProductTypes } from "../../../lib/templates/registry";
import {
  validateQuickProductData,
  applyTemplateDefaults,
} from "../../../lib/templates/quickProduct";
import { ProductForm } from "../../shared/ProductForm.jsx";
import { callBackend, uploadImages, getIdToken, BACKEND_URL } from "../../shared/api.js";

import { PhotoSelection } from "../../shared/PhotoSelection.jsx";
import { ProductReview } from "../../shared/ProductReview.jsx";

function makeDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function base64FromDataUrl(dataUrl) {
  const idx = String(dataUrl || "").indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

async function uploadDraftImages(token, productId, images) {
  const result = { added: 0, error: "" };
  for (const img of images || []) {
    const res = await callBackend("/api/shopify/quick-image", {
      token,
      body: {
        productId,
        filename: img.filename || "image.jpg",
        data: base64FromDataUrl(img.dataUrl),
      },
    });
    if (!res.ok) {
      result.error = res.error;
      break;
    }
    result.added += 1;
  }
  return result;
}

export default async () => {
  render(<QuickCreateAction />, document.body);
};

function issuesByKey(validation) {
  const map = {};
  for (const issue of validation.issues) {
    map[issue.key] = issue.message;
  }
  return map;
}

function issuesFromList(list) {
  const map = {};
  for (const issue of list || []) {
    map[issue.key] = issue.message;
  }
  return map;
}

function issueSummary(validation) {
  return validation.issues.map((issue) => issue.message).join(" ");
}

function initialValues(productType) {
  const template = getTemplate(productType);
  return template ? applyTemplateDefaults(template, {}) : {};
}

function QuickCreateAction() {
  const firstType = listProductTypes()[0];
  const [productType, setProductType] = useState(firstType);
  const [status, setStatus] = useState("draft");
  const [values, setValues] = useState(() => initialValues(firstType));
  const [issues, setIssues] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [imageState, setImageState] = useState(null);
  const [imageError, setImageError] = useState("");
  const submittingRef = useRef(false);

  // Gekoppeld aan de "Haal info op via AI-foto"-link hieronder: dezelfde
  // draftId komt terug op /admin/quick-create, dat herkende velden + foto's
  // hieronder opslaat zodat dit open formulier ze automatisch overneemt.
  const [draftId] = useState(makeDraftId);
  const [photos, setPhotos] = useState([]);
  const photosRef = useRef([]);
  const importedPhotosRef = useRef(new Set());
  const [review, setReview] = useState(null);
  const reviewingRef = useRef(null);
  const [market, setMarket] = useState({ loading: false });
  const [draftStatus, setDraftStatus] = useState("");

  // Foto's die de gebruiker vóór het aanmaken rechtstreeks in dit scherm
  // kiest (los van de "Haal info op via AI-foto"-omweg) — pas na het
  // aanmaken geüpload, want /api/shopify/quick-image heeft een bestaande
  // productId nodig.
  const MAX_PENDING_FILES = 5;

  function fileIdentity(f) {
    return `${f.name}:${f.size}:${f.lastModified}`;
  }

  function updatePhotos(update) {
    const next = update(photosRef.current);
    photosRef.current = next;
    setPhotos(next);
  }

  // Geen losse "fotovoorbeeld"-aanroep meer (was lib/.../api.js:previewImageFile
  // -> /api/shopify/quick-photo-preview): dat round-trip-naar-de-server-en-
  // terug bleek herhaaldelijk onbetrouwbaar in de extensie-sandbox (zie git-
  // historie: blob:/data:-URL's werken hier ook al niet, en er is geen
  // natively-ondersteunde Shopify-bestandskiezer voor deze schermsoort —
  // shopify.resourcePicker ondersteunt alleen product/variant/collection).
  // De bestandsnaam + status is voldoende feedback; de echte foto verschijnt
  // zodra 'ie na het aanmaken naar Shopify wordt geüpload (uploadImages
  // hieronder, een al bewezen werkend, ander codepad).
  function handlePendingFiles(fileList) {
    if (submittingRef.current || reviewingRef.current) return;
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;
    if (incoming.some((f) => !/\.(jpe?g|png|webp|gif)$/i.test(f.name) || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.type))) {
      setImageError("Kies een JPG, PNG, WebP of GIF-afbeelding.");
      return;
    }
    if (incoming.some((f) => !f.size || f.size > 3 * 1024 * 1024)) {
      setImageError("Elke foto moet een geldig bestand van maximaal 3 MB zijn.");
      return;
    }
    const added = [];
    const known = new Set(photosRef.current.map((p) => p.id));
    for (const file of incoming) {
      const id = `local:${fileIdentity(file)}`;
      if (!known.has(id)) { added.push({ id, filename: file.name, file, loading: false }); known.add(id); }
    }
    const room = MAX_PENDING_FILES - photosRef.current.length;
    setImageError(added.length > room ? "Je kunt maximaal 5 foto's kiezen. Verwijder eerst een foto om een andere toe te voegen." : "");
    const accepted = added.slice(0, Math.max(0, room));
    updatePhotos((prev) => [...prev, ...accepted]);
  }

  function movePhoto(id, direction) {
    updatePhotos((prev) => {
      const from = prev.findIndex((p) => p.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  function makeMain(id) {
    updatePhotos((prev) => [...prev.filter((p) => p.id === id), ...prev.filter((p) => p.id !== id)]);
  }

  async function prepareReview() {
    if (reviewingRef.current || submittingRef.current) return;
    if (!photosRef.current.length) {
      setImageError("Upload minimaal één foto voordat je het product aanmaakt.");
      return;
    }
    const validation = validateQuickProductData(productType, values);
    setIssues(issuesByKey(validation));
    if (!validation.ok) {
      setFormError(`Vul de gemarkeerde velden correct in. ${issueSummary(validation)}`);
      return;
    }
    const snapshot = { productType, status, values: validation.values, photos: [...photosRef.current] };
    reviewingRef.current = snapshot;
    setReview(snapshot);
    setFormError("");
    setMarket({ loading: true });
    const token = await getIdToken();
    const check = token ? await callBackend("/api/shopify/quick-review", { token, body: { productType, values: validation.values, imageCount: snapshot.photos.length } }) : null;
    if (reviewingRef.current !== snapshot) return;
    setMarket(check?.ok ? { ...check.data, loading: false } : { loading: false, source: "unavailable", message: "De categoriecontrole kon niet worden geladen. Controleer de definitieve kenmerken in Marktplaats controle." });
  }

  async function fetchDraft(auto) {
    if (submittingRef.current || reviewingRef.current || result) return;
    if (!auto) setDraftStatus("Bezig met ophalen…");
    const token = await getIdToken();
    if (!token) {
      if (!auto) setDraftStatus("Kon geen Shopify-sessietoken ophalen.");
      return;
    }
    const res = await callBackend(`/api/shopify/quick-create/draft?draftId=${draftId}`, {
      method: "GET",
      token,
    });
    if (submittingRef.current || reviewingRef.current) return;
    const draft = res.ok ? res.data && res.data.draft : null;
    if (!draft) {
      if (!auto) setDraftStatus("Nog geen gegevens — upload eerst een foto op de AI-pagina.");
      return;
    }
    setValues((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [key, value] of Object.entries(draft.values || {})) {
        if (!next[key] && value) {
          next[key] = value;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    const added = [];
    for (const image of draft.images || []) {
      // Import each AI selection once; polling must not resurrect removed
      // photos or reset the merchant's chosen order/main photo.
      const id = `ai:${image.filename}:${image.dataUrl}`;
      if (importedPhotosRef.current.has(id)) continue;
      importedPhotosRef.current.add(id);
      if (photosRef.current.length + added.length < MAX_PENDING_FILES) added.push({ id, filename: image.filename, dataUrl: image.dataUrl, preview: image.dataUrl, loading: false });
    }
    if (added.length) {
      updatePhotos((prev) => [...prev, ...added]);
      setImageError("");
    }
    setDraftStatus(
      `✓ Bijgewerkt vanaf de AI-pagina (${new Date(draft.updatedAt).toLocaleTimeString("nl-NL")}).`
    );
  }

  // Automatisch pollen zolang het formulier open staat — geen handmatige
  // "Ophalen"-klik nodig zodra er op de AI-pagina iets herkend is.
  useEffect(() => {
    if (result) return;
    const interval = setInterval(() => fetchDraft(true), 4000);
    return () => clearInterval(interval);
  }, [result, draftId]);

  function handleProductTypeChange(next) {
    setProductType(next);
    setValues(initialValues(next));
    setIssues({});
    setFormError("");
  }

  function handleValueChange(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setIssues((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function submit() {
    if (submittingRef.current || result || !reviewingRef.current || market.loading) return;
    const { productType, status, values, photos } = reviewingRef.current;
    submittingRef.current = true;
    setBusy(true);
    setFormError("");
    try {
      const validation = validateQuickProductData(productType, values);
      setIssues(issuesByKey(validation));
      if (!validation.ok) {
        setFormError(
          `Vul de gemarkeerde velden correct in. ${issueSummary(validation)}`.trim()
        );
        return;
      }
      const token = await getIdToken();
      if (!token) {
        setFormError(
          "Kon geen Shopify-sessietoken ophalen. Sluit het venster, open het menu opnieuw en probeer het nog eens."
        );
        return;
      }
      const res = await callBackend("/api/shopify/quick-create", {
        token,
        body: { productType, status, values: validation.values },
      });
      if (!res.ok) {
        setFormError(res.error);
        if (res.issues && res.issues.length) {
          setIssues(issuesFromList(res.issues));
        }
        return;
      }
      setResult(res.data);
      setImageState({ busy: true, error: false, message: "Foto's worden toegevoegd. Houd dit venster open." });
      let added = 0;
      let error = "";
      try {
        for (const photo of photos) {
          const uploaded = photo.file
            ? await uploadImages({ token, productId: res.data.productId, files: [photo.file] })
            : await uploadDraftImages(token, res.data.productId, [{ filename: photo.filename, dataUrl: photo.dataUrl }]);
          added += uploaded.added;
          error = uploaded.error;
          if (error) break;
        }
      } catch {
        error = "De foto-upload is onderbroken.";
      }
      const message = `${added} foto${added === 1 ? "" : "'s"} toegevoegd.`;
      setImageState({ busy: false, error: Boolean(error), message: error ? `${message} ${error} Open het bestaande product om de foto's te controleren. Maak het product niet opnieuw aan.` : message });
    } catch {
      setFormError("Het aanmaken kon niet worden bevestigd. Controleer eerst het productoverzicht voordat je opnieuw probeert.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <s-admin-action heading="Nieuw product via iSelect template">
      <s-stack direction="block" gap="base">
        {formError ? (
          <s-banner tone="critical" heading="Fout">
            {formError}
          </s-banner>
        ) : null}

        {result ? (
          <s-banner
            tone={imageState && imageState.error ? "warning" : busy ? "info" : "success"}
            heading={busy ? "Product aangemaakt — foto's worden toegevoegd" : imageState && imageState.error ? "Product aangemaakt — controleer de foto's" : "Product aangemaakt"}
          >
            <s-stack direction="block" gap="base">
              <s-text>{result.title}</s-text>
              <s-text>
                <s-text type="strong">Shopify-titel: </s-text>
                {result.shopifyTitle}
              </s-text>
              <s-text>
                <s-text type="strong">Marktplaats-titel: </s-text>
                {result.marktplaatsTitle}
              </s-text>
              <s-text>
                Status: {result.status} · voorraad: 1
              </s-text>
              {imageState ? <s-text>{imageState.message}</s-text> : null}
              {!busy ? (
                <s-link href={`shopify:admin/products/${String(result.productId).split("/").pop()}`}>
                  Open product in Shopify
                </s-link>
              ) : null}
            </s-stack>
          </s-banner>
        ) : null}

        {result ? null : review ? <ProductReview review={review} market={market} /> : (
          <ProductForm
            productType={productType}
            onProductTypeChange={handleProductTypeChange}
            status={status}
            onStatusChange={setStatus}
            values={values}
            issues={issues}
            onChange={handleValueChange}
            aiShortcut={
              <s-stack direction="block" gap="base">
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-link
                    href={`${BACKEND_URL}/admin/quick-create?productType=${encodeURIComponent(productType)}&draftId=${draftId}`}
                    target="_blank"
                  >
                    📷 Haal info op via AI-foto
                  </s-link>
                  <s-button variant="tertiary" onClick={() => fetchDraft(false)}>
                    🔄 Nu ophalen
                  </s-button>
                  {draftStatus ? <s-text tone="subdued">{draftStatus}</s-text> : null}
                </s-stack>
                <s-stack direction="block" gap="base">
                  <s-text type="strong">Foto's (verplicht)</s-text>
                  <s-text>De eerste foto is de hoofdfoto. Verander hieronder de volgorde of verwijder een foto.</s-text>
                  <PhotoSelection
                    photos={photos}
                    onRemove={(id) => updatePhotos((prev) => prev.filter((p) => p.id !== id))}
                    onMove={movePhoto} onMain={makeMain}
                  />
                  <s-drop-zone
                    accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    required
                    disabled={busy}
                    error={imageError}
                    label="Sleep foto's hierheen of klik om te selecteren (max. 3 MB per bestand, max. 5 foto's)"
                    onInput={(event) => handlePendingFiles(event.currentTarget.files)}
                    onChange={(event) => handlePendingFiles(event.currentTarget.files)}
                  />
                </s-stack>
              </s-stack>
            }
          />
        )}
      </s-stack>

      {result ? (
        <s-button slot="primary-action" disabled={busy} onClick={() => { if (!submittingRef.current) shopify.close(); }}>
          Sluiten
        </s-button>
      ) : (
        <s-button
          slot="primary-action"
          loading={busy}
          disabled={busy || Boolean(review && market.loading)}
          onClick={review ? submit : prepareReview}
        >
          {review ? status === "active" ? "Aanmaken en publiceren" : "Concept aanmaken" : "Controleer product"}
        </s-button>
      )}
      <s-button slot="secondary-actions" disabled={busy} onClick={() => {
        if (submittingRef.current) return;
        if (review && !result) { reviewingRef.current = null; setReview(null); }
        else shopify.close();
      }}>
        {review && !result ? "Terug naar bewerken" : "Sluiten"}
      </s-button>
    </s-admin-action>
  );
}
