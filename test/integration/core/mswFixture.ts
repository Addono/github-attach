import { http, HttpResponse } from "msw";

export type RecordedRequest = {
  method: string;
  url: string;
};

export type FixtureInteraction = {
  id: string;
  method: string;
  url: string | RegExp;
  response: {
    status: number;
    json?: unknown;
    text?: string;
    headers?: Record<string, string>;
  };
};

export type HttpFixture = {
  name: string;
  interactions: readonly FixtureInteraction[];
};

function urlMatches(actualUrl: string, expected: string | RegExp): boolean {
  if (typeof expected === "string") return actualUrl === expected;
  return expected.test(actualUrl);
}

/**
 * Creates MSW handlers that replay a fixture in strict order.
 * Any unexpected request (extra, out-of-order, or mismatched URL/method) fails the test.
 */
export function createFixtureHandlers(
  fixture: HttpFixture,
  record: RecordedRequest[],
) {
  const remaining: FixtureInteraction[] = [...fixture.interactions];

  const handler = http.all(/.*/, async ({ request }) => {
    const expected = remaining.shift();
    const actual = { method: request.method, url: request.url };
    record.push(actual);

    if (!expected) {
      throw new Error(
        `Fixture '${fixture.name}' received unexpected request: ${actual.method} ${actual.url}`,
      );
    }

    if (expected.method !== actual.method) {
      throw new Error(
        `Fixture '${fixture.name}' request mismatch at '${expected.id}': expected method ${expected.method}, got ${actual.method} (${actual.url})`,
      );
    }

    if (!urlMatches(actual.url, expected.url)) {
      throw new Error(
        `Fixture '${fixture.name}' request mismatch at '${expected.id}': expected URL ${String(expected.url)}, got ${actual.url}`,
      );
    }

    const headers = expected.response.headers;
    if (expected.response.json !== undefined) {
      return HttpResponse.json(expected.response.json, {
        status: expected.response.status,
        headers,
      });
    }

    if (expected.response.text !== undefined) {
      return HttpResponse.text(expected.response.text, {
        status: expected.response.status,
        headers,
      });
    }

    return new HttpResponse(null, {
      status: expected.response.status,
      headers,
    });
  });

  return {
    handlers: [handler],
    remainingCount: () => remaining.length,
  };
}
