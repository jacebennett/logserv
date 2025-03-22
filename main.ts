const CHUNK_SIZE = 400;
const Utf8Decoder = new TextDecoder();

if (import.meta.main) {
  main();
}

// TODO: pagination requires that we surface the offset of the log entries so we can capture where to resume the search in a continuation token. That also implies that our search functions should allow us to supply an offset from which to start searching.

async function main() {
  const filename = "fodder/simple.log";

  const results = await searchLog(filename, {
    maxResults: 6,
    query: { text: "status" },
  })
  
  console.log(JSON.stringify({ results }, null, 2));
}

type Query = { text: string };

type SearchOptions = {
  maxResults: number,
  query?: Query,
};

// TODO: make all options optional, come up with a default options object, and merge it with provided options in the function.

export async function searchLog(filename: string, options: SearchOptions = { maxResults: 100 }) {
  const results = [];

  const searchText = options.query?.text;
  const maxResults = options.maxResults;

  for await (const lineChunk of linesReverse(filename)) {
    const line = Utf8Decoder.decode(lineChunk.bytes); // TODO: handle malformed data
    if (!searchText || line.includes(searchText)) {
      results.push(line);

      if (results.length === maxResults) {
        break;
      }
    }
  }

  return results;
}

/**
 * Opens the specified file and yields lines of text starting at the end of the file and working backwards.
 */
export async function* linesReverse(filename: string) {
  let partialLine: FileChunk | null = null;

  for await (const chunk of chunksReverse(filename)) {
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
export async function* chunksReverse(filename: string, chunkSize: number = CHUNK_SIZE) {
  using file = await Deno.open(filename, { read: true, write: false, create: false });
  const { size } = await file.stat();

  let end = size;
  let start = Math.max(0, end - chunkSize);

  while (end > 0) {
    yield await readChunk(file, start, end - start);

    end = start;
    start = Math.max(0, end - chunkSize);
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
      throw new Error('Unexpected End of file');
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

