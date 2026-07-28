# Task Tree Viewer

A lightweight Vue 3 application built to recursively visualize and filter machine-to-machine task data from the Sismedika Task Manager API (`https://taskmanager.minipc.sismedika.biz.id/`).

## Features

- **Recursive Tree Visualization**: Renders tasks and their children in a nested tree view using `parentTaskID`.
- **Status Filtering**: Multi-select toggle filters for all lifecycle states (`REPORTED`, `IN_DEV`, `DEV_DONE`, `QA_IN_PROGRESS`, `QA_DONE`, `QC_IN_PROGRESS`, `QC_DONE`).
- **Product Filtering**: Dynamically extracts unique `productCode` values from the loaded payload for scoped filtering.
- **Persistent Preferences**: Filters are saved to `localStorage` and automatically restored across page reloads.
- **Deep Linking**: Task IDs directly link to the corresponding issue in the Task Manager platform.
- **Assignments**: Displays an indicator when a task is assigned or taken (`assigneeUserID`, `preAssignedUserID`, or `takenByUserID`).
- **Pagination Support**: Automatically loops and fetches all task pages up to the system's hard cap (`pageSize=100`) until `total` is reached.
- **CORS Bypass Proxy**: Includes a lightweight Express proxy to handle API requests locally and bypass browser CORS restrictions.

## Tech Stack

- Vue 3 (Composition API, `<script setup>`)
- Vite
- Express (for local CORS proxying)
- `http-proxy-middleware`

## Setup & Running Locally

The app uses `npm-run-all` to spin up both the Vite dev server and the Express proxy simultaneously.

1. **Install dependencies**:
   ```bash
   bun install
   ```

2. **Start the environment**:
   ```bash
   bun run dev
   ```

3. **Access the application**:
   - The UI will be available at: http://localhost:5176/
   - The proxy will run silently on: http://localhost:3001/

## Architecture Notes

### CORS Strategy
The Sismedika API does not allow cross-origin requests directly from web browsers running on `localhost`. To bypass this, the Vue application makes its network calls to the local proxy (`http://localhost:3001/api/...`), which then transparently streams the requests to the live `taskmanager.minipc.sismedika.biz.id` server, appending the necessary `Access-Control-Allow-Origin: *` headers upon return.

### State & Authentication
Authentication relies on the REST-client JWT flow against `/api/v1/auth/login`. Once received, the token is held in `localStorage` under the key `task_token` to persist active sessions.

### Data Model Handling
The dataset is loaded linearly and transformed locally via a computed property. The application maps every loaded task by its `id` / `taskID` and subsequently routes any task possessing a `parentTaskID` into the `children` array of its designated root task. Rendering evaluates depth infinitely via a single reactive loop.

## AI Agent / Contribution Guide

If you are an AI assistant opening this repository to make modifications:

1. **Frontend (`src/App.vue`)**
   - The UI is a single-file component (Vue 3 Composition API).
   - The task list array comes from `fetchTasks()`. It automatically paginates up to the `total` reported by the API.
   - The recursive tree hierarchy logic is located in the `taskTree` computed property.
   - Filtering (Product/Status) is applied directly inside `taskTree` before the roots are returned.
   - Authentication tokens (`task_token`) and filter preferences (`task_hidden_statuses`, `task_selected_product`) are saved in `localStorage`.

2. **Proxy (`proxy.js`)**
   - We use `http-proxy-middleware` strictly as a pass-through layer to strip/bypass CORS.
   - The proxy receives requests at `/api/v1/...` and sends them verbatim to `https://taskmanager.minipc.sismedika.biz.id/api/v1/...`.
   - **Do not parse JSON bodies** (e.g., `app.use(express.json())`) before the proxy middleware. The proxy handles the raw stream automatically; parsing it early breaks the proxy's body forwarding.

3. **Scripts (`package.json`)**
   - Use `bun run dev` to start both the Vite frontend (`:5176`) and the proxy (`:3001`) simultaneously via `npm-run-all`.