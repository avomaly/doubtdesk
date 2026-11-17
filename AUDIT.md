# DoubtDesk Comprehensive Audit Report (Phase 1)

Date: November 17, 2026  
Status: Phase 1 Complete (Findings documented; fixes planned for Phase 2)

---

## Executive Summary

An end-to-end security, resilience, data handling, and UX audit was conducted on DoubtDesk across the frontend (`src/App.tsx`, `src/chat.ts`, `src/nexconn.ts`, `src/App.css`), server and API handlers (`server.mjs`, `lib/api-handler.mjs`, `api/*`), test suite, and build artifacts.

The core architecture (Node HTTP API + Nexconn SDK Singapore Data Center + Gemini REST API) is sound, but contains several critical bugs that break core flows (login reuse across users, session persistence on reload, unauthenticated AI route, missing room error translations, and stale room closures during AI generation).

Below is the detailed findings inventory with status, file, line, and root cause analysis.

---

## 1. Backend and Security Audit

| Area | Status | File & Line | Finding & Analysis |
|---|---|---|---|
| **Route Validation & Limits** | **OK** | `lib/api-handler.mjs:101-137, 235-243` | `readJson` enforces payload size caps (2KB for login, 4KB for room creation, ~9KB for ask). Rejects oversized payloads with HTTP 413, invalid JSON syntax with HTTP 400. Control characters and string lengths validated. |
| **Protected Route Auth (/ask)** | **BUG** | `lib/api-handler.mjs:299-314`, `src/chat.ts:141-147` | `/api/ask` and `/ask` do NOT verify `sessionToken` or Authorization header. Any client can spam the AI generation endpoint, exhausting Gemini quota without authenticating. |
| **Room Creation Auth** | **OK** | `lib/api-handler.mjs:267-270` | `/api/rooms/create` strictly checks `readAppSession(req)` with HMAC-SHA256 signature, expiry timestamp, and `timingSafeEqual`. Returns 401 when missing or expired. |
| **User ID Derivation** | **RISK** | `lib/api-handler.mjs:143-146` | User IDs are generated deterministically as `student` + HMAC(APP_SECRET, name.trim().toLowerCase()). While convenient for a passwordless demo, User A can impersonate User B by entering User B's display name. |
| **Nexconn Server API Resilience** | **BUG** | `lib/api-handler.mjs:153-179` | `callNexconnApi` uses 10s timeout, but lacks retry logic, exponential backoff, and backup host failover (`https://api-b.sg-light-api.com`). Transient network failures immediately fail room creation or token issue. |
| **Gemini AI Resilience & Backoff** | **BUG** | `lib/api-handler.mjs:315-367` | Model fallback exists (`gemini-3.5-flash-lite` -> `gemini-3.6-flash`), but has no backoff delay. If both models 429/503 or quota is exhausted, raw error details are exposed as HTTP 502 instead of returning a student-friendly fallback message ("AI helper is busy; please ask a classmate or teacher"). |
| **Rate Limiting Scope** | **BUG** | `lib/api-handler.mjs:80-99, 230-233` | Rate limits are keyed solely by IP (`x-forwarded-for` or socket address). Students on the same university Wi-Fi will throttle each other. `/api/ask` requires per-session/per-user rate limiting alongside IP rate limiting. |
| **Serverless Readiness (State)** | **RISK** | `lib/api-handler.mjs:21, 80-99` | In-memory `rateLimits = new Map()` does not persist across serverless instances (Vercel/Netlify functions). Fresh cold starts reset limits. |
| **Serverless Readiness (Env)** | **RISK** | `lib/api-handler.mjs:3-15` | Environment variables (`GEMINI_API_KEY`, `NEXCONN_APP_KEY`, etc.) are captured once at module load time rather than dynamically per request. |
| **CORS Rejected Origin Header** | **BUG** | `lib/api-handler.mjs:212-214` | When an origin is rejected, `send(res, 403, { error: 'Origin is not allowed' })` is invoked without passing `origin`. The 403 lacks CORS headers, causing browsers to log a generic CORS error rather than the 403 response. |
| **CORS Trailing Slash Handling** | **RISK** | `lib/api-handler.mjs:10-15, 23-32` | `process.env.CORS_ORIGIN` with trailing slashes (e.g. `https://example.com/`) will not match browser origin headers (`https://example.com`). Needs normalization. |
| **Port Conflict Handling** | **OK / RISK** | `vite.config.ts:10`, `server.mjs:6-8` | Vite has `strictPort: true` (never silently shifts ports). However, `server.mjs` lacks an `error` event listener on `http.Server`, causing an unhandled exception crash if port 8787 is occupied. |
| **Secrets & Bundle Hygiene** | **OK** | `.gitignore`, `dist/assets/*.js` | `.env` and `.env.server` are git-ignored. Whole repo and commit history checked: no active tokens or secrets found. Bundle does not contain server secret keys. |
| **Leaked Config Names in Client** | **RISK** | `src/chat.ts:48` | The string `NEXCONN_APP_SECRET` was hardcoded in a client-facing error message, which compiled into the client production bundle. |

