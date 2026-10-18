import assert from "node:assert/strict";
import test from "node:test";
import { authCallbackUrl, normalizeSiteUrl } from "./site-url.ts";

test("an absolute http or https URL is accepted and normalized", () => {
  assert.equal(normalizeSiteUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeSiteUrl("http://localhost:3000/"), "http://localhost:3000");
  assert.equal(normalizeSiteUrl("https://mooodfy.example"), "https://mooodfy.example");
  assert.equal(normalizeSiteUrl("  https://mooodfy.example///  "), "https://mooodfy.example");
  assert.equal(
    normalizeSiteUrl("https://mooodfy.example/app/"),
    "https://mooodfy.example/app",
    "a path prefix is kept, only trailing slashes go away",
  );
});

test("missing, empty and non-string values are rejected", () => {
  for (const value of [undefined, null, "", "   ", 42, [], {}]) {
    assert.equal(normalizeSiteUrl(value), null, `value: ${String(value)}`);
  }
});

test("relative and non-http values are rejected", () => {
  for (const value of [
    "/auth/callback",
    "mooodfy.example",
    "localhost:3000",
    "//evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>",
    "ftp://mooodfy.example",
    "file:///etc/passwd",
  ]) {
    assert.equal(normalizeSiteUrl(value), null, `value: ${value}`);
  }
});

test("credentials in the URL are rejected", () => {
  assert.equal(normalizeSiteUrl("https://user:password@mooodfy.example"), null);
  assert.equal(normalizeSiteUrl("https://user@mooodfy.example"), null);
});

test("query strings and fragments are rejected", () => {
  assert.equal(normalizeSiteUrl("https://mooodfy.example/?next=evil"), null);
  assert.equal(normalizeSiteUrl("https://mooodfy.example/#frag"), null);
});

test("the callback URL appends a single fixed path", () => {
  assert.equal(authCallbackUrl("http://localhost:3000/"), "http://localhost:3000/auth/callback");
  assert.equal(
    authCallbackUrl("https://mooodfy.example/app"),
    "https://mooodfy.example/app/auth/callback",
  );
  assert.equal(authCallbackUrl(undefined), null);
  assert.equal(authCallbackUrl("javascript:alert(1)"), null);
});

test("a normalized site URL never carries credentials or a query", () => {
  const normalized = normalizeSiteUrl("https://user:secret@mooodfy.example/path/?token=leak");
  assert.equal(normalized, null);

  const accepted = normalizeSiteUrl("https://mooodfy.example/path");
  assert.ok(accepted);
  const parsed = new URL(accepted);
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.equal(parsed.search, "");
});
