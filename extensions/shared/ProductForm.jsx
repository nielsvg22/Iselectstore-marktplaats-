/** @jsxImportSource preact */
import { getTemplate, listProductTypes } from "../../lib/templates/registry";
import { buildQuickProductTitles } from "../../lib/templates/quickProduct";

const STATUS_OPTIONS = [
  { value: "draft", label: "Concept (nog niet zichtbaar in de webshop)" },
  { value: "active", label: "Actief (direct zichtbaar in de webshop)" },
];

function acceptSelectValue(next, current) {
  if (!next || next === current) return false;
  return true;
}

export function ProductField({ field, value, error, onChange }) {
  const label = field.required ? field.label : `${field.label} (optioneel)`;
  if (field.kind === "boolean") {
    const handle = (event) => {
      const next = event.currentTarget.checked ? "true" : "false";
      if (next !== value) onChange(next);
    };
    return (
      <s-checkbox
        label={field.label}
        checked={value === "true"}
        details={field.help || ""}
        error={error || ""}
        onInput={handle}
        onChange={handle}
      />
    );
  }
  if (field.kind === "select") {
    const handle = (event) => {
      const next = event.currentTarget.value;
      if (acceptSelectValue(next, value)) onChange(next);
    };
    return (
      <s-select
        label={label}
        value={value || ""}
        details={field.help || ""}
        error={error || ""}
        placeholder="Kies een optie"
        onInput={handle}
        onChange={handle}
      >
        {(field.options || []).map((option) => (
          <s-option key={option} value={option} selected={value === option}>
            {option}
          </s-option>
        ))}
      </s-select>
    );
  }
  if (field.kind === "textarea") {
    return (
      <s-text-area
        label={label}
        value={value || ""}
        details={field.help || ""}
        error={error || ""}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    );
  }
  if (field.kind === "number") {
    return (
      <s-number-field
        label={label}
        value={value || ""}
        details={field.help || ""}
        error={error || ""}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    );
  }
  return (
    <s-text-field
      label={label}
      value={value || ""}
      details={field.help || ""}
      error={error || ""}
      onInput={(event) => onChange(event.currentTarget.value)}
    />
  );
}

export function ProductForm({
  productType,
  onProductTypeChange,
  status,
  onStatusChange,
  values,
  issues,
  onChange,
  aiShortcut,
}) {
  const template = getTemplate(productType);
  const titles = template ? buildQuickProductTitles(productType, values) : null;
  const typeError = (issues && issues.productType) || "";

  const handleType = (event) => {
    const next = event.currentTarget.value;
    if (acceptSelectValue(next, productType)) onProductTypeChange(next);
  };
  const handleStatus = (event) => {
    const next = event.currentTarget.value;
    if (acceptSelectValue(next, status)) onStatusChange(next);
  };

  return (
    <s-stack direction="block" gap="base">
      <s-select
        label="Producttype (iSelect-template)"
        value={productType || ""}
        error={typeError}
        onInput={handleType}
        onChange={handleType}
      >
        {listProductTypes().map((type) => (
          <s-option key={type} value={type} selected={type === productType}>
            {type}
          </s-option>
        ))}
      </s-select>

      {aiShortcut ?? null}

      {onStatusChange ? (
        <s-select
          label="Status in Shopify"
          value={status || "draft"}
          onInput={handleStatus}
          onChange={handleStatus}
        >
          {STATUS_OPTIONS.map((option) => (
            <s-option key={option.value} value={option.value} selected={option.value === status}>
              {option.label}
            </s-option>
          ))}
        </s-select>
      ) : (
        <s-text>
          <s-text type="strong">Status in Shopify: </s-text>
          {status || "onbekend"}
        </s-text>
      )}

      {template ? (
        template.fields.map((field) => (
          <ProductField
            key={field.key}
            field={field}
            value={values[field.key]}
            error={issues ? issues[field.key] : ""}
            onChange={(value) => onChange(field.key, value)}
          />
        ))
      ) : (
        <s-banner tone="warning" heading="Geen iSelect-template">
          {productType
            ? "Dit product heeft geen bekend iSelect-producttype. Kies hierboven een producttype om de iSelect-velden te bewerken."
            : "Kies hierboven een producttype om de iSelect-velden te tonen."}
        </s-banner>
      )}

      {titles ? (
        <s-stack direction="block" gap="base">
          <s-text type="strong">Live titelpreviews</s-text>
          <s-text>
            <s-text type="strong">Shopify: </s-text>
            {titles.shopifyTitle || "—"}
          </s-text>
          <s-text>
            <s-text type="strong">Marktplaats: </s-text>
            {titles.marktplaatsTitle || "—"}
          </s-text>
        </s-stack>
      ) : null}
    </s-stack>
  );
}
