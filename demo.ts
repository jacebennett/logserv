const BASE_URL = "http://localhost:1065";
const SEARCH_TERM = "status";
const RESULTS_PER_PAGE = 2;

const decoder = new TextDecoder();

async function main() {
  try {
    // Start Docker Compose environment
    console.log("Starting Docker Compose environment...");
    const dockerUp = new Deno.Command("docker-compose", {
      args: ["-f", "docker-compose.demo.yml", "up", "-d"],
      stdout: "piped",
      stderr: "piped",
    });

    const upResult = await dockerUp.output();
    if (!upResult.success) {
      console.error("Failed to start Docker Compose environment:");
      console.error(decoder.decode(upResult.stderr));
      Deno.exit(1);
    }

    console.log("Docker Compose environment started successfully");

    // Wait for services to initialize
    console.log("Waiting for services to initialize (5 seconds)...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Initial request
    let url = `${BASE_URL}/simple.log?s=${SEARCH_TERM}&n=${RESULTS_PER_PAGE}`;
    let pageCount = 1;
    let hasMore = true;

    // Make requests until no more continuation tokens
    while (hasMore) {
      console.log(`\n--- Page ${pageCount} ---`);
      console.log(`Making request to: ${url}`);

      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        console.log("Response:");
        console.log(JSON.stringify(data, null, 2));

        // Check if we have more results to fetch
        if (data.cont) {
          url = `${BASE_URL}/simple.log?cont=${data.cont}`;
          pageCount++;
        } else {
          hasMore = false;
          console.log("\nAll results retrieved successfully");
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error(`Error making request: ${error.message}`);
        } else {
          console.error(`Error making request: ${error}`);
        }
        break;
      }
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`An error occurred: ${error.message}`);
    } else {
      console.error(`An error occurred: ${error}`);
    }
  } finally {
    // Shut down Docker Compose environment
    console.log("\nShutting down Docker Compose environment...");
    const dockerDown = new Deno.Command("docker-compose", {
      args: ["-f", "docker-compose.demo.yml", "down"],
      stdout: "piped",
      stderr: "piped",
    });

    const downResult = await dockerDown.output();
    if (downResult.success) {
      console.log("Docker Compose environment shut down successfully");
    } else {
      console.error("Failed to shut down Docker Compose environment:");
      console.error(decoder.decode(downResult.stderr));
    }
  }
}

if (import.meta.main) {
  main();
}
