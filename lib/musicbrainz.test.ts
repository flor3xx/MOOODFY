import assert from "node:assert/strict";
import test from "node:test";
import { MAX_QUERY_LENGTH, normalizeQuery, searchRecordings } from "./musicbrainz.ts";

const USER_AGENT = "MOOODFY/test (test@example.invalid)";

const RADIOHEAD = {
  recordings: [
    {
      id: "rec-1",
      title: "Creep",
      "artist-credit": [{ name: "Radiohead", artist: { name: "Radiohead" } }],
      releases: [
        {
          title: "Pablo Honey",
          date: "1993-02-22",
          "release-group": { title: "Pablo Honey" },
        },
      ],
      "first-release-date": "1992-09-21",
    },
    {
      id: "rec-2",
      title: "Creep (acoustic)",
      "artist-credit": [{ artist: { name: "Radiohead" } }],
      releases: [{ title: "EP", date: "1993" }],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { url: URL; init: RequestInit };

function recordingFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchImpl = (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(jsonResponse(body, status));
  };
  return { calls, fetchImpl };
}

test("query is trimmed and inner whitespace collapsed", () => {
  assert.deepEqual(normalizeQuery("  radio   head \n"), { ok: true, query: "radio head" });
});

test("empty, missing and non-string queries are rejected as empty", () => {
  for (const input of ["", "   ", null, undefined, ["a"], 42]) {
    assert.deepEqual(normalizeQuery(input), { ok: false, reason: "empty" }, `input: ${String(input)}`);
  }
});

test(`a query longer than ${MAX_QUERY_LENGTH} characters is rejected`, () => {
  assert.deepEqual(normalizeQuery("a".repeat(MAX_QUERY_LENGTH)), {
    ok: true,
    query: "a".repeat(MAX_QUERY_LENGTH),
  });
  assert.deepEqual(normalizeQuery("a".repeat(MAX_QUERY_LENGTH + 1)), {
    ok: false,
    reason: "too_long",
  });
});

test("an invalid query never reaches the provider", async () => {
  let called = false;
  const outcome = await searchRecordings({
    q: "   ",
    userAgent: USER_AGENT,
    fetchImpl: () => {
      called = true;
      return Promise.resolve(jsonResponse({}));
    },
  });
  assert.deepEqual(outcome, { ok: false, code: "invalid_query" });
  assert.equal(called, false);
});

test("a missing User-Agent is reported before any network call", async () => {
  const previous = process.env.MUSICBRAINZ_USER_AGENT;
  delete process.env.MUSICBRAINZ_USER_AGENT;
  try {
    let called = false;
    const outcome = await searchRecordings({
      q: "radiohead",
      fetchImpl: () => {
        called = true;
        return Promise.resolve(jsonResponse({}));
      },
    });
    assert.deepEqual(outcome, { ok: false, code: "not_configured" });
    assert.equal(called, false);
  } finally {
    if (previous !== undefined) process.env.MUSICBRAINZ_USER_AGENT = previous;
  }
});

test("the provider request is bounded, encoded and identified", async () => {
  const { calls, fetchImpl } = recordingFetch(RADIOHEAD);
  await searchRecordings({ q: "sigur rós & co", userAgent: USER_AGENT, fetchImpl });

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url.origin + url.pathname, "https://musicbrainz.org/ws/2/recording");
  assert.equal(url.searchParams.get("query"), "sigur rós & co");
  assert.equal(url.searchParams.get("fmt"), "json");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.match(String(url), /query=sigur\+r%C3%B3s\+%26\+co/);

  const headers = init.headers as Record<string, string>;
  assert.equal(headers["User-Agent"], USER_AGENT);
  assert.equal(headers.Accept, "application/json");
  assert.ok(init.signal, "a timeout signal must be attached");
});

test("normalization keeps only the stable UI fields", async () => {
  const { fetchImpl } = recordingFetch(RADIOHEAD);
  const outcome = await searchRecordings({ q: "creep", userAgent: USER_AGENT, fetchImpl });

  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.results, [
    {
      mbid: "rec-1",
      title: "Creep",
      artists: ["Radiohead"],
      releaseTitle: "Pablo Honey",
      firstReleaseDate: "1992-09-21",
      url: "https://musicbrainz.org/recording/rec-1",
    },
    {
      mbid: "rec-2",
      title: "Creep (acoustic)",
      artists: ["Radiohead"],
      releaseTitle: "EP",
      firstReleaseDate: "1993",
      url: "https://musicbrainz.org/recording/rec-2",
    },
  ]);
});

