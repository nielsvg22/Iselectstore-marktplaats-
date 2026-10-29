import '@shopify/ui-extensions/preact';
import {render} from "preact";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  return (
    <s-box
      background="subdued"
      borderWidth="base"
      borderColor="subdued"
      borderRadius="base"
      padding="base"
    >
      <s-stack direction="inline" gap="small-200" alignItems="start">
        <s-icon type="location" />
        <s-text>{shopify.i18n.translate("note")}</s-text>
      </s-stack>
    </s-box>
  );
}
