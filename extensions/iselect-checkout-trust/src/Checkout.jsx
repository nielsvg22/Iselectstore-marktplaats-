import '@shopify/ui-extensions/preact';
import {render} from "preact";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  return (
    <s-banner heading={shopify.i18n.translate("heading")}>
      <s-stack direction="block" gap="small-300">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type="check-circle" />
          <s-text>{shopify.i18n.translate("warranty")}</s-text>
        </s-stack>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type="delivery" />
          <s-text>{shopify.i18n.translate("shipping")}</s-text>
        </s-stack>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type="star" />
          <s-text>{shopify.i18n.translate("reviews")}</s-text>
        </s-stack>
      </s-stack>
    </s-banner>
  );
}
