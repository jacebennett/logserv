# LogServ

LogServ is a lightweight service designed to serve log files from Unix-like systems. It provides a simple HTTP interface to access and view log files remotely.

## Prerequisites

### Required
- **Deno**: LogServ is built using Deno, because it didn't require additional dependencies, and I wanted to play with it. Install Deno for your platform here:  https://docs.deno.com/runtime/getting_started/installation/

### Optional Goodies
- **docker**: we include a docker build in case images are the most convenient distributable
- **vscode w/ devcontainer**: You should be able to open the project in a dev container in vscode or a codespace and be up and running.

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

## Building

### Creating a Static Binary

Build a standalone executable with:

```
deno task build
```

This will create a binary called `logserv` in your project directory.

### Running the Binary

The binary should be run in the directory containing the log files you want to serve:

```
cd /var/log && /path/to/logserv/logserv
```

The server will start on port 1065, serving log files from the working directory.

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

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.