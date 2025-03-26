import { expect } from "jsr:@std/expect";
import { searchLogHandler, type SearchResponse } from "./normal.ts";
import { errorToResponse } from "./util.ts";

Deno.test("simple read", async () => {
  const response = await makeRequest("/fodder/simple.log");

  expect(response.status).toEqual(200);
  const { entries } = (await response.json()) as SearchResponse;

  // all entries returned
  expect(entries).toHaveLength(10);

  // returned in reverse order
  expect(entries[0].entry).toEqual(
    "2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10"
  );
  expect(entries[9].entry).toEqual(
    "2025-03-17 14:17:20 configure gettext:amd64 0.21-12 <none>"
  );
});

Deno.test("filtering", async () => {
  const response = await makeRequest("/fodder/simple.log?s=status");

  expect(response.status).toEqual(200);
  const { entries } = (await response.json()) as SearchResponse;

  // all matching enties returned
  expect(entries).toHaveLength(7);

  // returned in reverse order
  expect(entries[0].entry).toEqual(
    "2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10"
  );
  expect(entries[6].entry).toEqual(
    "2025-03-17 14:17:21 status unpacked gettext:amd64 0.21-12"
  );
});

Deno.test("limiting", async () => {
  const response = await makeRequest("/fodder/simple.log?n=3");

  expect(response.status).toEqual(200);
  const { entries } = (await response.json()) as SearchResponse;

  // all entries returned up to limit
  expect(entries).toHaveLength(3);

  // returned in reverse order
  expect(entries[0].entry).toEqual(
    "2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10"
  );
  expect(entries[2].entry).toEqual(
    "2025-03-17 14:17:27 trigproc libc-bin:amd64 2.36-9+deb12u10 <none>"
  );
});

Deno.test("filter, limit, and paginate", async () => {
  const page1Response = await makeRequest("/fodder/simple.log?s=status&n=3");

  expect(page1Response.status).toEqual(200);
  const page1 = (await page1Response.json()) as SearchResponse;

  // matching entries returned up to limit
  expect(page1.entries).toHaveLength(3);

  // returned in reverse order
  expect(page1.entries[0].entry).toEqual(
    "2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10"
  );
  expect(page1.entries[2].entry).toEqual(
    "2025-03-17 14:17:26 status installed man-db:amd64 2.11.2-2"
  );

  // result indicates there is more
  expect(page1.cont).toBeDefined();

  const page2Response = await makeRequest(
    `/fodder/simple.log?cont=${page1.cont}`
  );

  expect(page2Response.status).toEqual(200);
  const page2 = (await page2Response.json()) as SearchResponse;

  // matching entries returned up to limit
  expect(page2.entries).toHaveLength(3);

  // returned in reverse order
  expect(page2.entries[0].entry).toEqual(
    "2025-03-17 14:17:25 status half-configured man-db:amd64 2.11.2-2"
  );
  expect(page2.entries[2].entry).toEqual(
    "2025-03-17 14:17:22 status half-configured gettext:amd64 0.21-12"
  );

  // still more
  expect(page2.cont).toBeDefined();

  const page3Response = await makeRequest(
    `/fodder/simple.log?cont=${page2.cont}`
  );

  expect(page3Response.status).toEqual(200);
  const page3 = (await page3Response.json()) as SearchResponse;

  // matching entries returned up to limit
  expect(page3.entries).toHaveLength(1);

  // returned in reverse order
  expect(page3.entries[0].entry).toEqual(
    "2025-03-17 14:17:21 status unpacked gettext:amd64 0.21-12"
  );

  // pagination complete
  expect(page3.cont).toBeUndefined();
});

Deno.test("error: malformed n", async () => {
  const response = await makeRequest(`/fodder/simple.log?n=xyz`);

  expect(response.status).toEqual(400);
  const body = await response.json();

  expect(body.error).toBeDefined();
  expect(body.error).toContain("n");

  console.log(body);
});

Deno.test("error: n too low", async () => {
  const response = await makeRequest(`/fodder/simple.log?n=0`);

  expect(response.status).toEqual(400);
  const body = await response.json();

  expect(body.error).toBeDefined();
  expect(body.error).toContain("n");

  console.log(body);
});

Deno.test("global max results", async () => {
  const response = await makeRequest(`/fodder/long.log?n=1000`);

  expect(response.status).toEqual(200);
  const { entries } = (await response.json()) as SearchResponse;

  // all entries returned up to limit
  expect(entries).toHaveLength(100);
});

Deno.test("continuation/search conflict", async () => {
  const response = await makeRequest(`/fodder/long.log?s=status&cont=foo`);

  expect(response.status).toEqual(400);
  const body = await response.json();

  expect(body.error).toBeDefined();
  expect(body.error).toContain("continuation");

  console.log(body);
});

Deno.test("continuation/n conflict", async () => {
  const response = await makeRequest(`/fodder/long.log?n=10&cont=foo`);

  expect(response.status).toEqual(400);
  const body = await response.json();

  expect(body.error).toBeDefined();
  expect(body.error).toContain("continuation");

  console.log(body);
});

Deno.test("malformed continuation token", async () => {
  const response = await makeRequest(`/fodder/long.log?cont=foo`);

  expect(response.status).toEqual(400);
  const body = await response.json();

  expect(body.error).toBeDefined();
  expect(body.error).toContain("token");

  console.log(body);
});

Deno.test("not found", async () => {
  const response = await makeRequest(`/fodder/foo.log`);

  expect(response.status).toEqual(404);
  const body = await response.json();

  expect(body.error).toBeDefined();
  expect(body.error).toContain("Not Found");

  console.log(body);
});

Deno.test("directory traversal", async () => {
  const response = await makeRequest(`/../simple.log`);

  expect(response.status).toEqual(404);
  const body = await response.json();

  expect(body.error).toBeDefined();
  expect(body.error).toContain("Not Found");

  console.log(body);
});

async function makeRequest(pathAndQuery: string) {
  const request = new Request(`http://localhost:1065${pathAndQuery}`);
  try {
    return await searchLogHandler(request);
  } catch (e: unknown) {
    return errorToResponse(e);
  }
}
