type KeywordSearch = { text: string };
export type Query = KeywordSearch;

export type SearchOptions = {
  maxResults?: number;
  query?: Query;
  resumeFrom?: number;
};

const MAX_RESULT_ENTRY_LENGTH = 2048;
const CHUNK_SIZE = 64 * 1024;

const Utf8Decoder = new TextDecoder();

/**
 * Searches through a log file from the end to the beginning, finding lines that match the query criteria.
 *
 * @param filename - The path to the log file to search
 * @param options - Search configuration options
 * @param options.maxResults - Maximum number of results to return (defaults to 100)
 * @param options.query - Search query criteria (currently supports text search)
 * @param options.resumeFrom - Byte offset to resume searching from (for pagination)
 * @returns An object containing matched log entries and the earliest byte offset scanned for pagination
 */
export async function searchLog(
  filename: string,
  options: Partial<SearchOptions> = {},
) {
  const opts = {
    maxResults: 100,
    ...options,
  };
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
      entries.push({ entry: line });

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