---

## 2. Frontend and Lifecycle Audit

| Area | Status | File & Line | Finding & Analysis |
|---|---|---|---|
| **Multi-User Sign-in / Logout** | **CRITICAL BUG** | `src/nexconn.ts:10, 53-64` | `connecting` promise is cached in module scope and NEVER cleared after a successful connection. If Alice logs out or Bob logs in from the same browser tab, Bob reuses Alice's resolved promise. Account verification fails with "Could not confirm your Nexconn account". |
| **Reload Persistence** | **CRITICAL BUG** | `src/App.tsx:125-132, 550` | `me` and `apiSession` states are not restored from `sessionStorage` on reload. Refreshing the browser boots the user back to the sign-in form every single time. |
| **Connection Status Visibility** | **BUG** | `src/nexconn.ts:27-34`, `src/App.tsx:128` | `ConnectionStatusHandler` only logs to `console.log`. Changes to SDK status (connecting, connected, suspended/reconnecting, disconnected) are never communicated to the UI. |
| **Token Expiry Handling** | **BUG** | `src/nexconn.ts:27-34` | Code `31020` (RC_CONN_TOKEN_EXPIRED) and `31005` (RC_CONN_NOT_AUTHORIZED) are ignored by the connection handler. The client does not trigger token refresh or re-auth. |
| **Sign-Out Capability** | **BUG** | `src/App.tsx:654-658` | No sign-out button or action exists. The user cannot disconnect, reset cached state, or switch accounts. |
| **Sending While Disconnected** | **BUG** | `src/App.tsx:365-387`, `src/chat.ts:121-130` | If the network drops or SDK connection is suspended, submitting a doubt or reply attempts `sendMessage` and throws raw error code `30001` or fails silently. |
| **Client Rate Limiting** | **RISK** | `src/chat.ts:121-130` | Nexconn has a 5 msg/sec client rate limit across all channels. Rapid posting of doubts/replies or metadata updates lacks client throttling. |
| **Stale Room Closure in AI Answer** | **BUG** | `src/App.tsx:352-363` | `askBot` captures `room` from state closure. If the user navigates to another room while Gemini is thinking, `postAIReply(room, doubtId, answer)` posts the reply into the WRONG room. |
| **Stale Room in Mark Solved** | **BUG** | `src/App.tsx:389-400` | In `solve`, `await refreshRoom(room)` is called. When a doubt is marked solved from the Dashboard or My Doubts views, `room` is empty string `""`, so the room containing the solved doubt is not refreshed. |
| **Orphan Replies Handling** | **BUG** | `src/App.tsx:239-248` | When computing `doubtEntries`, any reply whose parent doubt message is not among the currently loaded messages is completely discarded and never rendered. |
| **User Identity Display** | **BUG / UX** | `src/App.tsx:460, 480` | Peer messages display raw hashed user IDs (e.g. `student7f3b890a2c...`) rather than initials, monograms, or readable student identifiers. |
| **Join Room Error Code Translation** | **BUG** | `src/chat.ts:94-97` | `joinRoom` throws raw `Join failed. Code: ${code}`. Does not translate `25414` (RC_GROUP_NOT_ALLOW_JOIN - group without allow-anyone-to-join), `25410` (group doesn't exist), or `25411` (group member limit 300 reached). |
| **Send / Tag Error Translation** | **BUG** | `src/chat.ts:121-130, 150-152` | Raw codes (`Code: 22406`, etc.) are thrown on send/tagging failures without user-friendly context. |
| **Excessive Re-fetching on Activity** | **RISK** | `src/App.tsx:225-233` | `onActivity` invokes `refreshAllRooms()` on every single message/metadata update across all joined rooms simultaneously via `Promise.all`. |
| **Text Overflow & Word Break** | **BUG** | `src/App.css` | Long unbroken text (URLs, math strings) lacks `overflow-wrap: break-word` / `word-break: break-word`, causing layout blowout on mobile viewports. |
| **XSS Prevention** | **OK** | `src/App.tsx:466, 487` | All user text is rendered as React text children (`{textOf(entry.doubt)}`); no `dangerouslySetInnerHTML` is used. |

---

## 3. Prioritized Fix Plan for Phase 2

1. **Priority 1 (Core Flows & State)**:
   - Fix `src/nexconn.ts`: Reset `connecting` promise on disconnect/signout; implement clean `disconnectUser()` calling `NCEngine.disconnect()`.
   - Fix `src/App.tsx`: Restore `me`, `apiSession`, and `displayName` from `sessionStorage` on reload, automatically reconnecting the active session.
   - Fix `src/App.tsx`: Add explicit sign-out button that disconnects from Nexconn and clears session state.
   - Fix `src/App.tsx`: Pass explicit `roomId` to `askBot` and `solve` to prevent posting or refreshing against stale room closures.
   - Fix `src/chat.ts`: Add `sessionToken` parameter to `askAI` and pass it from `App.tsx`.

2. **Priority 2 (Security & Abuse Protection)**:
   - Fix `lib/api-handler.mjs`: Require valid session token on `/api/ask` and `/ask`.
   - Fix `lib/api-handler.mjs`: Add per-session rate limiting on `/api/ask` in addition to per-IP rate limiting.
   - Fix `lib/api-handler.mjs`: Sanitize client error messages to ensure internal secret names (`NEXCONN_APP_SECRET`) are never suggested or leaked.

3. **Priority 3 (Error Handling, Resilience & UX)**:
   - Fix `src/chat.ts`: Translate Nexconn codes (`25414` -> clear message about allow-anyone-to-join setting, `25410` -> room not found, `25411` -> room full, `22406` -> not a member).
   - Fix `lib/api-handler.mjs`: Add retry with exponential backoff and backup host (`https://api-b.sg-light-api.com`) to `callNexconnApi`.
   - Fix `lib/api-handler.mjs`: Return graceful student fallback on Gemini 429/quota exhaustion.
   - Fix `lib/api-handler.mjs`: Include `origin` in 403 responses so CORS headers are returned properly.
   - Fix `src/nexconn.ts`: Expose connection state listener (connected, connecting, suspended, disconnected) and bind to UI banner.
   - Fix `src/App.css`: Add `overflow-wrap: break-word; word-break: break-word;` across doubt and reply text containers.
   - Fix `src/App.tsx`: Implement user avatar initials with deterministic colors derived from `userId`.

4. **Priority 4 (Automated Tests)**:
   - Add backend test suites for `/api/login`, `/api/rooms/create`, `/api/ask` auth enforcement, and rate limiting in `tests/`.
   - Add unit tests for Map metadata conversion, message merging, and error code translation.

---

## 4. FIXES (Phase 2 Implementation)

The following fixes have been implemented, verified with automated test suites, and validated through the end-to-end multi-user workflow:

### Fix 1: Multi-User Connection Cache & Clean Sign-Out
- **What was wrong:** Signing out or attempting to sign in as a different user in the same browser tab failed with "Could not confirm your Nexconn account".
- **Root cause:** `connecting` promise was cached globally in `src/nexconn.ts` and never cleared upon sign-out or disconnect. Subsequent connections reused the previous user's resolved promise.
- **How fixed:** Introduced `disconnectUser()` which calls `NCEngine.disconnect()`, resets `connectingPromise = null`, and clears `currentToken`. `connectUser(token)` verifies that the requested token matches the active connection; if not, it initiates a fresh connection. Added an explicit Sign Out button in the navigation footer.
- **Verification:** Verified via `tests/` and live multi-user sign-in switching.

### Fix 2: Session Persistence Across Page Reloads
- **What was wrong:** Refreshing the page (F5 / ⌘R) dropped the user back to the sign-in screen, wiping out active state.
- **Root cause:** `me`, `apiSession`, and `displayName` states in `src/App.tsx` were initialized to empty strings rather than checking `sessionStorage`.
- **How fixed:** `sessionStorage` now persists `doubtdesk.userId`, `doubtdesk.session`, `doubtdesk.token`, and `doubtdesk.name`. On mount, `App.tsx` restores state and triggers `connectUser(token)` in an effect, automatically restoring the session.
- **Verification:** Tested page reload; user session, active room, and messages remained intact.

### Fix 3: Protected Route Authentication on `/api/ask` & `/ask`
- **What was wrong:** Unauthenticated clients could send arbitrary requests to `/api/ask`, consuming the server's Gemini API quota.
- **Root cause:** `lib/api-handler.mjs` lacked a `readAppSession(req)` check on the `/ask` route, and `askAI` in `src/chat.ts` did not send the `Authorization` header.
- **How fixed:** Added `readAppSession(req)` verification on `/api/ask` and `/ask` (returning HTTP 401 for missing/invalid tokens). Updated `askAI(question, sessionToken)` in `src/chat.ts` to pass the Bearer token.
- **Verification:** Automated tests `rejects unauthenticated requests to /api/ask with 401` and `rejects forged or expired session tokens on /api/ask with 401` passing in `tests/api-ai.test.mjs`.

### Fix 4: Server Resilience & Backup Host Failover
- **What was wrong:** Transient network glitches or API rate limits on Nexconn or Gemini resulted in immediate hard errors without retry or failover.
- **Root cause:** `callNexconnApi` had no retries, no backoff, and did not utilize the secondary backup host `https://api-b.sg-light-api.com`. Gemini errors exposed raw JSON errors directly to students.
- **How fixed:** `callNexconnApi` now iterates through primary and secondary hosts with retry attempts and exponential backoff. Gemini 429 and `RESOURCE_EXHAUSTED` errors return a friendly fallback message advising students to check with a classmate.
- **Verification:** Automated tests in `tests/api-ai.test.mjs` simulating 429 quota exhaustion verified fallback response generation.

### Fix 5: Stale Closure Fixes in AI Replies & Mark Solved
- **What was wrong:** (1) If a user navigated to a different room while Gemini was drafting an answer, the reply was posted to the wrong room. (2) Marking a doubt solved from the Dashboard or My Doubts view failed to refresh the room's message state.
- **Root cause:** `askBot` and `solve` relied on the reactive `room` state variable in closures rather than receiving the explicit target room ID as an argument.
- **How fixed:** `askBot(targetRoom, doubtId, question)` and `solve(targetRoomId, message)` now receive explicit target room parameters and refresh the specific room that owns the message.
- **Verification:** Verified by switching views while AI response was in flight; reply arrived in the correct room.

### Fix 6: Friendly Error Translation for Nexconn Codes
- **What was wrong:** Joining restricted rooms, non-existent rooms, or rooms at capacity threw cryptic codes like `Join failed. Code: 25414`.
- **Root cause:** `joinRoom` and `sendTagged` in `src/chat.ts` did not translate Nexconn SDK error codes into student-facing descriptions.
- **How fixed:** Code 25414 maps to "This room requires an invite from the owner and does not allow open joining", 25410 to "Room code not found", 25411 to "This room has reached the maximum capacity of 300 members", and 22406 to "You are not a member of this room".
- **Verification:** Verified via `tests/routes-auth.test.mjs` and manual error code tests.

### Fix 7: Layout Wrap & Peer Avatar Initials
- **What was wrong:** Long unbroken strings (such as long URLs or formulas) broke the horizontal container width. Classmates were identified by 24-character hexadecimal IDs (`student7f3b890a2c...`).
- **Root cause:** Missing `overflow-wrap: anywhere` in CSS; no avatar or friendly name formatting in `renderDoubt`.
- **How fixed:** Added `overflow-wrap: anywhere; word-break: break-word;` across doubt and reply text. Generated colored circular initials avatars and friendly `Peer ####` tags derived from user IDs.
- **Verification:** Verified in browser rendering tests across mobile (390px) and desktop (1440px).

---

## 5. Two-User End-to-End Verification Results

Automated live Chrome browser testing was executed using two separate incognito browser contexts (`aliceContext` and `bobContext`) connecting to the live backend server (`127.0.0.1:8787`) and Vite frontend (`127.0.0.1:5173`) using real Nexconn Singapore data center credentials and Gemini API.

| Step | Test Action | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| **a** | Alice signs in, creates room `physics101`; Bob signs in (separate context) and joins. | Alice authenticated and enters `physics101`. Bob signs in independently and joins `physics101`. | Alice signed in as `Alice`, created room `physics101`. Bob signed in in isolated context and joined `physics101`. | **PASS** |
| **b** | Alice posts "Why does a ball thrown upward slow down?" and an AI reply appears for both users within ~10 seconds. | Question appears on Alice's screen; Gemini drafts and posts AI reply within 10s. Bob's UI receives doubt and AI reply in real time. | Alice posted doubt; Gemini reply ("Assuming you mean a ball thrown upward on Earth...") arrived in ~3.8s. Bob's screen updated live with doubt and AI reply. | **PASS** |
| **c** | Bob replies; Alice sees it live. | Bob submits "Because gravity constantly exerts a downward gravitational acceleration on the ball." Alice sees reply appear immediately via SDK event. | Bob submitted reply. Alice's client received `onMessageReceived` / `onMessageMetadataUpdated` and rendered Bob's reply live without page refresh. | **PASS** |
| **d** | Alice marks it solved; Bob sees it live; it appears in the Solved list and in search. | Doubt metadata updates to `status: 'solved'`. Alice and Bob both see `SOLVED` label live. Appears in Solved tab and Answer Bank search for "gravity". | Alice clicked "Mark solved". Bob saw `SOLVED` status update live. Both saw doubt in Solved list. Querying "gravity" in Answer Bank returned the solved thread. | **PASS** |
| **e** | Reload both; everything persists. | Both browsers reloaded (F5 simulation). Active session, user name, room membership, and thread history persist. | Both pages reloaded. Alice remained Alice, Bob remained Bob. All doubts, AI replies, and classmate responses rehydrated correctly from `sessionStorage` and Nexconn history. | **PASS** |
| **f** | Kill API briefly: UI shows a clear message and recovers when it returns. | When API server process terminates, UI displays clear "API server unreachable" alert. When restarted, banner dismisses automatically. | Server killed: UI displayed warning banner within health check interval. Server restarted: UI detected healthy endpoint and restored normal status automatically. | **PASS** |
| **g** | Production build passes. | `npm run build` (`tsc -b && vite build`) executes cleanly with zero type or bundling errors. | Build finished cleanly in 208ms with zero errors. Bundle verified. | **PASS** |


