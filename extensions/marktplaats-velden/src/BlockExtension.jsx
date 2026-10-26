import { useEffect, useMemo, useState } from "react";
import {
  AdminBlock,
  Box,
  Button,
  Divider,
  Form,
  InlineStack,
  Link,
  ProgressIndicator,
  Select,
  Text,
  TextField,
  Checkbox,
  Banner,
  reactExtension,
  useApi,
} from "@shopify/ui-extensions-react/admin";

import { PRODUCT_TEMPLATES, PRODUCT_TYPES } from "./templates";
import { getProductInfo, setProductType, setMetafields } from "./utils";

// Foto-upload + AI-herkenning kan niet in dit blok zelf draaien: Admin UI
// Extension-blokken hebben geen file-upload-component en een sterk beperkte
// sandbox. Dit blok linkt daarom door naar het Marktplaats-adminpaneel
// (dezelfde Vercel-app als de rest van deze integratie), waar dat wel kan —
// rechtstreeks naar de pagina van dit product, geen productId overtypen nodig.
const MARKTPLAATS_APP_URL = "https://iselectstore-marktplaats-app.vercel.app";

function numericProductId(gid) {
  return gid?.split("/").pop() ?? "";
}

const TARGET = "admin.product-details.block.render";
export default reactExtension(TARGET, () => <App />);

function App() {
  const { data } = useApi(TARGET);
  const productId = data.selected[0].id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [productType, setProductTypeState] = useState("");
  const [values, setValues] = useState({});

  useEffect(() => {
    (async () => {
      const res = await getProductInfo(productId);
      const product = res?.data?.product;
      setLoading(false);
      if (!product) return;

      setProductTypeState(product.productType || "");

      const existing = {};
      for (const edge of product.metafields?.edges ?? []) {
        existing[edge.node.key] = edge.node.value;
      }
      setValues(existing);
    })();
  }, [productId]);

  const template = useMemo(() => PRODUCT_TEMPLATES[productType], [productType]);

  async function handleProductTypeChange(newType) {
    setProductTypeState(newType);
    setSaveMessage(null);
    await setProductType(productId, newType);
  }

  function handleFieldChange(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit() {
    if (!template) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const entries = template
        .map((field) => ({ field, effective: values[field.key] ?? field.default }))
        .filter(({ effective }) => effective !== undefined && effective !== "")
        .map(({ field, effective }) => ({
          key: field.key,
          type: field.mfType,
          value: field.kind === "boolean" ? String(Boolean(effective)) : String(effective),
        }));

      const res = await setMetafields(productId, entries);
      const errors = res?.data?.metafieldsSet?.userErrors ?? [];
      if (errors.length > 0) {
        setSaveMessage({ tone: "critical", text: errors.map((e) => e.message).join(", ") });
      } else {
        setSaveMessage({ tone: "success", text: "Marktplaats-kenmerken opgeslagen." });
      }
    } finally {
      setSaving(false);
    }
  }

  function onReset() {
    setSaveMessage(null);
  }

  if (loading) {
    return (
      <InlineStack blockAlignment="center" inlineAlignment="center">
        <ProgressIndicator size="large-100" />
      </InlineStack>
    );
  }

  return (
    <AdminBlock title="Marktplaats-kenmerken">
      <Box paddingBlockEnd="base">
        <Link href={`${MARKTPLAATS_APP_URL}/admin/${numericProductId(productId)}`} target="_blank">
          🤖 Velden uit foto herkennen (AI) →
        </Link>
      </Box>

      <Box paddingBlockEnd="base">
        <Select
          label="Producttype (bepaalt welke velden hieronder verschijnen)"
          value={productType}
          onChange={handleProductTypeChange}
          options={[
            { label: "— Kies producttype —", value: "" },
            ...PRODUCT_TYPES.map((t) => ({ label: t, value: t })),
          ]}
        />
      </Box>

      {!template && (
        <Banner tone="info">Kies eerst een producttype hierboven om de relevante Marktplaats-velden te tonen.</Banner>
      )}

      {template && (
        <Form id="marktplaats-velden-form" onSubmit={onSubmit} onReset={onReset}>
          {template.map((field, index) => (
            <Box key={field.key} paddingBlockEnd="small">
              {index > 0 && <Divider />}
              <Box paddingBlockStart="small">
                {field.kind === "select" ? (
                  <Select
                    label={field.label + (field.required ? " *" : "")}
                    value={values[field.key] ?? field.default ?? ""}
                    onChange={(v) => handleFieldChange(field.key, v)}
                    options={[
                      { label: "—", value: "" },
                      ...field.options.map((o) => ({ label: o, value: o })),
                    ]}
                  />
                ) : field.kind === "boolean" ? (
                  <Checkbox
                    checked={values[field.key] === "true" || values[field.key] === true}
                    onChange={(v) => handleFieldChange(field.key, v)}
                  >
                    {field.label}
                  </Checkbox>
                ) : (
                  <TextField
                    label={field.label + (field.required ? " *" : "")}
                    value={values[field.key] != null && values[field.key] !== "" ? String(values[field.key]) : (field.default ?? "")}
                    onChange={(v) => handleFieldChange(field.key, v)}
                    multiline={field.kind === "textarea" ? 3 : undefined}
                  />
                )}
              </Box>
            </Box>
          ))}

          {saveMessage && (
            <Box paddingBlockStart="base">
              <Banner tone={saveMessage.tone}>{saveMessage.text}</Banner>
            </Box>
          )}

          <Box paddingBlockStart="base">
            <InlineStack inlineAlignment="end" gap="base">
              <Button onPress={onSubmit} variant="primary" disabled={saving}>
                {saving ? "Opslaan…" : "Marktplaats-kenmerken opslaan"}
              </Button>
            </InlineStack>
          </Box>
        </Form>
      )}

      <Box paddingBlockStart="base">
        <Text tone="subdued" fontWeight="regular">
          Deze kenmerken worden gebruikt om de Marktplaats-titel, -beschrijving en -attributen automatisch te
          genereren in het Marktplaats-paneel.
        </Text>
      </Box>
    </AdminBlock>
  );
}
