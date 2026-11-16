# DoubtDesk

**Questions that find an answer.** DoubtDesk is a campus study chat where every question has a clear lifecycle: ask, get a fast AI first answer, discuss with classmates, mark solved, and find it later.

## The problem

Useful questions disappear in busy class group chats. The same doubt gets asked again, and students cannot tell which answers were checked or resolved.

## The solution

DoubtDesk turns each question into a threaded, searchable doubt. Subject rooms keep discussions together. An AI helper offers a concise first response, peers add context, and the asker marks the doubt solved so it becomes part of the room's answer bank.

## Architecture

```text
React + TypeScript (Vite)
  ├─ Nexconn Chat SDK ── group rooms, messages, metadata, live events, history
  └─ /api/login ───────── Vercel Function / local API
     /api/rooms/create ── signed Nexconn Server API call
     /api/ask ─────────── Gemini API with a fast-model fallback
```

The Nexconn App Secret and Gemini key are used only by the backend. The browser receives a Nexconn access token to connect and a short-lived signed session token for authorized room creation. Only the display name and room list are kept in `sessionStorage`; the theme preference is stored in `localStorage`.

### Nexconn features used

- Group channels for subject rooms and peer invitations.
- Message metadata for doubt/reply type, reply links, AI authorship, and solved status.
- Real-time message and metadata events to refresh other connected clients.
- Channel message history for the room board and answer bank.
- Group creation through the documented Server API with `joinPerm: 1`, so anyone with the room code can join.

## Run locally

Requirements: Node.js 20+ and a Nexconn app in the Singapore data center.

1. Copy `.env.example` to `.env` and set `VITE_NEXCONN_APP_KEY`.
2. Copy `.env.server.example` to `.env.server`. Set `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET`, and `GEMINI_API_KEY`; keep the real file out of Git.
3. Install and build:

   ```sh
   npm install
   npm run build
   ```

4. Start the API and frontend in separate terminals:

   ```sh
   node --env-file=.env --env-file=.env.server server.mjs
   ```

   ```sh
   npm run dev
   ```

5. Open the Vite URL, sign in with a display name, create a subject room or join a room code, then post a doubt.

Gemini defaults to `gemini-3.5-flash-lite`; set `GEMINI_MODEL` in `.env.server` to use another model. The backend retries transient 429/503 responses and timeouts with `gemini-3.6-flash`. Answers are limited to 110 words and include a reminder to confirm with a senior or teacher. AI failure never prevents the doubt from being posted.

## Rooms and sharing

Room codes use letters and numbers (up to 64 characters). The sidebar includes Physics 101, Chemistry 101, and Calculus 101 presets. Creating a room returns a shareable link containing its code; friends can sign in and join from that link or paste the code.

## Deploy on Vercel

1. Create a **public GitHub repository** and push this project. Do not upload `.env`, `.env.server`, or any real API key. The workspace currently needs Git initialization before it can be pushed.
2. Import the GitHub repository into Vercel. Use the repository root, the default Vite build command `npm run build`, and output directory `dist`.
3. Add these Vercel **Project → Settings → Environment Variables** for Production (and Preview only if you intend to use Preview deployments):

   | Variable | Value | Visibility |
   | --- | --- | --- |
   | `VITE_NEXCONN_APP_KEY` | Nexconn App Key | Public build variable |
   | `NEXCONN_APP_KEY` | Same Nexconn App Key | Server only |
   | `NEXCONN_APP_SECRET` | Nexconn App Secret | Server only; never use a `VITE_` prefix |
   | `GEMINI_API_KEY` | Google AI Studio API key | Server only |
   | `GEMINI_MODEL` | `gemini-3.5-flash-lite` (optional) | Server only |
   | `CORS_ORIGIN` | Exact deployed origin, e.g. `https://your-project.vercel.app` | Server only |

   Leave `VITE_API_BASE_URL` unset/empty; production calls the same-origin `/api/*` functions. For local `node server.mjs`, `.env.server` can include both localhost origins as shown in the example.

4. Redeploy after setting environment variables. Test a new display-name sign-in, room creation, joining from a second browser, an AI answer, and solving/searching a doubt.
5. Use the production URL as the live app link in the challenge submission. Record the demo script below, and publish the video and write-up alongside the public repository.

The API has input bounds and process-local per-IP rate limits (10 logins, 10 room creates, and 20 AI requests per minute). Set `CORS_ORIGIN` to the exact deployed origin; do not use `*`. Serverless rate counters are best-effort per function instance, not a distributed abuse-prevention service.

## Screenshot

Add a current app screenshot here before submitting: `![DoubtDesk room and answer bank](docs/screenshots/doubtdesk.png)`.

## Build challenge write-up outline

- **Problem:** class-chat questions get buried and solved explanations are hard to reuse.
- **Solution:** subject rooms where each doubt has a reply thread, an explicit open/solved lifecycle, and a searchable answer bank.
- **Innovation:** chat is organized around a question lifecycle, with an AI first responder to reduce wait time and peers/seniors to add trusted context.
- **Architecture:** React + TypeScript, Nexconn group channels/realtime/history/metadata, a small server API for signed Nexconn operations, and Gemini for first answers.
- **Growth:** pilot in one college, then expand campus by campus. Keep the student tier free; offer paid administration, analytics, and support plans to colleges and coaching institutes.

## Two-minute demo script

1. **0:00–0:15 — Set the scene:** Open a fresh subject room and explain that doubts should not vanish in a scrolling group chat.
2. **0:15–0:40 — Ask:** Post a concise question. Show it appear in Open and point out that it remains visible while help arrives.
3. **0:40–1:05 — AI first answer:** Show the AI badge and concise response, including its confirmation note.
4. **1:05–1:25 — Peer help:** Reply as a second student/browser and show the threaded answer appear live.
5. **1:25–1:40 — Resolve:** Return as the asker and mark the doubt solved.
6. **1:40–2:00 — Reuse:** Open Solved, search a phrase from the question or replies, and share the room link.

## Before submission

- Capture the screenshot after deploying and replace the screenshot placeholder above.
- Record and publish the two-minute demo video.
- Add the live Vercel URL and public repository URL to the challenge submission.
- No Git metadata is present in the supplied workspace, so commit-history secret scanning cannot be verified here. Before publishing, initialize/push a clean repository and scan its complete history for credentials.
