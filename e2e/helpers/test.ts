import { expect, test as base, type Route } from '@playwright/test';

type ExternalExrRequestGuardFixtures = {
  externalExrRequestGuard: void;
};

const GITHUB_HOSTNAME = 'github.com';
const GITHUB_USER_CONTENT_SUFFIX = '.githubusercontent.com';
const LOCAL_TEST_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export const test = base.extend<ExternalExrRequestGuardFixtures>({
  externalExrRequestGuard: [async ({ context, baseURL }, use) => {
    const blockedExternalExrUrls = new Set<string>();
    const routeHandler = async (route: Route): Promise<void> => {
      const requestUrl = route.request().url();
      if (isBlockedExternalExrRequest(requestUrl, baseURL ?? undefined)) {
        blockedExternalExrUrls.add(requestUrl);
        await route.abort('blockedbyclient');
        return;
      }

      await route.continue();
    };

    let testError: unknown;
    await context.route('**/*', routeHandler);
    try {
      await use();
    } catch (error) {
      testError = error;
    }

    await context.unroute('**/*', routeHandler);
    if (blockedExternalExrUrls.size > 0) {
      throw new Error(
        [
          'E2E tests must not read EXR files from non-GitHub external hosts.',
          'Blocked request URLs:',
          ...Array.from(blockedExternalExrUrls).sort().map((url) => `- ${url}`)
        ].join('\n')
      );
    }
    if (testError) {
      throw testError;
    }
  }, { auto: true }]
});

export { expect };
export type { Download, Locator, Page } from '@playwright/test';

function isBlockedExternalExrRequest(requestUrl: string, baseURL: string | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return false;
  }

  if (!parsed.pathname.toLowerCase().endsWith('.exr')) {
    return false;
  }
  if (isSameOriginTestRequest(parsed, baseURL)) {
    return false;
  }
  if (isGithubHostedRequest(parsed)) {
    return false;
  }
  return true;
}

function isSameOriginTestRequest(url: URL, baseURL: string | undefined): boolean {
  if (baseURL) {
    try {
      return url.origin === new URL(baseURL).origin;
    } catch {
      // Fall back to hostname checks below if Playwright supplies an invalid baseURL.
    }
  }

  return LOCAL_TEST_HOSTNAMES.has(url.hostname);
}

function isGithubHostedRequest(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === GITHUB_HOSTNAME || hostname.endsWith(GITHUB_USER_CONTENT_SUFFIX);
}
