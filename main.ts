const CHUNK_SIZE = 400;

if (import.meta.main) {
  main();
}

async function main() {
  const filename = "fodder/simple.log";
  const decoder = new TextDecoder();

  for await (const line of linesReverse(filename)) {
    console.log(decoder.decode(line));
  }
}


/**
 * Opens the specified file and yields lines of text starting at the end of the file and working backwards.
 */
export async function* linesReverse(filename: string) {
  const chunker = chunksReverse(filename);
  let partial: Uint8Array | null = null;

  try {
    for await (const chunk of chunker) {
      let lineEnding = chunk.length;

      while (true) {
        const prevLineEnding = chunk.lastIndexOf(10, lineEnding - 1); // 10 === '\n'

        if (prevLineEnding === -1) {
          // we've reached the beginning of the chunk, so we need to save off the partial line
          if (partial === null) {
            partial = chunk.subarray(0, lineEnding);
          } else {
            partial = concatByteArrays(chunk.subarray(0, lineEnding), partial);
          }

          // move on to the next chunk
          break;
        }

        const lineStart = prevLineEnding + 1;
        
        if (partial !== null) {
          const line = concatByteArrays(chunk.subarray(lineStart, lineEnding), partial);
          partial = null;
          yield line;
        } else {
          yield chunk.subarray(lineStart, lineEnding);
        }

        lineEnding = prevLineEnding;
      }
    }

    if (partial !== null) {
      yield partial;
      partial = null;
    }
  }
  finally {
    chunker.return();
  }
}

function concatByteArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
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

  return buffer;
}
