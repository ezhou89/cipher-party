import type { Env } from "../env";

const APPLE_APP_ID_PATTERN =
  /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function handleAppleAppSiteAssociation(env: Env): Response {
  const appId = env.APPLE_APP_ID?.trim();
  if (!appId || !APPLE_APP_ID_PATTERN.test(appId)) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(
    JSON.stringify({
      applinks: {
        details: [
          {
            appIDs: [appId],
            components: [
              {
                "/": "/room/*",
                comment: "Matches Cipher Party room invitations.",
              },
            ],
          },
        ],
      },
    }),
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "application/json",
      },
    },
  );
}
