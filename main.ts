import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";
import * as path from "jsr:@std/path";

const MAX_PATH_LENGTH = 1000;
const MAX_SEARCH_TEXT_LENGTH = 200;
const MAX_CONTINUATION_TOKEN_LENGTH = 200;
const GLOBAL_MAX_RESULTS = 100;
const MAX_RESULT_ENTRY_LENGTH = 2048;
const CHUNK_SIZE = 64 * 1024;

const Utf8Decoder = new TextDecoder();

// TODO: when attaching continuation tokens to the request, go ahead and attach a fully formed url.

let secondaryHosts: string[] = [];
if (import.meta.main) {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    printUsage();
    Deno.exit(0);
  }

  const hostsArgIndex = Deno.args.indexOf("--hosts");
  if (hostsArgIndex >= 0) {
    const hostListIndex = hostsArgIndex + 1;
    if (Deno.args.length >= hostListIndex) {
      console.error("Missing hosts list.");
      printUsage();
      Deno.exit(1);
    }
    const hostsList = Deno.args[hostListIndex];
    secondaryHosts = hostsList.split(";");
    startAggregator();
  } else if (Deno.env.has("HOSTS")) {
    const hostsList = Deno.env.get("HOSTS")!;
    secondaryHosts = hostsList.split(";");
    startAggregator();
  } else {
    startLogServ();
  }
}

function printUsage() {
  const usage = `
LogServ - Log search and aggregation daemon

USAGE:
  logserv [OPTIONS]

MODES:
  Default Mode:
    Serves logs from the local filesystem.

  Aggregator Mode:
    Aggregates log searches across multiple hosts.
    Enabled by providing secondary hosts via --hosts or HOSTS env variable.

OPTIONS:
  -h, --help             Show this help message
  --hosts <host1;host2>  Run in aggregator mode with specified secondary hosts
                         (semicolon-separated list)

ENVIRONMENT VARIABLES:
  HOSTS                  Alternative to --hosts (semicolon-separated list)

EXAMPLES:
  # Run in default mode (serving local logs)
  logserv

  # Run in aggregator mode with multiple hosts
  logserv --hosts "host1.example.com;host2.example.com"

  # Run in aggregator mode using environment variable
  HOSTS="host1.example.com;host2.example.com" logserv
`;

  console.log(usage);
}

function startAggregator() {
  console.log(`Aggregating log searches for: `);
  for (const secondaryHost of secondaryHosts) {
    console.log(`  - ${secondaryHost}`);
  }
  console.log();

  Deno.serve({
    port: 1065,
    onError(error) {
      if (error instanceof Response) {
        return error;
      }
      console.error("Unexpected Error:", error);
      return unexpected();
    },
  }, multihostSearchHandler);
}

function startLogServ() {
  Deno.serve({
    port: 1065,
    onError(error) {
      if (error instanceof Response) {
        return error;
      }
      if (error instanceof Deno.errors.NotFound) {
        return notFound();
      }
      console.error("Unexpected Error:", error);
      return unexpected();
    },
  }, searchLogHandler);
}

// #region Http Handling
export async function searchLogHandler(request: Request) {
  // TODO: simple driver UI
  if (request.method !== "GET") {
    return notFound();
  }
  const url = new URL(request.url);

  let searchOptions: SearchOptions = {};

  const { filename, ...searchParams } = validateSearchParams(url);
  if ("cont" in searchParams) {
    searchOptions = decodeContinuationToken(searchParams.cont);
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
        searchOptions.query,
      ),
    }),
  };

  return jsonResponse(body);
}

