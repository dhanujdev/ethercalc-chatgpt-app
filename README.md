# EtherCalc Spreadsheet Assistant for ChatGPT

A working starter app that embeds an EtherCalc spreadsheet in a ChatGPT app widget and exposes MCP tools for creating, opening, previewing, editing, appending, clearing, sorting, and summarizing sheets.

## What is included

- `src/server.js` — MCP server for ChatGPT Apps
- `public/widget.html` — iframe widget shown inside ChatGPT
- `src/tool-logic.js` — EtherCalc tool handlers
- `src/ethercalc-client.js` — minimal EtherCalc REST client
- `src/csv-utils.js` — CSV and A1-range helpers
- `test/` — unit + smoke tests

## Features

- Open an EtherCalc sheet inside a ChatGPT widget
- Create a new sheet with starter data
- Read a sheet preview for the model and UI
- Write rectangular values by A1 address
- Append rows
- Clear ranges
- Sort by column
- Summarize a sheet for the model
- Widget buttons for open, sample creation, and refresh

## Requirements

- Node.js 20+
- An EtherCalc instance reachable over HTTP or HTTPS
- ChatGPT developer mode for local connector testing

## Install

```bash
npm install
```

## Environment variables

```bash
export PORT=8787
export MCP_PATH=/mcp
export ETHERCALC_BASE_URL=http://localhost:8000
export APP_BASE_URL=http://localhost:8787
```

For ChatGPT testing, `APP_BASE_URL` and the MCP endpoint must be exposed over HTTPS, usually with `ngrok` or a deployment host.

## Run

```bash
npm start
```

Health check:

```bash
curl http://localhost:8787/
```

Widget preview in a browser:

```bash
open http://localhost:8787/widget-preview
```

## Run tests

```bash
npm test
```

## Use with ChatGPT Apps SDK

OpenAI’s Apps SDK docs state that ChatGPT apps use an MCP server, and the optional UI runs inside an iframe in ChatGPT. The docs also show using `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, and a `/mcp` endpoint for local testing. citeturn5view0turn1view1

### 1. Start EtherCalc

Local Docker example:

```bash
docker run --rm -p 8000:8000 audreyt/ethercalc
```

### 2. Start this app

```bash
npm install
npm start
```

### 3. Expose the MCP endpoint

```bash
ngrok http 8787
```

Use the public HTTPS URL plus `/mcp`, for example:

```text
https://your-subdomain.ngrok.app/mcp
```

OpenAI’s quickstart says ChatGPT developer mode expects a publicly reachable HTTPS MCP endpoint, and suggests tunneling localhost with ngrok during development. citeturn5view0turn5view1

### 4. Add the app in ChatGPT

1. Enable developer mode in ChatGPT settings.
2. Add a new connector/app using the HTTPS MCP URL.
3. Start a new chat and attach the app.
4. Try prompts such as:
   - `Create a sheet called q2-plan with columns Task, Owner, Status`
   - `Open the q2-plan sheet`
   - `Add two rows starting at A4`
   - `Sort q2-plan by column A`

OpenAI’s quickstart describes adding the connector in developer mode and using the HTTPS URL with `/mcp`. citeturn5view0

## EtherCalc notes

EtherCalc’s API documentation shows CSV create and overwrite endpoints, command posting, JSON cell endpoints, and CSV export routes. This app keeps the integration simple by reading and writing CSV snapshots to `/{id}.csv` and `/_/{id}`. citeturn2view1turn2view3turn2view4

## Known limitations

- This version rewrites CSV snapshots for edits instead of issuing fine-grained SocialCalc commands.
- It does not implement auth or user-specific sheet permissions.
- It does not yet support formulas, formatting commands, or undo history.
- Approval for public directory listing may need extra review because the widget embeds a subframe, and OpenAI notes that widgets using iframe subframes are reviewed more carefully. citeturn4view1

## Suggested next steps

- Add `apply_formula` and `find_replace` tools
- Add auth in front of your EtherCalc instance
- Use EtherCalc command posting for more precise operations
- Add persistent session state and recent-sheet history