test("entries without an id or title are dropped, duplicates collapse", async () => {
  const { fetchImpl } = recordingFetch({
    recordings: [
      { title: "no id" },
      { id: "rec-9" },
      { id: "rec-9", title: "Duplicated" },
      { id: "rec-9", title: "Duplicated" },
      "not an object",
    ],
  });
  const outcome = await searchRecordings({ q: "x", userAgent: USER_AGENT, fetchImpl });

  assert.ok(outcome.ok);
  assert.deepEqual(
    outcome.results.map((r) => r.mbid),
    ["rec-9"],
  );
});

test("a recording without artists or release still renders", async () => {
  const { fetchImpl } = recordingFetch({ recordings: [{ id: "rec-3", title: "Bare" }] });
  const outcome = await searchRecordings({ q: "bare", userAgent: USER_AGENT, fetchImpl });

  assert.ok(outcome.ok);
  assert.deepEqual(outcome.results, [
    {
      mbid: "rec-3",
      title: "Bare",
      artists: [],
      releaseTitle: null,
      firstReleaseDate: null,
      url: "https://musicbrainz.org/recording/rec-3",
    },
  ]);
});

test("an implausible release date is dropped", async () => {
  const { fetchImpl } = recordingFetch({
    recordings: [{ id: "rec-4", title: "Odd date", "first-release-date": "0000-00-00" }],
  });
  const outcome = await searchRecordings({ q: "odd", userAgent: USER_AGENT, fetchImpl });

  assert.ok(outcome.ok);
  assert.equal(outcome.results[0]?.firstReleaseDate, null);
});

test("empty results are a successful empty state", async () => {
  const { fetchImpl } = recordingFetch({ recordings: [] });
  const outcome = await searchRecordings({ q: "zzzz", userAgent: USER_AGENT, fetchImpl });
  assert.deepEqual(outcome, { ok: true, results: [] });
});

test("provider failure, malformed json and wrong shape are distinct states without body leakage", async () => {
  const failed = recordingFetch({ error: "rate limited by upstream" }, 503);
  assert.deepEqual(
    await searchRecordings({ q: "x", userAgent: USER_AGENT, fetchImpl: failed.fetchImpl }),
    { ok: false, code: "provider_error" },
  );

  const broken = {
    fetchImpl: () =>
      Promise.resolve(new Response("<html>not json</html>", { status: 200 })),
  };
  assert.deepEqual(
    await searchRecordings({ q: "x", userAgent: USER_AGENT, fetchImpl: broken.fetchImpl }),
    { ok: false, code: "malformed_response" },
  );

  const wrongShape = recordingFetch({ artists: [] });
  assert.deepEqual(
    await searchRecordings({ q: "x", userAgent: USER_AGENT, fetchImpl: wrongShape.fetchImpl }),
    { ok: false, code: "malformed_response" },
  );
});

test("a provider that exceeds the timeout is reported as a timeout", async () => {
  const hanging = (_url: URL, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "TimeoutError")),
      );
    });

  const outcome = await searchRecordings({
    q: "slow",
    userAgent: USER_AGENT,
    fetchImpl: hanging,
    timeoutMs: 20,
  });
  assert.deepEqual(outcome, { ok: false, code: "timeout" });
});

test("a transport failure is reported as a provider error", async () => {
  const outcome = await searchRecordings({
    q: "down",
    userAgent: USER_AGENT,
    fetchImpl: () => Promise.reject(new TypeError("fetch failed")),
  });
  assert.deepEqual(outcome, { ok: false, code: "provider_error" });
});
