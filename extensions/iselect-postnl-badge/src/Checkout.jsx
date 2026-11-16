import '@shopify/ui-extensions/preact';
import {render} from "preact";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-badge tone="neutral">{shopify.i18n.translate("carrier")}</s-badge>
    </s-stack>
  );
}
