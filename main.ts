import { searchLogHandler } from "./src/normal.ts";
import { Aggregator } from "./src/aggregator.ts";
import { errorToResponse } from "./src/util.ts";

// TODO: when attaching continuation tokens to the request, go ahead and attach a fully formed url.
// TODO: consider making normal and aggregator responses compatible

if (import.meta.main) {
  main();
}

function main() {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    printUsage();
    Deno.exit(0);
  }

  if (Deno.args.includes("--hosts")) {
    const hostsArgIndex = Deno.args.indexOf("--hosts");
    const hostListIndex = hostsArgIndex + 1;
    if (hostListIndex >= Deno.args.length) {
      console.error("Missing hosts list.");
      printUsage();
      Deno.exit(1);
    }
    const hostsList = Deno.args[hostListIndex];
    startAggregator(hostsList.split(";"));
    return;
  }

  if (Deno.env.has("HOSTS")) {
    const hostsList = Deno.env.get("HOSTS")!;
    startAggregator(hostsList.split(";"));
    return;
  }

  startNormal();
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

function startNormal() {
  Deno.serve(
    {
      port: 1065,
      onError: errorToResponse,
    },
    searchLogHandler
  );
}

function startAggregator(hosts: string[]) {
  console.log(`Aggregating log searches for: `);
  for (const secondaryHost of hosts) {
    console.log(`  - ${secondaryHost}`);
  }
  console.log();

  const aggregator = new Aggregator(hosts);

  Deno.serve(
    {
      port: 1065,
      onError: errorToResponse,
    },
    (req) => aggregator.handler(req) // TODO: why isn't this bound?
  );
}
