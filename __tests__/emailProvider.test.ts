import { describe, it, expect } from "vitest";
import { MockEmailProvider } from "@/services/notifications/providers/mockProvider";

describe("MockEmailProvider", () => {
  it("returns ok without making network calls", async () => {
    const provider = new MockEmailProvider();
    const result = await provider.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("mock");
  });
});

describe("createEmailProvider", () => {
  it("selects mock provider by default", async () => {
    delete process.env.EMAIL_PROVIDER;
    const { createEmailProvider } = await import("@/services/notifications/emailProviderFactory");
    const provider = createEmailProvider();
    expect(provider.name).toBe("mock");
  });
});
