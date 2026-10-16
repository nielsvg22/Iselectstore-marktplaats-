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
  const [draftImages, setDraftImages] = useState([]);
  const [draftStatus, setDraftStatus] = useState("");

  // Foto's die de gebruiker vóór het aanmaken rechtstreeks in dit scherm
  // kiest (los van de "Haal info op via AI-foto"-omweg) — pas na het
  // aanmaken geüpload, want /api/shopify/quick-image heeft een bestaande
  // productId nodig.
  const [pendingFiles, setPendingFiles] = useState([]);
  const MAX_PENDING_FILES = 5;

  function fileIdentity(f) {
    return `${f.name}:${f.size}:${f.lastModified}`;
  }

  // s-drop-zone dispatches both an "input" and a "change" event for the
  // same selection (zelfde patroon als elk ander veld in ProductForm.jsx,
  // die altijd op beide luistert) — dedupe op bestandsidentiteit zodat dat
  // nooit dubbele entries oplevert.
  function handlePendingFiles(fileList) {
    if (submittingRef.current) return;
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
    setImageError("");
    setPendingFiles((prev) => {
      const known = new Set(prev.map(fileIdentity));
      const added = incoming.filter((f) => !known.has(fileIdentity(f)));
      return added.length === 0 ? prev : [...prev, ...added].slice(0, MAX_PENDING_FILES);
    });
  }

  async function fetchDraft(auto) {
    if (submittingRef.current || result) return;
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
    if (submittingRef.current) return;
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
    if (draft.images && draft.images.length > 0) {
      setDraftImages(draft.images);
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
    if (submittingRef.current || result) return;
    if (pendingFiles.length === 0 && draftImages.length === 0) {
      setImageError("Upload minimaal één foto voordat je het product aanmaakt.");
      return;
    }
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
        if (draftImages.length > 0) {
          const uploaded = await uploadDraftImages(token, res.data.productId, draftImages);
          added += uploaded.added;
          error = uploaded.error;
        }
        if (!error && pendingFiles.length > 0) {
          const uploaded = await uploadImages({ token, productId: res.data.productId, files: pendingFiles });
          added += uploaded.added;
          error = uploaded.error;
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

        {result ? null : (
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
                  {draftImages.length > 0 ? (
                    <s-text>{draftImages.length} foto{draftImages.length === 1 ? "" : "'s"} vanaf de AI-pagina geselecteerd.</s-text>
                  ) : null}
                  {pendingFiles.length > 0 ? (
                    <s-text tone="subdued">
                      {pendingFiles.length} foto{pendingFiles.length === 1 ? "" : "'s"} geselecteerd — worden na het aanmaken geüpload.
                    </s-text>
                  ) : null}
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
          disabled={busy}
          onClick={submit}
        >
          Product aanmaken
        </s-button>
      )}
      <s-button slot="secondary-actions" disabled={busy} onClick={() => { if (!submittingRef.current) shopify.close(); }}>
        Sluiten
      </s-button>
    </s-admin-action>
  );
}
