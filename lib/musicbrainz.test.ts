import assert from "node:assert/strict";
import test from "node:test";
import {
  ARTIST_RECORDINGS_LIMIT,
  MAX_QUERY_LENGTH,
  browseArtistRecordings,
  lookupArtist,
  lookupRecording,
  normalizeMbid,
  normalizeQuery,
  normalizeSearchKind,
  providerFromUrl,
  searchArtists,
  searchRecordings,
  streamingLinks,
} from "./musicbrainz.ts";

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
      links: [],
    },
    {
      mbid: "rec-2",
      title: "Creep (acoustic)",
      artists: ["Radiohead"],
      releaseTitle: "EP",
      firstReleaseDate: "1993",
      url: "https://musicbrainz.org/recording/rec-2",
      links: [],
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
      links: [],
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
  assert.equal(url.searchParams.get("inc"), "artist-credits releases url-rels");
  assert.match(String(url), /inc=artist-credits\+releases\+url-rels/);

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
      links: [],
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
    links: [],
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

/* ------------------------------------------------------------------ */
/* search mode + artist search / lookup / recordings                   */
/* ------------------------------------------------------------------ */

test("search kind defaults to recording and only an explicit artist switches it", () => {
  assert.equal(normalizeSearchKind("artist"), "artist");
  assert.equal(normalizeSearchKind(" ARTIST "), "artist");
  for (const input of ["recording", "Artist?", "", "  ", null, undefined, 42, ["artist"]]) {
    assert.equal(normalizeSearchKind(input), "recording", `input: ${String(input)}`);
  }
});

const RADIOHEAD_ARTISTS = {
  artists: [
    {
      id: "art-1",
      name: "Radiohead",
      disambiguation: "English rock band",
      country: "GB",
      type: "Group",
    },
    { id: "art-2", name: "Radiohead Tribute" },
    { name: "no id" },
    { id: "art-1", name: "Radiohead" },
    "not an object",
  ],
};

test("artist search is bounded, identified and normalized into the stable Artist shape", async () => {
  const { calls, fetchImpl } = recordingFetch(RADIOHEAD_ARTISTS);
  const outcome = await searchArtists({ q: "  radio   head ", userAgent: USER_AGENT, fetchImpl });

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url.origin + url.pathname, "https://musicbrainz.org/ws/2/artist");
  assert.equal(url.searchParams.get("query"), "radio head");
  assert.equal(url.searchParams.get("fmt"), "json");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal((init.headers as Record<string, string>)["User-Agent"], USER_AGENT);
  assert.ok(init.signal, "a timeout signal must be attached");

  assert.ok(outcome.ok);
  assert.deepEqual(outcome.results, [
    {
      mbid: "art-1",
      name: "Radiohead",
      disambiguation: "English rock band",
      country: "GB",
      type: "Group",
      url: "https://musicbrainz.org/artist/art-1",
    },
    {
      mbid: "art-2",
      name: "Radiohead Tribute",
      disambiguation: null,
      country: null,
      type: null,
      url: "https://musicbrainz.org/artist/art-2",
    },
  ]);
});

test("an invalid or missing artist query never reaches the provider", async () => {
  let called = false;
  const fetchImpl = () => {
    called = true;
    return Promise.resolve(jsonResponse({}));
  };
  assert.deepEqual(await searchArtists({ q: "   ", userAgent: USER_AGENT, fetchImpl }), {
    ok: false,
    code: "invalid_query",
  });

  const previous = process.env.MUSICBRAINZ_USER_AGENT;
  delete process.env.MUSICBRAINZ_USER_AGENT;
  try {
    assert.deepEqual(await searchArtists({ q: "radiohead", fetchImpl }), {
      ok: false,
      code: "not_configured",
    });
  } finally {
    if (previous !== undefined) process.env.MUSICBRAINZ_USER_AGENT = previous;
  }
  assert.equal(called, false);
});

test("artist search failures stay typed and never leak the provider body", async () => {
  const failed = recordingFetch({ error: "upstream said no" }, 503);
  assert.deepEqual(
    await searchArtists({ q: "x", userAgent: USER_AGENT, fetchImpl: failed.fetchImpl }),
    { ok: false, code: "provider_error" },
  );
  const wrongShape = recordingFetch({ recordings: [] });
  assert.deepEqual(
    await searchArtists({ q: "x", userAgent: USER_AGENT, fetchImpl: wrongShape.fetchImpl }),
    { ok: false, code: "malformed_response" },
  );
  const empty = recordingFetch({ artists: [] });
  assert.deepEqual(
    await searchArtists({ q: "zzz", userAgent: USER_AGENT, fetchImpl: empty.fetchImpl }),
    { ok: true, results: [] },
  );
});

