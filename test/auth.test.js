import test from "node:test";
import assert from "node:assert/strict";
import { getAuthConfig, isAuthorized } from "../src/auth.js";

test("bearer mode requires token", () => {
  assert.throws(() => getAuthConfig({ MCP_AUTH_MODE: "bearer" }), /requires MCP_ACCESS_TOKEN/);
});

test("bearer token is checked", () => {
  const config = getAuthConfig({ MCP_AUTH_MODE: "bearer", MCP_ACCESS_TOKEN: "secret" });
  assert.equal(isAuthorized({ headers: { authorization: "Bearer secret" } }, config), true);
  assert.equal(isAuthorized({ headers: { authorization: "Bearer nope" } }, config), false);
});

test("none mode allows request", () => {
  const config = getAuthConfig({ MCP_AUTH_MODE: "none" });
  assert.equal(isAuthorized({ headers: {} }, config), true);
});
