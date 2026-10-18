import assert from "node:assert/strict";
import test from "node:test";
import { MAX_QUERY_LENGTH, lookupRecording, normalizeMbid, normalizeQuery, searchRecordings } from "./musicbrainz.ts";

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

/* ------------------------------------------------------------------ */
/* single-recording lookup by MBID                                     */
/* ------------------------------------------------------------------ */

const MBID = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d";
const MBID_HEX = "b10bbbfccf9e42e0be17e2c3e1d2600d";

const RECORDING = {
  id: MBID,
  title: "Creep",
  "artist-credit": [{ name: "Radiohead", artist: { name: "Radiohead" } }],
  releases: [
    { title: "Pablo Honey", date: "1993-02-22", "release-group": { title: "Pablo Honey" } },
  ],
  "first-release-date": "1992-09-21",
};

test("an MBID is accepted in canonical form, with or without hyphens or case", () => {
  assert.equal(normalizeMbid(MBID), MBID);
  assert.equal(normalizeMbid(MBID.toUpperCase()), MBID);
  assert.equal(normalizeMbid(MBID_HEX), MBID);
  assert.equal(normalizeMbid(MBID_HEX.toUpperCase()), MBID);
  assert.equal(normalizeMbid(`  ${MBID}  `), MBID);
});

test("anything that is not a UUID is rejected", () => {
  const rejected = [
    undefined,
    null,
    42,
    ["x"],
    {},
    "",
    "   ",
    "not-a-uuid",
    "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600", // 31 hex chars
    "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600dd", // 33 hex chars
    "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600g", // not hex
    "b10bbbfc cf9e 42e0 be17 e2c3e1d2600d", // spaced, not hyphenated
    "../../etc/passwd",
    `${MBID}?inc=foo`,
    `${MBID}/extra`,
    `${MBID}%00`,
  ];
  for (const input of rejected) {
    assert.equal(normalizeMbid(input), null, `should reject: ${String(input)}`);
  }
});

test("an invalid MBID never reaches the provider", async () => {
  let called = false;
  const outcome = await lookupRecording({
    mbid: `${MBID}/../search`,
    userAgent: USER_AGENT,
    fetchImpl: () => {
      called = true;
      return Promise.resolve(jsonResponse({}));
    },
  });
  assert.deepEqual(outcome, { ok: false, code: "invalid_id" });
  assert.equal(called, false);
});

test("lookup reports a missing User-Agent before any network call", async () => {
  const previous = process.env.MUSICBRAINZ_USER_AGENT;
  delete process.env.MUSICBRAINZ_USER_AGENT;
  try {
    let called = false;
    const outcome = await lookupRecording({
      mbid: MBID,
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

test("the lookup request is the canonical recording URL, bounded and identified", async () => {
  const { calls, fetchImpl } = recordingFetch(RECORDING);
  await lookupRecording({ mbid: MBID.toUpperCase(), userAgent: USER_AGENT, fetchImpl });

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url.origin + url.pathname, `https://musicbrainz.org/ws/2/recording/${MBID}`);
  assert.equal(url.searchParams.get("fmt"), "json");
  assert.equal(url.searchParams.get("inc"), "artist-credits releases");
  assert.match(String(url), /inc=artist-credits\+releases/);

  const headers = init.headers as Record<string, string>;
  assert.equal(headers["User-Agent"], USER_AGENT);
  assert.equal(headers.Accept, "application/json");
  assert.ok(init.signal, "a timeout signal must be attached");
});

test("a lookup is normalized into the same stable Recording shape as search", async () => {
  const { fetchImpl } = recordingFetch(RECORDING);
  const outcome = await lookupRecording({ mbid: MBID, userAgent: USER_AGENT, fetchImpl });

  assert.deepEqual(outcome, {
    ok: true,
    recording: {
      mbid: MBID,
      title: "Creep",
      artists: ["Radiohead"],
      releaseTitle: "Pablo Honey",
      firstReleaseDate: "1992-09-21",
      url: `https://musicbrainz.org/recording/${MBID}`,
    },
  });
});

test("a recording without artist credits or releases still renders", async () => {
  const { fetchImpl } = recordingFetch({ id: MBID, title: "Bare" });
  const outcome = await lookupRecording({ mbid: MBID, userAgent: USER_AGENT, fetchImpl });

  assert.ok(outcome.ok);
  assert.deepEqual(outcome.recording, {
    mbid: MBID,
    title: "Bare",
    artists: [],
    releaseTitle: null,
    firstReleaseDate: null,
    url: `https://musicbrainz.org/recording/${MBID}`,
  });
});

test("an unknown but well-formed MBID is not_found, other failures are provider errors", async () => {
  const missing = recordingFetch({ error: "Not Found" }, 404);
  assert.deepEqual(
    await lookupRecording({ mbid: MBID, userAgent: USER_AGENT, fetchImpl: missing.fetchImpl }),
    { ok: false, code: "not_found" },
  );

  for (const status of [400, 429, 500, 503]) {
    const { fetchImpl } = recordingFetch({ error: "upstream said no" }, status);
    assert.deepEqual(
      await lookupRecording({ mbid: MBID, userAgent: USER_AGENT, fetchImpl }),
      { ok: false, code: "provider_error" },
      `status ${status}`,
    );
  }
});

test("lookup distinguishes malformed json from a wrong shape, without body leakage", async () => {
  const notJson = {
    fetchImpl: () => Promise.resolve(new Response("<html>nope</html>", { status: 200 })),
  };
  assert.deepEqual(
    await lookupRecording({ mbid: MBID, userAgent: USER_AGENT, fetchImpl: notJson.fetchImpl }),
    { ok: false, code: "malformed_response" },
  );

  for (const body of [{ title: "no id" }, { id: MBID }, {}, null, [], "creep", 7]) {
    const { fetchImpl } = recordingFetch(body);
    assert.deepEqual(
      await lookupRecording({ mbid: MBID, userAgent: USER_AGENT, fetchImpl }),
      { ok: false, code: "malformed_response" },
      JSON.stringify(body),
    );
  }

  const leaked = recordingFetch({ error: "rate limited by upstream" }, 503);
  const outcome = await lookupRecording({ mbid: MBID, userAgent: USER_AGENT, fetchImpl: leaked.fetchImpl });
  assert.deepEqual(outcome, { ok: false, code: "provider_error" });
  assert.equal(JSON.stringify(outcome).includes("rate limited"), false);
});

test("a lookup that exceeds the timeout is a timeout, a transport failure is a provider error", async () => {
  const hanging = (_url: URL, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "TimeoutError")),
      );
    });
  assert.deepEqual(
    await lookupRecording({ mbid: MBID, userAgent: USER_AGENT, fetchImpl: hanging, timeoutMs: 20 }),
    { ok: false, code: "timeout" },
  );
  assert.deepEqual(
    await lookupRecording({
      mbid: MBID,
      userAgent: USER_AGENT,
      fetchImpl: () => Promise.reject(new TypeError("fetch failed")),
    }),
    { ok: false, code: "provider_error" },
  );
});
