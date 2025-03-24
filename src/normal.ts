import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";
import * as path from "jsr:@std/path";

import { type Query, searchLog, type SearchOptions } from "./scanner.ts";
import {
  badRequest,
  jsonResponse,
  notFound,
  Utf8Decoder,
  validateAndNormalizeSearchOptions,
  validateSearchParams,
} from "./util.ts";

export async function searchLogHandler(request: Request) {
  if (request.method !== "GET") {
    return notFound();
  }
  const url = new URL(request.url);

  let searchOptions: SearchOptions = {};

  const { filename, ...searchParams } = validateSearchParams(url);
  if ("cont" in searchParams) {
    try {
      searchOptions = decodeContinuationToken(searchParams.cont);
    } catch {
      throw badRequest("Invalid token.");
    }
  } else {
    if (searchParams.n) {
      searchOptions.maxResults = searchParams.n;
    }
    if (searchParams.s) {
      searchOptions.query = { text: searchParams.s };
    }
  }

  validateAndNormalizeSearchOptions(searchOptions);

  const resolvedFilename = path.join(Deno.cwd(), filename);
  if (!resolvedFilename.startsWith(Deno.cwd())) {
    console.error(`Directory traversal attempted: ${url}`);
    return notFound();
  }

  const searchResults = await searchLog(resolvedFilename, searchOptions);

  const body = {
    entries: searchResults.entries,
    ...(searchResults.resumeFrom && {
      cont: encodeContinuationToken(
        searchResults.resumeFrom,
        searchOptions.maxResults,
        searchOptions.query
      ),
    }),
  };

  return jsonResponse(body);
}

function encodeContinuationToken(
  resumeFrom: number,
  maxResults?: number,
  query?: Query
) {
  const json = JSON.stringify([resumeFrom, maxResults, query]);
  const encoded = encodeBase64(json);

  return encoded;
}

function decodeContinuationToken(token: string) {
  const jsonBytes = decodeBase64(token);
  const json = Utf8Decoder.decode(jsonBytes);
  const arr = JSON.parse(json);

  if (!Array.isArray(arr)) {
    throw "must be array";
  }

  if (arr.length != 3) {
    throw "must be triple";
  }

  const [resumeFrom, maxResults, query] = arr;

  if (!Number.isInteger(resumeFrom)) {
    throw "bad pointer";
  }

  if (!Number.isInteger(maxResults)) {
    throw "bad limit";
  }

  if (query && typeof query !== "object") {
    throw "bad search";
  }

  const result: SearchOptions = {
    resumeFrom,
    maxResults,
    query,
  };

  return result;
}