const ARTIST = {
  id: MBID,
  name: "Radiohead",
  disambiguation: "English rock band",
  country: "GB",
  type: "Group",
};

test("artist lookup validates the MBID and normalizes the artist", async () => {
  const { calls, fetchImpl } = recordingFetch(ARTIST);
  const outcome = await lookupArtist({ mbid: MBID_HEX.toUpperCase(), userAgent: USER_AGENT, fetchImpl });

  assert.equal(calls[0].url.origin + calls[0].url.pathname, `https://musicbrainz.org/ws/2/artist/${MBID}`);
  assert.equal(calls[0].url.searchParams.get("fmt"), "json");
  assert.deepEqual(outcome, {
    ok: true,
    artist: {
      mbid: MBID,
      name: "Radiohead",
      disambiguation: "English rock band",
      country: "GB",
      type: "Group",
      url: `https://musicbrainz.org/artist/${MBID}`,
    },
  });
});

test("an invalid artist MBID never reaches the provider", async () => {
  let called = false;
  const outcome = await lookupArtist({
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

test("an unknown artist is not_found, other failures are typed without body leakage", async () => {
  const missing = recordingFetch({ error: "Not Found" }, 404);
  assert.deepEqual(
    await lookupArtist({ mbid: MBID, userAgent: USER_AGENT, fetchImpl: missing.fetchImpl }),
    { ok: false, code: "not_found" },
  );

  const leaked = recordingFetch({ error: "rate limited by upstream" }, 503);
  const outcome = await lookupArtist({ mbid: MBID, userAgent: USER_AGENT, fetchImpl: leaked.fetchImpl });
  assert.deepEqual(outcome, { ok: false, code: "provider_error" });
  assert.equal(JSON.stringify(outcome).includes("rate limited"), false);

  for (const body of [{ name: "no id" }, { id: MBID }, {}, null, [], "radiohead"]) {
    const { fetchImpl } = recordingFetch(body);
    assert.deepEqual(
      await lookupArtist({ mbid: MBID, userAgent: USER_AGENT, fetchImpl }),
      { ok: false, code: "malformed_response" },
      JSON.stringify(body),
    );
  }
});

test("recordings by artist use the browse endpoint, bounded to the first page", async () => {
  const { calls, fetchImpl } = recordingFetch(RADIOHEAD);
  const outcome = await browseArtistRecordings({ mbid: MBID_HEX, userAgent: USER_AGENT, fetchImpl });

  assert.ok(outcome.ok);
  assert.deepEqual(
    outcome.recordings.map((r) => r.mbid),
    ["rec-1", "rec-2"],
  );
  const { url } = calls[0];
  assert.equal(url.origin + url.pathname, "https://musicbrainz.org/ws/2/recording");
  assert.equal(url.searchParams.get("artist"), MBID);
  assert.equal(url.searchParams.get("limit"), String(ARTIST_RECORDINGS_LIMIT));
  assert.equal(url.searchParams.get("fmt"), "json");
  assert.equal(url.searchParams.get("inc"), "artist-credits");
});

test("the recordings page size is clamped to the documented bound", async () => {
  const over = recordingFetch({ recordings: [] });
  await browseArtistRecordings({ mbid: MBID, userAgent: USER_AGENT, fetchImpl: over.fetchImpl, limit: 9999 });
  assert.equal(over.calls[0].url.searchParams.get("limit"), String(ARTIST_RECORDINGS_LIMIT));

  const under = recordingFetch({ recordings: [] });
  await browseArtistRecordings({ mbid: MBID, userAgent: USER_AGENT, fetchImpl: under.fetchImpl, limit: 0 });
  assert.equal(under.calls[0].url.searchParams.get("limit"), "1");

  const invalid = recordingFetch({ recordings: [] });
  await browseArtistRecordings({
    mbid: `${MBID}/x`,
    userAgent: USER_AGENT,
    fetchImpl: invalid.fetchImpl,
  });
  assert.equal(invalid.calls.length, 0, "an invalid MBID never reaches the provider");
});

/* ------------------------------------------------------------------ */
/* external provider links                                             */
/* ------------------------------------------------------------------ */

test("only canonical https provider URLs are accepted", () => {
  assert.deepEqual(providerFromUrl("https://open.spotify.com/track/abc"), {
    provider: "spotify",
    url: "https://open.spotify.com/track/abc",
  });
  assert.deepEqual(providerFromUrl("https://www.spotify.com/x"), {
    provider: "spotify",
    url: "https://www.spotify.com/x",
  });
  assert.deepEqual(providerFromUrl("https://music.apple.com/it/album/x/1?uo=4"), {
    provider: "apple_music",
    url: "https://music.apple.com/it/album/x/1?uo=4",
  });
  assert.deepEqual(providerFromUrl("https://itunes.apple.com/x"), {
    provider: "apple_music",
    url: "https://itunes.apple.com/x",
  });

  for (const bad of [
    "http://open.spotify.com/x",
    "javascript:alert(1)",
    "https://evil.example/x",
    "https://open.spotify.com.evil.example/x",
    "https://wikidata.org/wiki/Q1",
    "not a url",
    "",
    null,
    42,
  ]) {
    assert.equal(providerFromUrl(bad), null, `should reject: ${String(bad)}`);
  }
});

test("a recording lookup keeps only safe, de-duplicated Spotify/Apple url relations", async () => {
  const body = {
    ...RECORDING,
    relations: [
      { type: "streaming", url: { resource: "http://open.spotify.com/track/insecure" } },
      { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q1" } },
      { type: "streaming", url: { resource: "https://open.spotify.com/track/abc" } },
      { type: "streaming", url: { resource: "https://open.spotify.com/track/duplicate" } },
      { type: "streaming", url: { resource: "https://music.apple.com/it/album/x/1?uo=4" } },
      { type: "streaming", url: { resource: "javascript:alert(1)" } },
      "not an object",
    ],
  };
  const { fetchImpl } = recordingFetch(body);
  const outcome = await lookupRecording({ mbid: MBID, userAgent: USER_AGENT, fetchImpl });

  assert.ok(outcome.ok);
  assert.deepEqual(outcome.recording.links, [
    { provider: "spotify", url: "https://open.spotify.com/track/abc", direct: true },
    { provider: "apple_music", url: "https://music.apple.com/it/album/x/1?uo=4", direct: true },
  ]);
});

test("search results carry no links, because no url relation is requested", async () => {
  const { fetchImpl } = recordingFetch(RADIOHEAD);
  const outcome = await searchRecordings({ q: "creep", userAgent: USER_AGENT, fetchImpl });
  assert.ok(outcome.ok);
  assert.deepEqual(
    outcome.results.map((r) => r.links),
    [[], []],
  );
});

test("streaming links prefer the direct relation and fall back to a deterministic search", () => {
  const mixed = streamingLinks({
    title: "Creep",
    artists: ["Radiohead"],
    links: [{ provider: "spotify", url: "https://open.spotify.com/track/abc", direct: true }],
  });
  assert.deepEqual(mixed, [
    { provider: "spotify", url: "https://open.spotify.com/track/abc", direct: true },
    {
      provider: "apple_music",
      url: "https://music.apple.com/search?term=Creep+Radiohead",
      direct: false,
    },
  ]);

  const fallback = streamingLinks({ title: "Sigur Rós", artists: ["Sigur Rós"], links: [] });
  assert.deepEqual(fallback, [
    {
      provider: "spotify",
      url: "https://open.spotify.com/search/Sigur%20R%C3%B3s%20Sigur%20R%C3%B3s",
      direct: false,
    },
    {
      provider: "apple_music",
      url: "https://music.apple.com/search?term=Sigur+R%C3%B3s+Sigur+R%C3%B3s",
      direct: false,
    },
  ]);
});

test("fallback search URLs are encoded and never carry raw markup", () => {
  const links = streamingLinks({ title: "<script>alert(1)</script>", artists: [], links: [] });
  for (const link of links) {
    assert.equal(link.url.includes("<"), false, link.url);
    assert.equal(link.url.includes(">"), false, link.url);
    assert.match(link.url, /^https:\/\//);
  }
  assert.match(links[0].url, /%3Cscript%3E/);
  assert.match(links[1].url, /%3Cscript%3E/);
});
