import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";
import * as path from "jsr:@std/path";
import { Application } from "jsr:@oak/oak/application";
import { Router } from "jsr:@oak/oak/router";

const CHUNK_SIZE = 400;
const Utf8Decoder = new TextDecoder();

if (import.meta.main) {
  main();
}

function main() {
  const router = new Router();
  router.get("/:path(.*)", async (ctx) => {
    const filename = ctx.params.path;

    if (!filename) {
      // TODO: make error handling consistent, use oak facilities to provide a backstop and consistent error format, throw (maybe typed) everywhere else
      throw new Error("Not found");
    }

    const params = ctx.request.url.searchParams;

    const numResults = params.get("n");
    const searchString = params.get("s");
    const continuationToken = params.get("cont");

    // TODO: further request validation?

    let searchOptions: SearchOptions = {};

    if (continuationToken) {
      if (searchString || numResults) {
        throw new Error("Cannot specify a search in a continuation request.");
      }
      searchOptions = decodeContinuationToken(continuationToken);
    }
    
    if (searchString) {
      // TODO: validate the search string? cap its length?
      searchOptions.query = { text: searchString }
    }

    if (numResults) {
      searchOptions.maxResults = parseInt(numResults, 10);
    }

    // TODO: prevent traversal
    const resolvedFilename = path.join(Deno.cwd(), filename);

    const searchResults = await searchLog(resolvedFilename, searchOptions);

    let nextContinuationToken: string | undefined;
    if (searchResults.resumeFrom) {
      nextContinuationToken = encodeContinuationToken(searchResults.resumeFrom, searchOptions.maxResults, searchOptions.query);
    }

    ctx.response.body = {
      entries: searchResults.entries,
      cont: nextContinuationToken,
    };
  });

  const app = new Application();
  const port = 1065;

  app.use(router.routes());
  app.use(router.allowedMethods());

  console.log(`Logserv running on http://localhost:${port}/`);

  app.listen({ port });
}

function encodeContinuationToken(resumeFrom: number, maxResults?: number, query?: Query) {
  const json = JSON.stringify([resumeFrom, maxResults, query]);
  const encoded = encodeBase64(json);

  return encoded;
}

function decodeContinuationToken(token: string) {
  const jsonBytes = decodeBase64(token);
  const json = Utf8Decoder.decode(jsonBytes);
  const [resumeFrom, maxResults, query] = JSON.parse(json);

  const result: SearchOptions = {
    resumeFrom,
    maxResults,
    query
  };

  return result;
}

type KeywordSearch = { text: string };
type Query = KeywordSearch;

type SearchOptions = {
  maxResults?: number,
  query?: Query,
  resumeFrom?: number,
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
    const line = Utf8Decoder.decode(lineChunk.bytes); // TODO: handle malformed data
    
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
    resumeFrom: earliestOffset
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
          partialLine = subChunk(chunk, 0, lineEnding);
        } else {
          partialLine = concatChunks(subChunk(chunk, 0, lineEnding), partialLine); // TODO: handle very large entries.
        }

        // move on to the next chunk
        break;
      }

      const lineStart = prevLineEnding + 1;
      const line = subChunk(chunk, lineStart, lineEnding);

      if (partialLine !== null) {
        const result = concatChunks(line, partialLine);
        partialLine = null;
        yield result;
      } else {
        yield line;
      }

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
export async function* chunksReverse(filename: string, startingOffset?: number) {
  // TODO: how does this fail?
  using file = await Deno.open(filename, { read: true, write: false, create: false });
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

  return Chunk(start, buffer);
}

type FileChunk = {
  offset: number,
  bytes: Uint8Array,
};

function Chunk(offset: number, bytes: Uint8Array) {
  const result: FileChunk = { offset, bytes };
  return result;
}

function subChunk(chunk: FileChunk, start: number, end: number) {
  // TODO: maybe bounds checks
  return Chunk(chunk.offset + start, chunk.bytes.subarray(start, end));
}

function concatChunks(a: FileChunk, b: FileChunk) {
  // TODO: maybe check adjacency

  const result: FileChunk = {
    offset: a.offset,
    bytes: concatByteArrays(a.bytes, b.bytes),
  };

  return result;
}

function concatByteArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

