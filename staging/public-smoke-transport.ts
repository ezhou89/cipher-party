import type { BrowserContext } from "@playwright/test";

export interface PublicSmokeTransportFailures {
  unexpectedRequests: number;
  redirects: number;
}

export async function installPublicSmokeTransport(
  context: BrowserContext,
  origin: string,
  failures: PublicSmokeTransportFailures,
) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.origin !== origin ||
      !["GET", "HEAD"].includes(request.method()) ||
      url.search !== ""
    ) {
      failures.unexpectedRequests += 1;
      await route.abort("blockedbyclient");
      return;
    }
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400) {
      failures.redirects += 1;
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({ response });
  });
}
