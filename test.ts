import { expect } from "jsr:@std/expect";
import { searchLog } from "./main.ts";


Deno.test("simple read", async () => {
    const result = await searchLog("fodder/simple.log");

    // all entries returned
    expect(result.entries).toHaveLength(10);

    // returned in reverse order
    expect(result.entries[0]).toEqual("2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10");
    expect(result.entries[9]).toEqual("2025-03-17 14:17:20 configure gettext:amd64 0.21-12 <none>");

    console.log(JSON.stringify(result, null, 2));
});

Deno.test("simple filtering", async () => {
    const result = await searchLog("fodder/simple.log", {
        query: { text: "status" }
    });

    // all matching enties returned
    expect(result.entries).toHaveLength(7);

    // returned in reverse order
    expect(result.entries[0]).toEqual("2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10");
    expect(result.entries[6]).toEqual("2025-03-17 14:17:21 status unpacked gettext:amd64 0.21-12");

    console.log(JSON.stringify(result, null, 2));
});


Deno.test("simple limiting", async () => {
    const result = await searchLog("fodder/simple.log", {
        maxResults: 3,
    });

    // all entries returned up to limit
    expect(result.entries).toHaveLength(3);

    // returned in reverse order
    expect(result.entries[0]).toEqual("2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10");
    expect(result.entries[2]).toEqual("2025-03-17 14:17:27 trigproc libc-bin:amd64 2.36-9+deb12u10 <none>");
});

Deno.test("filter and limit", async () => {
    const result = await searchLog("fodder/simple.log", {
        query: { text: "status" },
        maxResults: 3,
    });

    // all entries returned up to limit
    expect(result.entries).toHaveLength(3);

    // returned in reverse order
    expect(result.entries[0]).toEqual("2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10");
    expect(result.entries[2]).toEqual("2025-03-17 14:17:26 status installed man-db:amd64 2.11.2-2");
});

Deno.test("continuing search", async () => {
    const result = await searchLog("fodder/simple.log", {
        query: { text: "status" },
        maxResults: 3,
    });

    // matching entries returned up to limit
    expect(result.entries).toHaveLength(3);

    // returned in reverse order
    expect(result.entries[0]).toEqual("2025-03-17 14:17:29 status installed libc-bin:amd64 2.36-9+deb12u10");
    expect(result.entries[2]).toEqual("2025-03-17 14:17:26 status installed man-db:amd64 2.11.2-2");

    // result indicates there is more
    expect(result.resumeFrom).toBeGreaterThan(0);

    const page2 = await searchLog("fodder/simple.log", {
        query: { text: "status" },
        maxResults: 3,
        resumeFrom: result.resumeFrom,
    });

    // matching entries returned up to limit
    expect(page2.entries).toHaveLength(3);
    
    // returned in reverse order
    expect(page2.entries[0]).toEqual("2025-03-17 14:17:25 status half-configured man-db:amd64 2.11.2-2");
    expect(page2.entries[2]).toEqual("2025-03-17 14:17:22 status half-configured gettext:amd64 0.21-12");
});
