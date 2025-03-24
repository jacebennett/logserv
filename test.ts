import { expect } from "jsr:@std/expect";
import { searchLogHandler } from "./normal.ts";

const baseUrl = "http://localhost:1065";

type ResponseBody = {
  entries: string[];
  cont?: string;
};

Deno.test("simple read", async () => {
  const request = new Request(`${baseUrl}/fodder/simple.log`);
  const response = await searchLogHandler(request);

  expect(response.status).toEqual(200);
  const { entries } = (await response.json()) as ResponseBody;

  // all entries returned
  expect(entries).toHaveLength(10);

  // returned in reverse order
  expect(entries[0]).toEqual(
    "2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10"
  );
  expect(entries[9]).toEqual(
    "2025-03-17 14:17:20 configure gettext:amd64 0.21-12 <none>"
  );
});

Deno.test("filtering", async () => {
  const request = new Request(`${baseUrl}/fodder/simple.log?s=status`);
  const response = await searchLogHandler(request);

  expect(response.status).toEqual(200);
  const { entries } = (await response.json()) as ResponseBody;

  // all matching enties returned
  expect(entries).toHaveLength(7);

  // returned in reverse order
  expect(entries[0]).toEqual(
    "2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10"
  );
  expect(entries[6]).toEqual(
    "2025-03-17 14:17:21 status unpacked gettext:amd64 0.21-12"
  );
});

Deno.test("limiting", async () => {
  const request = new Request(`${baseUrl}/fodder/simple.log?n=3`);
  const response = await searchLogHandler(request);

  expect(response.status).toEqual(200);
  const { entries } = (await response.json()) as ResponseBody;

  // all entries returned up to limit
  expect(entries).toHaveLength(3);

  // returned in reverse order
  expect(entries[0]).toEqual(
    "2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10"
  );
  expect(entries[2]).toEqual(
    "2025-03-17 14:17:27 trigproc libc-bin:amd64 2.36-9+deb12u10 <none>"
  );
});

Deno.test("filter, limit, and paginate", async () => {
  const page1Request = new Request(`${baseUrl}/fodder/simple.log?s=status&n=3`);
  const page1Response = await searchLogHandler(page1Request);

  expect(page1Response.status).toEqual(200);
  const page1 = (await page1Response.json()) as ResponseBody;

  // matching entries returned up to limit
  expect(page1.entries).toHaveLength(3);

  // returned in reverse order
  expect(page1.entries[0]).toEqual(
    "2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10"
  );
  expect(page1.entries[2]).toEqual(
    "2025-03-17 14:17:26 status installed man-db:amd64 2.11.2-2"
  );

  // result indicates there is more
  expect(page1.cont).toBeDefined();

  const page2Request = new Request(
    `${baseUrl}/fodder/simple.log?cont=${page1.cont}`
  );
  const page2Response = await searchLogHandler(page2Request);

  expect(page2Response.status).toEqual(200);
  const page2 = (await page2Response.json()) as ResponseBody;

  // matching entries returned up to limit
  expect(page2.entries).toHaveLength(3);

  // returned in reverse order
  expect(page2.entries[0]).toEqual(
    "2025-03-17 14:17:25 status half-configured man-db:amd64 2.11.2-2"
  );
  expect(page2.entries[2]).toEqual(
    "2025-03-17 14:17:22 status half-configured gettext:amd64 0.21-12"
  );

  // still more
  expect(page2.cont).toBeDefined();

  const page3Request = new Request(
    `${baseUrl}/fodder/simple.log?cont=${page2.cont}`
  );
  const page3Response = await searchLogHandler(page3Request);

  expect(page3Response.status).toEqual(200);
  const page3 = (await page3Response.json()) as ResponseBody;

  // matching entries returned up to limit
  expect(page3.entries).toHaveLength(1);

  // returned in reverse order
  expect(page3.entries[0]).toEqual(
    "2025-03-17 14:17:21 status unpacked gettext:amd64 0.21-12"
  );

  // pagination complete
  expect(page3.cont).toBeUndefined();
});

Deno.test("error: malformed n", async () => {
  const request = new Request(`${baseUrl}/fodder/simple.log?n=xyz`);
  try {
    await searchLogHandler(request);
  } catch (e: unknown) {
    expect(e).toBeInstanceOf(Response);
    const response = e as Response;

    expect(response.status).toEqual(400);
    const body = await response.json();

    expect(body.error).toBeDefined();
    expect(body.error).toContain("n");
    console.log(body);
    return;
  }

  throw "The request succeeded inappropriately";
});

Deno.test("error: n too low", async () => {
  const request = new Request(`${baseUrl}/fodder/simple.log?n=0`);
  try {
    await searchLogHandler(request);
  } catch (e: unknown) {
    expect(e).toBeInstanceOf(Response);
    const response = e as Response;

    expect(response.status).toEqual(400);
    const body = await response.json();

    expect(body.error).toBeDefined();
    expect(body.error).toContain("n");
    console.log(body);
    return;
  }

  throw "The request succeeded inappropriately";
});

Deno.test("global max results", async () => {
  const request = new Request(`${baseUrl}/fodder/long.log?n=1000`);
  const response = await searchLogHandler(request);

  expect(response.status).toEqual(200);
  const { entries } = (await response.json()) as ResponseBody;

  // all entries returned up to limit
  expect(entries).toHaveLength(100);
});

Deno.test("continuation/search conflict", async () => {
  const request = new Request(`${baseUrl}/fodder/long.log?s=status&cont=foo`);
  try {
    await searchLogHandler(request);
  } catch (e: unknown) {
    expect(e).toBeInstanceOf(Response);
    const response = e as Response;

    expect(response.status).toEqual(400);
    const body = await response.json();

    expect(body.error).toBeDefined();
    expect(body.error).toContain("continuation");
    console.log(body);
    return;
  }

  throw "The request succeeded inappropriately";
});

Deno.test("continuation/n conflict", async () => {
  const request = new Request(`${baseUrl}/fodder/long.log?n=10&cont=foo`);
  try {
    await searchLogHandler(request);
  } catch (e: unknown) {
    expect(e).toBeInstanceOf(Response);
    const response = e as Response;

    expect(response.status).toEqual(400);
    const body = await response.json();

    expect(body.error).toBeDefined();
    expect(body.error).toContain("continuation");
    console.log(body);
    return;
  }

  throw "The request succeeded inappropriately";
});

Deno.test("malformed continuation token", async () => {
  const request = new Request(`${baseUrl}/fodder/long.log?cont=foo`);
  try {
    await searchLogHandler(request);
  } catch (e: unknown) {
    expect(e).toBeInstanceOf(Response);
    const response = e as Response;

    expect(response.status).toEqual(400);
    const body = await response.json();

    expect(body.error).toBeDefined();
    expect(body.error).toContain("token");
    console.log(body);
    return;
  }

  throw "The request succeeded inappropriately";
});

Deno.test("not found", async () => {
  let error: unknown = null;
  const request = new Request(`${baseUrl}/fodder/foo.log`);

  try {
    await searchLogHandler(request);
  } catch (e) {
    error = e;
  }

  expect(error).not.toBeNull();
  expect(error).toBeInstanceOf(Deno.errors.NotFound);
});

Deno.test("directory traversal", async () => {
  let error: unknown = null;
  const request = new Request(`${baseUrl}/../simple.log`);

  try {
    await searchLogHandler(request);
  } catch (e) {
    error = e;
  }

  expect(error).not.toBeNull();
  expect(error).toBeInstanceOf(Deno.errors.NotFound);
});
