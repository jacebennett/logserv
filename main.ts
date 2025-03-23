import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";
import * as path from "jsr:@std/path";

const CHUNK_SIZE = 64 * 1024;
const MAX_PATH_LENGTH = 1000;
const MAX_SEARCH_TEXT_LENGTH = 200;
const MAX_CONTINUATION_TOKEN_LENGTH = 200;
const GLOBAL_MAX_RESULTS = 100;
const MAX_RESULT_ENTRY_LENGTH = 2048;
const Utf8Decoder = new TextDecoder();

if (import.meta.main) {
  startLogServ();
}

function startLogServ() {
  Deno.serve({
      port: 1065,
      onError(error) {
        if (error instanceof Deno.errors.NotFound) {
          return notFound();
        }
        console.error("Unexpected Error:", error);
        return unexpected();
      }
    },
    searchLogHandler,
  );
}

// #region Http Handler
export async function searchLogHandler(request: Request) {
  // TODO: aggregator
  if (request.method !== "GET") {
    return notFound();
  }

  const url = new URL(request.url);
  const filename = url.pathname;

  if (!filename) {
    return notFound();
  }

  if (filename.length > MAX_PATH_LENGTH) {
    return badRequest("Path too long.")
  }

  const params = url.searchParams;

  const numResults = params.get("n");
  const searchString = params.get("s");
  const continuationToken = params.get("cont");

  let searchOptions: SearchOptions = {};

  if (continuationToken) {
    if (continuationToken.length > MAX_CONTINUATION_TOKEN_LENGTH) {
      return badRequest("Continuation token too long.")
    }
    if (searchString || numResults) {
      return badRequest("Cannot specify a search in a continuation request.");
    }
    try {
      searchOptions = decodeContinuationToken(continuationToken);
    } catch (_e) {
      return badRequest("Invalid continuation token.")
    }
  }

  if (searchString) {
    if (searchString.length > MAX_SEARCH_TEXT_LENGTH) {
      return badRequest("Search text too long.")
    }
    searchOptions.query = { text: searchString };
  }

  if (numResults) {
    const suppliedMaxResults = parseInt(numResults, 10);
    if (isNaN(suppliedMaxResults) || suppliedMaxResults < 1) {
      return badRequest("'n' must be a positive integer.");
    }
    searchOptions.maxResults = Math.min(suppliedMaxResults, GLOBAL_MAX_RESULTS);
  }

  if (!searchOptions.maxResults) {
    searchOptions.maxResults = GLOBAL_MAX_RESULTS;
  }

  const resolvedFilename = path.join(Deno.cwd(), filename);
  if (!resolvedFilename.startsWith(Deno.cwd())) {
    console.error(`Directory traversal attempted: ${url}`);
    return notFound();
  }

  const searchResults = await searchLog(resolvedFilename, searchOptions);

  let nextContinuationToken: string | undefined;
  if (searchResults.resumeFrom) {
    nextContinuationToken = encodeContinuationToken(
      searchResults.resumeFrom,
      searchOptions.maxResults,
      searchOptions.query,
    );
  }

  const body = {
    entries: searchResults.entries,
    cont: nextContinuationToken,
  };

  return new Response(JSON.stringify(body, null, 2) + "\n", {
    headers: {
      "Cache-Control": "no-cache",
    }
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
    const [resumeFrom, maxResults, query] = JSON.parse(json);

    const result: SearchOptions = {
      resumeFrom,
      maxResults,
      query,
    };

    return result;
  } catch (_e) {
    throw new Error
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
    const line = Utf8Decoder.decode(lineChunk.bytes); // TODO: do we _really_ have to convert this to string here? can we not match in arrays? what about regex?

    if (!line) {
      continue;
    }

    if (!searchText || line.includes(searchText)) {
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
