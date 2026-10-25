import { describe, expect, it } from "vitest";

import { faucetCorsHeaders } from "./faucet-cors.ts";

const ALLOWED = new Set(["https://carbs-kappa.vercel.app"]);

describe("faucet CORS", () => {
  it("answers a listed origin, with the Private Network Access answer when asked", () => {
    expect(faucetCorsHeaders("https://carbs-kappa.vercel.app", ALLOWED, false)).toEqual({
      "access-control-allow-origin": "https://carbs-kappa.vercel.app",
      "access-control-allow-methods": "POST",
      "access-control-allow-headers": "content-type",
      vary: "Origin",
    });
    expect(faucetCorsHeaders("https://carbs-kappa.vercel.app", ALLOWED, true)).toMatchObject({
      "access-control-allow-private-network": "true",
    });
  });

  it("says nothing to another origin or to a request without one, even when asked for private network access", () => {
    expect(faucetCorsHeaders("https://evil.example", ALLOWED, true)).toBeNull();
    expect(faucetCorsHeaders(undefined, ALLOWED, true)).toBeNull();
  });
});
