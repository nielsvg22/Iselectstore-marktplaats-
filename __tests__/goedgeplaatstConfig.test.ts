import { describe, it, expect, afterEach } from "vitest";
import { ForbiddenEndpointError, assertConceptStatusOnly, assertEndpointAllowed, getGoedgeplaatstConfig, isGoedgeplaatstMockMode } from "@/lib/goedgeplaatst/config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GoedGeplaatst config + hard guards", () => {
  it("forceert mock-modus zonder API-sleutel, ongeacht GOEDGEPLAATST_ENVIRONMENT", () => {
    delete process.env.GOEDGEPLAATST_API_KEY;
    process.env.GOEDGEPLAATST_ENVIRONMENT = "production";
    expect(isGoedgeplaatstMockMode()).toBe(true);
  });

  it("forceert mock-modus zonder userId, ook met een sleutel", () => {
    process.env.GOEDGEPLAATST_API_KEY = "secret";
    delete process.env.GOEDGEPLAATST_USER_ID;
    expect(isGoedgeplaatstMockMode()).toBe(true);
  });

  it("is niet in mock-modus met zowel sleutel als userId", () => {
    process.env.GOEDGEPLAATST_API_KEY = "secret";
    process.env.GOEDGEPLAATST_USER_ID = "123";
    expect(isGoedgeplaatstMockMode()).toBe(false);
  });

  it("default environment is sandbox", () => {
    delete process.env.GOEDGEPLAATST_ENVIRONMENT;
    expect(getGoedgeplaatstConfig().environment).toBe("sandbox");
    expect(getGoedgeplaatstConfig().baseUrl).toBe("https://dev-api.goedgeplaatst.nl/rest/v1/");
  });

  it("production environment gebruikt de productie-baseUrl", () => {
    process.env.GOEDGEPLAATST_ENVIRONMENT = "production";
    expect(getGoedgeplaatstConfig().baseUrl).toBe("https://api.goedgeplaatst.nl/rest/v1/");
  });

  it("blokkeert elk publish-pad, inclusief batch-varianten", () => {
    expect(() => assertEndpointAllowed("publish/")).toThrow(ForbiddenEndpointError);
    expect(() => assertEndpointAllowed("publish/batch")).toThrow(ForbiddenEndpointError);
    expect(() => assertEndpointAllowed("publish/batchall")).toThrow(ForbiddenEndpointError);
    expect(() => assertEndpointAllowed("publish/batchauto")).toThrow(ForbiddenEndpointError);
  });

  it("staat publish-paden alleen toe met GOEDGEPLAATST_ALLOW_PUBLISH=true", () => {
    process.env.GOEDGEPLAATST_ALLOW_PUBLISH = "true";
    expect(() => assertEndpointAllowed("publish/")).not.toThrow();
    expect(getGoedgeplaatstConfig().allowPublish).toBe(true);
  });

  it("default allowPublish is false", () => {
    delete process.env.GOEDGEPLAATST_ALLOW_PUBLISH;
    expect(getGoedgeplaatstConfig().allowPublish).toBe(false);
    expect(() => assertEndpointAllowed("publish/")).toThrow(ForbiddenEndpointError);
  });

  it("staat niet-publish-paden toe", () => {
    expect(() => assertEndpointAllowed("ads/")).not.toThrow();
    expect(() => assertEndpointAllowed("images/123")).not.toThrow();
    expect(() => assertEndpointAllowed("status/1/2")).not.toThrow();
  });

  it("staat alleen status=concept toe", () => {
    expect(() => assertConceptStatusOnly("concept")).not.toThrow();
    expect(() => assertConceptStatusOnly("active")).toThrow();
    expect(() => assertConceptStatusOnly("archive")).toThrow();
  });
});
