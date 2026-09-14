import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { routeRequest } from "../src/http/router";

const request = new Request(
  "https://oddlyuseful.studio/.well-known/apple-app-site-association"
);

function makeEnv(appleAppId?: string): Env {
  const baseEnv: Env = {
    CANONICAL_ORIGIN: "https://oddlyuseful.studio",
    ROOMS: {} as Env["ROOMS"]
  };
  return appleAppId === undefined
    ? baseEnv
    : { ...baseEnv, APPLE_APP_ID: appleAppId };
}

describe("Apple App Site Association", () => {
  it("serves a no-redirect JSON association limited to room links", async () => {
    const response = await routeRequest(
      request,
      makeEnv("ABCDE12345.studio.oddlyuseful.cipherparty")
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("application/json");
    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response?.headers.get("Location")).toBeNull();
    expect(await response?.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["ABCDE12345.studio.oddlyuseful.cipherparty"],
            components: [
              {
                "/": "/room/*",
                comment: "Matches Cipher Party room invitations."
              }
            ]
          }
        ]
      }
    });
  });

  it("fails closed when the release association is missing or malformed", async () => {
    for (const appleAppId of [undefined, "", "not-an-app-id"]) {
      const response = await routeRequest(request, makeEnv(appleAppId));

      expect(response?.status).toBe(404);
      expect(response?.headers.get("Cache-Control")).toBe("no-store");
      expect(await response?.text()).toBe("Not found");
    }
  });

  it("does not intercept the browser room fallback route", async () => {
    const response = await routeRequest(
      new Request("https://oddlyuseful.studio/room/ABC234"),
      makeEnv("ABCDE12345.studio.oddlyuseful.cipherparty")
    );

    expect(response).toBeNull();
  });
});
