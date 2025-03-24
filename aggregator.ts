import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";

import type { SearchOptions } from "./scanner.ts";
import {
  jsonResponse,
  notFound,
  Utf8Decoder,
  validateAndNormalizeSearchOptions,
  validateSearchParams,
} from "./util.ts";

type SecondaryResult = {
  host: string;
  entries: { host: string; entry: string }[];
  cont?: string;
};

type SecondaryQueryError = {
  host: string;
  error: string;
};

export class Aggregator {
  hosts: string[];

  constructor(hosts: string[]) {
    this.hosts = hosts;
  }

  async handler(request: Request) {
    // TODO: simple driver UI
    if (request.method !== "GET") {
      return notFound();
    }
    const url = new URL(request.url);
    const searchParams = validateSearchParams(url);

    const abortController = new AbortController();
    setTimeout(() => abortController.abort("deadline exceeded"), 5000);

    const requests = [];

    if ("cont" in searchParams) {
      const secondaryContinuationTokens = demuxContinuationTokens(
        searchParams.cont,
      );

      for (const token of secondaryContinuationTokens) {
        const secondaryUrl = new URL(url);
        secondaryUrl.host = token.host;
        secondaryUrl.searchParams.set("cont", token.cont);
        requests.push(
          querySecondary(secondaryUrl, token.host, abortController.signal),
        );
      }
    } else {
      const searchOptions: SearchOptions = {};
      if (searchParams.n) {
        searchOptions.maxResults = searchParams.n;
      }
      if (searchParams.s) {
        searchOptions.query = { text: searchParams.s };
      }
      validateAndNormalizeSearchOptions(searchOptions);

      for (const host of this.hosts) {
        const secondaryUrl = new URL(url);
        secondaryUrl.host = host;
        requests.push(
          querySecondary(secondaryUrl, host, abortController.signal),
        );
      }
    }

    const results = await Promise.all(requests);

    const secondaryContinuations: { host: string; cont: string }[] = [];
    let entries: { host: string; entry: string }[] = [];
    const messages: { host: string; message: string }[] = [];

    for (const result of results) {
      if ("error" in result) {
        messages.push({ host: result.host, message: result.error });
        continue;
      }

      entries = entries.concat(result.entries);

      if (result.cont) {
        secondaryContinuations.push({ host: result.host, cont: result.cont });
      }
    }

    const body = {
      messages,
      entries,
      ...(secondaryContinuations.length && {
        cont: muxContinuationTokens(secondaryContinuations),
      }),
    };

    return jsonResponse(body);
  }
}

type SecondaryToken = { host: string; cont: string };

function muxContinuationTokens(secondaryTokens: SecondaryToken[]) {
  const json = JSON.stringify(secondaryTokens);
  const encoded = encodeBase64(json);

  return encoded;
}

function demuxContinuationTokens(token: string) {
  try {
    const jsonBytes = decodeBase64(token);
    const json = Utf8Decoder.decode(jsonBytes);
    const secondaryTokens = JSON.parse(json);

    if (!Array.isArray(secondaryTokens)) {
      throw "must be array";
    }

    for (const secondaryToken of secondaryTokens) {
      if (!secondaryToken) {
        throw "can't be null";
      }
      if (typeof secondaryToken != "object") {
        throw "must be object";
      }

      if (typeof secondaryToken.host != "string") {
        throw "must have host";
      }

      if (typeof secondaryToken.cont != "string") {
        throw "must have cont";
      }
    }

    return secondaryTokens as SecondaryToken[];
  } catch (_e) {
    throw new Error("Invalid Token.");
  }
}

async function querySecondary(url: URL, host: string, signal: AbortSignal) {
  try {
    const response = await fetch(url, { signal });
    // TODO: test this. handle errors(?) do 400s throw?
    const body: { entries: string[]; cont?: string } = await response.json();

    const result: SecondaryResult = {
      host,
      entries: body.entries.map((entry) => ({ host, entry })),
      cont: body.cont,
    };

    return result;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`secondary request timed out: ${url}`);
      const error: SecondaryQueryError = {
        host,
        error: err.message,
      };
      return error;
    }

    console.error("secondary request resulted in unhandled error", err);
    const error: SecondaryQueryError = {
      host,
      error: "Unknown error occured.",
    };
    return error;
  }
}
