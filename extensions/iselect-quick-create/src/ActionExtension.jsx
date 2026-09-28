import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";
import { getTemplate, listProductTypes } from "../../../lib/templates/registry";
import {
  validateQuickProductData,
  applyTemplateDefaults,
} from "../../../lib/templates/quickProduct";
import { ProductForm } from "../../shared/ProductForm.jsx";
import { callBackend, uploadImages } from "../../shared/api.js";

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
    setBusy(true);
    setFormError("");
    const validation = validateQuickProductData(productType, values);
    setIssues(issuesByKey(validation));
    if (!validation.ok) {
      setFormError("Vul de gemarkeerde velden correct in.");
      setBusy(false);
      return;
    }
    const token = await shopify.auth.idToken().catch(() => null);
    if (!token) {
      setFormError(
        "Kon geen Shopify-sessietoken ophalen. Sluit het venster en probeer opnieuw."
      );
      setBusy(false);
      return;
    }
    const res = await callBackend("/api/shopify/quick-create", {
      token,
      body: { productType, status, values: validation.values },
    });
    setBusy(false);
    if (!res.ok) {
      setFormError(res.error);
      if (res.issues && res.issues.length) {
        setIssues(issuesFromList(res.issues));
      }
      return;
    }
    setResult(res.data);
  }

  async function handleFiles(files) {
    if (!result || !files || files.length === 0) return;
    setImageState({ busy: true, message: "" });
    const token = await shopify.auth.idToken().catch(() => null);
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
