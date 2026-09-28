import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";
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

  // Gekoppeld aan de "Haal info op via AI-foto"-link hieronder: dezelfde
  // draftId komt terug op /admin/quick-create, dat herkende velden + foto's
  // hieronder opslaat zodat dit open formulier ze automatisch overneemt.
  const [draftId] = useState(makeDraftId);
  const [draftImages, setDraftImages] = useState([]);
  const [draftStatus, setDraftStatus] = useState("");

  async function fetchDraft(auto) {
    if (busy || result) return;
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

  // Zodra het product is aangemaakt: foto's die via de AI-pagina zijn
  // opgehaald automatisch meesturen, zonder dat de gebruiker ze opnieuw
  // hoeft te uploaden in dit venster.
  useEffect(() => {
    if (!result || draftImages.length === 0) return;
    (async () => {
      setImageState({ busy: true, message: "" });
      const token = await getIdToken();
      if (!token) {
        setImageState({ busy: false, message: "Kon geen Shopify-sessietoken ophalen voor de AI-foto's." });
        return;
      }
      const uploaded = await uploadDraftImages(token, result.productId, draftImages);
      let message = "";
      if (uploaded.added > 0) {
        message = `${uploaded.added} foto${uploaded.added === 1 ? "" : "'s"} van de AI-pagina toegevoegd.`;
      }
      if (uploaded.error) {
        message = message ? `${message} ${uploaded.error}` : uploaded.error;
      }
      setImageState({ busy: false, message });
      setDraftImages([]);
    })();
  }, [result]);

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
    if (busy) return;
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
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(files) {
    if (!result || !files || files.length === 0) return;
    if (imageState && imageState.busy) return;
    setImageState({ busy: true, message: "" });
    try {
      const token = await getIdToken();
      if (!token) {
        setImageState({
          busy: false,
          message: "Kon geen Shopify-sessietoken ophalen.",
        });
        return;
      }
      const uploaded = await uploadImages({
        token,
        productId: result.productId,
        files,
      });
      let message = "";
      if (uploaded.added > 0) {
        message = `${uploaded.added} afbeelding${
          uploaded.added === 1 ? "" : "en"
        } toegevoegd.`;
      }
      if (uploaded.error) {
        message = message ? `${message} ${uploaded.error}` : uploaded.error;
      }
      setImageState({ busy: false, message });
    } finally {
      setImageState((prev) =>
        prev && prev.busy
          ? { busy: false, message: prev.message || "Upload afgebroken." }
          : prev
      );
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
          <s-banner tone="success" heading="Product aangemaakt">
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
            }
          />
        )}

        {result ? (
          <s-stack direction="block" gap="base">
            <s-text type="strong">Afbeeldingen toevoegen (optioneel)</s-text>
            {imageState && imageState.message ? (
              <s-text>{imageState.message}</s-text>
            ) : null}
            <s-drop-zone
              accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
              multiple
              disabled={Boolean(imageState && imageState.busy)}
              label="Sleep afbeeldingen hierheen of klik om te selecteren (max. 3 MB per bestand)"
              onChange={(event) => handleFiles(event.currentTarget.files)}
            />
          </s-stack>
        ) : null}
      </s-stack>

      {result ? (
        <s-button slot="primary-action" onClick={() => shopify.close()}>
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
      <s-button slot="secondary-actions" onClick={() => shopify.close()}>
        Sluiten
      </s-button>
    </s-admin-action>
  );
}
