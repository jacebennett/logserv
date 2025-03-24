# LogServ

LogServ is a lightweight service designed to serve log files from Unix-like
systems. It provides a simple rest interface to search the most recent log
entries.

## Prerequisites

### Required

- **Deno**: LogServ is built using Deno, because it didn't require additional
  dependencies, and I wanted to play with it. Install Deno for your platform
  here: https://docs.deno.com/runtime/getting_started/installation/

### Optional Goodies

- **docker**: I include a docker build in case images are the most convenient
  distributable
- **devcontainer**: You should be able to open the project in a dev container in
  vscode or a codespace and be up and running.

## Development

### Running in Dev Mode

To run LogServ in development mode:

```
deno task start
```

This will start the server in watch mode on port 1065.

### Testing with curl

Once the server is running, you can test it using curl:

```
# View most recent entries in a log file
curl http://localhost:1065/simple.log

# Limit the number of results returned
curl http://localhost:1065/simple.log?n=10

# Search for a keyword
curl http://localhost:1065/simple.log?s=installed

# Continue to next page
curl http://localhost:1065/simple.log?cont=continuation_token_from_previous_response
```

## Operation Modes

LogServ can operate in two distinct modes:

### Standard Mode (Default)

When run without special parameters, LogServ operates in standard mode, serving
log files directly from the local filesystem under the working directory.

### Aggregator Mode

LogServ can also function as an aggregator that collects and combines log data
from multiple remote LogServ instances.

To enable aggregator mode, specify secondary hosts using one of these methods:

```bash
# Using command-line argument
logserv --hosts "server1.example.com;server2.example.com"

# Using environment variable
HOSTS="server1.example.com;server2.example.com" logserv
```

In aggregator mode, LogServ will:

- Forward incoming requests to all configured secondary hosts
- Combine results from all hosts into a unified response
- Handle pagination across the distributed log data

## API Documentation

LogServ provides a simple REST API for querying log files.

### Endpoints

All endpoints are relative to the base URL.

```
GET /<logfile>
```

Where `<logfile>` is the name of the log file to query (e.g., `system.log`,
`apache2/access.log`).

### Query Parameters

| Parameter | Description                                                     | Example                        |
| --------- | --------------------------------------------------------------- | ------------------------------ |
| `n`       | _(optional)_ Maximum number of entries to return (default: 100) | `?n=20`                        |
| `s`       | _(optional)_ Search text to filter log entries                  | `?s=error`                     |
| `cont`    | Continuation token for pagination                               | `?cont=eyJyZXN1bWVGcm9tIjo...` |

Notes:

- When using `cont`, do not include other parameters
- Maximum allowed value for `n` is 100
- In aggregator mode, results from all hosts are combined

### Response Format

```json
{
  "entries": [
    "2023-07-15T14:23:45 INFO Application started",
    "2023-07-15T14:23:44 INFO Loading configuration"
  ],
  "cont": "eyJyZXN1bWVGcm9tIjo..."
}
```

In aggregator mode, the response includes host information:

```json
{
  "messages": [
    { "host": "server2.example.com", "message": "Connection timed out" }
  ],
  "entries": [
    {
      "host": "server1.example.com",
      "entry": "2023-07-15T14:23:45 INFO Application started"
    },
    {
      "host": "server1.example.com",
      "entry": "2023-07-15T14:23:44 INFO Loading configuration"
    }
  ],
  "cont": "eyJyZXN1bWVGcm9tIjo..."
}
```

## Building

### Creating a Static Binary

Build a standalone executable with:

```
deno task build
```

This will create a binary called `logserv` in your project directory.

### Running the Binary

The binary should be run in the directory containing the log files you want to
serve:

```
cd /var/log && /path/to/logserv/logserv
```

The server will start on port 1065, serving log files from the working
directory.

## Docker

### Building the Docker Image

Build the Docker image with:

```
docker build -t logserv:latest .
```

### Running the Container

Run the container with:

```
docker run -p 1065:1065 -v /var/log:/logs logserv:latest
```

This will:

- Map port 1065 from the container to port 1065 on your host
- Mount your local log directory to the `/logs` directory in the container

You can then access your logs at `http://localhost:1065/`.

## License

Copyright (c) 2025 Jace Bennett

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
