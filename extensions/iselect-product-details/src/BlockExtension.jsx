import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { validateQuickProductData } from "../../../lib/templates/quickProduct";
import { ProductForm } from "../../shared/ProductForm.jsx";
import { callBackend, uploadImages, toNumericId } from "../../shared/api.js";

export default async () => {
  render(<ProductEditBlock />, document.body);
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

function ProductEditBlock() {
  const productId = toNumericId(
    shopify.data.selected && shopify.data.selected[0]
      ? shopify.data.selected[0].id
      : ""
  );
  const [loadState, setLoadState] = useState({ loading: true, error: "" });
  const [read, setRead] = useState(null);
  const [productType, setProductType] = useState("");
  const [values, setValues] = useState({});
  const [status, setStatus] = useState("");
  const [issues, setIssues] = useState({});
  const [formError, setFormError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageState, setImageState] = useState(null);

  async function load() {
    setLoadState({ loading: true, error: "" });
    const token = await shopify.auth.idToken().catch(() => null);
    if (!token) {
      setLoadState({
        loading: false,
        error: "Kon geen Shopify-sessietoken ophalen.",
      });
      return;
    }
    const res = await callBackend(
      `/api/shopify/quick-product?id=${encodeURIComponent(productId)}`,
      { method: "GET", token }
    );
    if (!res.ok) {
      setLoadState({ loading: false, error: res.error });
      return;
    }
    setRead(res.data);
    setProductType(res.data.productType || "");
    setValues(res.data.values || {});
    setStatus(res.data.status || "");
    setIssues({});
    setFormError("");
    setSavedMessage("");
    setLoadState({ loading: false, error: "" });
  }

  useEffect(() => {
    load();
  }, [productId]);

  function handleProductTypeChange(next) {
    setProductType(next);
    setIssues({});
    setFormError("");
    setSavedMessage("");
  }

  function handleValueChange(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSavedMessage("");
    setIssues((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setFormError("");
    setSavedMessage("");
    const validation = validateQuickProductData(productType, values);
    setIssues(issuesByKey(validation));
    if (!validation.ok) {
      setFormError("Vul de gemarkeerde velden correct in.");
      setBusy(false);
      return;
    }
    const token = await shopify.auth.idToken().catch(() => null);
    if (!token) {
      setFormError("Kon geen Shopify-sessietoken ophalen.");
      setBusy(false);
      return;
    }
    const res = await callBackend("/api/shopify/quick-update", {
      token,
      body: {
        productId,
        productType,
        values: validation.values,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setFormError(res.error);
      if (res.issues && res.issues.length) {
        setIssues(issuesFromList(res.issues));
      }
      return;
    }
    if (res.data) {
      setStatus(res.data.status || status);
      setRead((prev) => (prev ? { ...prev, ...res.data } : prev));
    }
    setSavedMessage("Opgeslagen — Shopify-titel en metafields zijn bijgewerkt.");
  }

  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    setImageState({ busy: true, message: "" });
    const token = await shopify.auth.idToken().catch(() => null);
    if (!token) {
      setImageState({
        busy: false,
        message: "Kon geen Shopify-sessietoken ophalen.",
      });
      return;
    }
    const uploaded = await uploadImages({ token, productId, files });
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
    <s-admin-block
      heading="iSelect productgegevens"
      collapsedSummary="Template-velden, prijzen en titels bewerken"
    >
      <s-stack direction="block" gap="base">
        {loadState.loading ? (
          <s-spinner accessibilityLabel="Product laden…" />
        ) : null}

        {loadState.error ? (
          <s-stack direction="block" gap="base">
            <s-banner tone="critical" heading="Laden mislukt">
              {loadState.error}
            </s-banner>
            <s-button onClick={load}>Opnieuw proberen</s-button>
          </s-stack>
        ) : null}

        {!loadState.loading && !loadState.error && read ? (
          <s-stack direction="block" gap="base">
            {formError ? (
              <s-banner tone="critical" heading="Fout">
                {formError}
              </s-banner>
            ) : null}
            {savedMessage ? (
              <s-banner tone="success" heading="Opgeslagen">
                {savedMessage}
              </s-banner>
            ) : null}

            <ProductForm
              productType={productType}
              onProductTypeChange={handleProductTypeChange}
              status={status}
              values={values}
              issues={issues}
              onChange={handleValueChange}
            />

            <s-button loading={busy} disabled={busy} onClick={save}>
              Opslaan
            </s-button>

            <s-divider />
            <s-text type="strong">Afbeeldingen</s-text>
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
    </s-admin-block>
  );
}
