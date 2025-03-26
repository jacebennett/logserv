import type { SearchOptions } from "./scanner.ts";

export type ErrorBody = {
  error: string;
};

export const MAX_PATH_LENGTH = 1000;
export const MAX_SEARCH_TEXT_LENGTH = 200;
export const MAX_CONTINUATION_TOKEN_LENGTH = 200;
export const GLOBAL_MAX_RESULTS = 100;

export const Utf8Decoder = new TextDecoder();

export function validateSearchParams(url: URL) {
  const filename = url.pathname;

  if (filename.length > MAX_PATH_LENGTH) {
    throw badRequest("Path too long.");
  }

  const params = url.searchParams;
  const numResults = params.get("n");
  const searchString = params.get("s");
  const continuationToken = params.get("cont");

  if (continuationToken) {
    if (continuationToken.length > MAX_CONTINUATION_TOKEN_LENGTH) {
      throw badRequest("Continuation token too long.");
    }
    if (searchString || numResults) {
      throw badRequest("Cannot specify a search in a continuation request.");
    }
    return { filename, cont: continuationToken };
  }

  if (searchString) {
    if (searchString.length > MAX_SEARCH_TEXT_LENGTH) {
      throw badRequest("Search text too long.");
    }
  }

  if (numResults) {
    const suppliedMaxResults = parseInt(numResults, 10);
    if (isNaN(suppliedMaxResults) || suppliedMaxResults < 1) {
      throw badRequest("'n' must be a positive integer.");
    }
  }

  const parms = {
    filename,
    ...(searchString && { s: searchString }),
    ...(numResults && { n: parseInt(numResults, 10) }),
  };

  if (parms.n) {
    const { n } = parms;
    if (isNaN(n) || n < 1) {
      throw badRequest("'n' must be a positive integer.");
    }
  }

  return parms;
}

export function validateAndNormalizeSearchOptions(options: SearchOptions) {
  if (options.query) {
    if (options.query.text.length > MAX_SEARCH_TEXT_LENGTH) {
      throw badRequest("Search text too long.");
    }
  }

  if (options.maxResults) {
    options.maxResults = Math.min(options.maxResults, GLOBAL_MAX_RESULTS);
  }

  options.maxResults ??= GLOBAL_MAX_RESULTS;
}

export function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data, null, 2) + "\n", {
    headers: {
      "Cache-Control": "no-cache",
    },
  });
}

export function notFound(msg: string = "Not Found") {
  const body: ErrorBody = { error: msg };
  return new Response(JSON.stringify(body) + "\n", {
    status: 404,
    statusText: "Not Found",
  });
}

export function badRequest(msg: string = "Bad Request") {
  const body: ErrorBody = { error: msg };
  return new Response(JSON.stringify(body) + "\n", {
    status: 400,
    statusText: "Bad Request",
  });
}

export function unexpected(msg: string = "Internal Server Error") {
  const body: ErrorBody = { error: msg };
  return new Response(JSON.stringify(body) + "\n", {
    status: 500,
    statusText: "Internal Server Error",
  });
}

export function errorToResponse(err: unknown) {
  if (err instanceof Response) {
    return err;
  }
  if (err instanceof Deno.errors.NotFound) {
    return notFound();
  }
  console.error("Unexpected Error:", err);
  return unexpected();
}
