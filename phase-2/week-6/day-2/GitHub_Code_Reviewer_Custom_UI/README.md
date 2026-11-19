# AI CodeReviewer

## Run locally

Requires Node.js 18 or newer. From this directory, start the local static server and same-origin n8n proxy:

```sh
node server.js
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The proxy forwards only `{ "fileUrl": "..." }` to the local n8n webhook, avoiding browser CORS configuration for this development setup.

The default endpoint is the active workflow at `http://localhost:5678/webhook/code_reviewer`. To use the n8n test listener, start the app with:

```sh
N8N_WEBHOOK_MODE=test node server.js
```

The test endpoint is used only in that explicit mode; keep the n8n test listener waiting for an event. Set `N8N_BASE_URL` to another local n8n address if needed (for example, `http://127.0.0.1:5678`). The proxy intentionally accepts only localhost n8n URLs.

## URL and backend safety

The UI accepts public `github.com/.../blob/branch/path` links and `raw.githubusercontent.com` file links, and converts blob links before submission. The proxy also restricts submitted file URLs to raw GitHub file URLs. Frontend and local proxy validation are not a substitute for backend validation: before exposing the workflow publicly, n8n must independently validate and restrict outbound URLs to prevent server-side request forgery and access to private or internal network resources.

The frontend contains no credentials. Configure any backend secrets in n8n, not in browser code.

## Review results

Successful `review` responses are displayed as formatted Markdown, including headings, emphasis, lists, fenced code, inline code, and tables. Markdown is built with DOM text nodes, so raw HTML in a workflow response is displayed as text instead of being executed. The Code Quality Score is shown only when the review contains a recognizable Overall Score; otherwise it is labeled "Not provided."