export async function multihostSearchHandler(request: Request) {
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

    for (const host of secondaryHosts) {
      const secondaryUrl = new URL(url);
      secondaryUrl.host = host;
      requests.push(querySecondary(secondaryUrl, host, abortController.signal));
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

function validateSearchParams(url: URL) {
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

function validateAndNormalizeSearchOptions(options: SearchOptions) {
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

type SecondaryResult = {
  host: string;
  entries: { host: string; entry: string }[];
  cont?: string;
};

type SecondaryQueryError = {
  host: string;
  error: string;
};

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data, null, 2) + "\n", {
    headers: {
      "Cache-Control": "no-cache",
    },
  });
}

function notFound(msg: string = "Not Found") {
  return new Response(JSON.stringify({ error: msg }) + "\n", {
    status: 404,
    statusText: "Not Found",
  });
}

function badRequest(msg: string = "Bad Request") {
  return new Response(JSON.stringify({ error: msg }) + "\n", {
    status: 400,
    statusText: "Bad Request",
  });
}

function unexpected(msg: string = "Internal Server Error") {
  return new Response(JSON.stringify({ error: msg }) + "\n", {
    status: 500,
    statusText: "Internal Server Error",
  });
}

function encodeContinuationToken(
  resumeFrom: number,
  maxResults?: number,
  query?: Query,
) {
  const json = JSON.stringify([resumeFrom, maxResults, query]);
  const encoded = encodeBase64(json);

  return encoded;
}

function decodeContinuationToken(token: string) {
  try {
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
  } catch (_e) {
    throw new Error("Invalid token.");
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

// #endregion

// #region Log Reading
type KeywordSearch = { text: string };
type Query = KeywordSearch;

type SearchOptions = {
  maxResults?: number;
  query?: Query;
  resumeFrom?: number;
};

const defaultSearchOptions = {
  maxResults: 100,
};

export async function searchLog(filename: string, options: SearchOptions = {}) {
  const opts = { ...defaultSearchOptions, ...options };
  const searchText = opts.query?.text;
  const maxResults = opts.maxResults;
  const startingOffset = opts.resumeFrom;

  let earliestOffset: number | undefined;

  const entries = [];

  for await (const lineChunk of linesReverse(filename, startingOffset)) {
    earliestOffset = lineChunk.offset;
    const line = Utf8Decoder.decode(lineChunk.bytes); // TODO: do we _really_ have to convert this to string here? can we not match in arrays? what about regex? We can probably do it with the buffer api?

    if (!line) {
      continue;
    }

    // NOTE: The prompt talked about extending the matching capabilities. I think regex would slot in here nicely with a `pattern` querystring parameter, a
    // PatternSearch type added to the Query type union, and a little rework to this logic to match the line text based on the selected strategy. It will also
    // serialize nicely into the continuation tokens.I think for more advanced queries and query encodings I would like to understand the needs better. It
    // could go a lot of ways, and I'm not sure this endpoint would be relevant in some of those futures. So, I'm not ready to make an abstraction beyond
    // supporting the immediate requirements, but I would be happy to discuss them.
    //
    // But for now, this is simple code, and so it can be easily enhanced.
    if (!searchText || line.includes(searchText)) {
      // NOTE: A lot of leverage could be had if we could extract some structured data out of a log entry. This would take some time and testing and sample
      // data, but if I had bandwidth, I would try to extract things like the time (at least), and if I could identify the message portion, etc, etc.
      entries.push(line);

      if (entries.length === maxResults) {
        break;
      }
    }
  }

  return {
    entries,
    resumeFrom: earliestOffset,
  };
}

/**
 * Opens the specified file and yields lines of text starting at the end of the file and working backwards.
 */
export async function* linesReverse(filename: string, startingOffset?: number) {
  let partialLine: FileChunk | null = null;

  for await (const chunk of chunksReverse(filename, startingOffset)) {
    let lineEnding = chunk.bytes.length;

    while (true) {
      const prevLineEnding = chunk.bytes.lastIndexOf(10, lineEnding - 1); // 10 === '\n'

      if (prevLineEnding === -1) {
        // we've reached the beginning of the chunk, so we need to save off the partial line since it may be continued in the next chunk.
        if (partialLine === null) {
          partialLine = chunk.subChunk(0, lineEnding);
          break;
        }

        // we reached the beginning of the chunk while there was still a partial, it must span more than a chunk. we need to keep scanning the line to find the beginning, but we don't want to accumulate arbitrary amounts of memory, so each time we will only keep the first portion.

        if (lineEnding > MAX_RESULT_ENTRY_LENGTH) {
          partialLine = chunk.subChunk(0, MAX_RESULT_ENTRY_LENGTH);
          break;
        }

        partialLine.prepend(chunk.subChunk(0, lineEnding));

        if (partialLine.bytes.length > MAX_RESULT_ENTRY_LENGTH) {
          partialLine = partialLine.subChunk(0, MAX_RESULT_ENTRY_LENGTH);
        }

        break;
      }

      const lineStart = prevLineEnding + 1;
      let line = chunk.subChunk(lineStart, lineEnding);

      if (partialLine !== null) {
        line = line.concat(partialLine);
        partialLine = null;
      }

      if (line.bytes.length > MAX_RESULT_ENTRY_LENGTH) {
        line = line.subChunk(0, MAX_RESULT_ENTRY_LENGTH);
      }

      yield line;
      lineEnding = prevLineEnding;
    }
  }

  if (partialLine !== null) {
    yield partialLine;
    partialLine = null;
  }
}

/**
 * Opens the specified file and yields chunks of the specified size starting from the end of the file and working backwards.
 */
export async function* chunksReverse(
  filename: string,
  startingOffset?: number,
) {
  using file = await Deno.open(filename, {
    read: true,
    write: false,
    create: false,
  });
  const { size } = await file.stat();

  if (startingOffset && startingOffset > size) {
    throw new Error("Invalid Offset");
  }

  let end = startingOffset ?? size;
  let start = Math.max(0, end - CHUNK_SIZE);

  while (end > 0) {
    yield await readChunk(file, start, end - start);

    end = start;
    start = Math.max(0, end - CHUNK_SIZE);
  }
}

/**
 * Reads a chunk of bytes from an open file.
 */
async function readChunk(file: Deno.FsFile, start: number, size: number) {
  const buffer = new Uint8Array(size);

  await file.seek(start, Deno.SeekMode.Start);

  let bytesRead = 0;
  while (bytesRead < size) {
    const read = await file.read(buffer.subarray(bytesRead));
    if (read === null) {
      throw new Error("Unexpected End of File");
    }

    bytesRead += read;
  }

  return new FileChunk(start, buffer);
}

/**
 * A FileChunk is some byte array plus an offset into the file where the bytes were sourced.
 */
class FileChunk {
  offset: number;
  bytes: Uint8Array;

  constructor(offset: number, bytes: Uint8Array) {
    this.offset = offset;
    this.bytes = bytes;
  }

  subChunk(start: number, end: number) {
    // TODO: maybe bounds checks
    return new FileChunk(this.offset + start, this.bytes.subarray(start, end));
  }

  concat(successor: FileChunk) {
    // TODO: maybe check adjacency
    return new FileChunk(
      this.offset,
      concatByteArrays(this.bytes, successor.bytes),
    );
  }

  prepend(predecessor: FileChunk) {
    // TODO: maybe check adjacency
    return new FileChunk(
      predecessor.offset,
      concatByteArrays(predecessor.bytes, this.bytes),
    );
  }
}

function concatByteArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

// #endregion
