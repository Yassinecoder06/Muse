# Muse API Endpoints Documentation

Comprehensive technical reference for all HTTP/REST endpoints provided by the Muse backend service (`/api`), including authentication requirements, request/response structures, and functionality descriptions.

---

## Table of Contents
1. [General Architecture & Authentication](#general-architecture--authentication)
2. [System & Health](#1-system--health)
3. [Authentication & Passkeys (WebAuthn)](#2-authentication--passkeys-webauthn)
4. [Zero-Knowledge Vault & Encryption](#3-zero-knowledge-vault--encryption)
5. [Notes & Organization](#4-notes--organization)
6. [Media & Image Uploads](#5-media--image-uploads)
7. [Knowledge Graph](#6-knowledge-graph)
8. [Calendar & Scheduling](#7-calendar--scheduling)
9. [Dedicated Tasks Management](#8-dedicated-tasks-management)
10. [Smart Schedule & Task Detection](#9-smart-schedule--task-detection)
11. [AI Jobs, Search & RAG](#10-ai-jobs-search--rag)
12. [AI Settings & Provider Keys](#11-ai-settings--provider-keys)
13. [Bip Autonomous Agent & Chat Sessions](#12-bip-autonomous-agent--chat-sessions)
14. [User Memories](#13-user-memories)
15. [Voice & Speech Transcription](#14-voice--speech-transcription)

---

## General Architecture & Authentication

All API endpoints are mounted under `/api` (e.g. `http://localhost:8080/api`).
* **Authentication Method:**
  * **Bearer Token:** Pass JWT in `Authorization: Bearer <supabase_access_token>`.
  * **Local / Cookie Session:** In local and fallback modes, session cookies or `X-Muse-User-Name` header identify the user session.
* **Content Negotiation:**
  * Default `Content-Type: application/json` unless uploading raw binary (images, audio, or research docs).
* **Base URLs:**
  * Development direct: `http://localhost:3002/api`
  * Nginx Gateway (Local/Production): `http://localhost:8080/api`

---

## 1. System & Health

### `GET /health`
* **Description:** Health check endpoint used by Docker, Kubernetes, and reverse proxies to check service availability.
* **Auth Required:** No
* **Response (200 OK):**
```json
{
  "ok": true
}
```

---

## 2. Authentication & Passkeys (WebAuthn)

### `POST /api/auth/session`
* **Description:** Creates an anonymous/local app session fallback when external auth is bypassed.
* **Auth Required:** No
* **Response (200 OK):**
```json
{
  "authenticated": true,
  "userId": "uuid-v4",
  "email": null
}
```

### `GET /api/auth/session`
* **Description:** Returns the current session authentication status.
* **Auth Required:** Optional
* **Response (200 OK):**
```json
{
  "authenticated": true,
  "userId": "uuid-v4",
  "email": "user@example.com",
  "method": "jwt"
}
```

### `DELETE /api/auth/session`
* **Description:** Destroys current session cookies and logs out.
* **Auth Required:** No
* **Response (200 OK):**
```json
{
  "success": true
}
```

### `POST /api/auth/passkeys/authentication/options`
* **Description:** Generates WebAuthn PublicKeyCredentialRequestOptions challenge for biometric / passkey login.
* **Auth Required:** No
* **Response (200 OK):**
```json
{
  "options": { ... },
  "challengeId": "string"
}
```

### `POST /api/auth/passkeys/authentication/verify`
* **Description:** Verifies client WebAuthn signature against stored credential and issues session.
* **Auth Required:** No
* **Request Body:** `{ challengeId: string, response: AuthenticationResponseJSON }`
* **Response (200 OK):** `{ authenticated: true, userId: string, email: string | null }`

### `GET /api/auth/passkeys`
* **Description:** Lists all registered passkeys for the authenticated user.
* **Auth Required:** Yes
* **Response (200 OK):** Array of Passkey objects (`id`, `name`, `device_type`, `created_at`, `last_used_at`).

### `POST /api/auth/passkeys/registration/options`
* **Description:** Generates WebAuthn registration options for creating a new passkey.
* **Auth Required:** Yes
* **Response (200 OK):** `{ options: PublicKeyCredentialCreationOptionsJSON, challengeId: string }`

### `POST /api/auth/passkeys/registration/verify`
* **Description:** Verifies registration credential response and registers the passkey on the account.
* **Auth Required:** Yes
* **Request Body:** `{ challengeId: string, response: RegistrationResponseJSON, name?: string }`
* **Response (200 OK):** `{ verified: true }`

### `DELETE /api/auth/passkeys/:id`
* **Description:** Revokes a registered passkey.
* **Auth Required:** Yes
* **Response (200 OK):** Status `204 No Content` or `{ success: true }`.

---

## 3. Zero-Knowledge Vault & Encryption

### `GET /api/vault`
* **Description:** Returns status of the user's client-side encrypted vault.
* **Auth Required:** Yes
* **Response (200 OK):**
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "configured": true,
  "vaultCheck": "base64-salt-and-ciphertext",
  "encryptionVersion": 2,
  "migrationStatus": "verified",
  "migrationVerifiedAt": "2026-10-18T12:00:00Z",
  "passkeyCount": 2
}
```

### `PUT /api/vault`
* **Description:** Sets up or updates the zero-knowledge vault passphrase verifier (`vaultCheck`).
* **Auth Required:** Yes
* **Request Body:** `{ vaultCheck: string }`
* **Response (200 OK):** `{ configured: true }`

### `GET /api/vault/records`
* **Description:** Retrieves encrypted vault records (`note`, `document`, `artifact`, `report`, `attachment`).
* **Query Parameters:** `?type=note` (optional)
* **Auth Required:** Yes
* **Response (200 OK):** Array of `VaultRecord` items with encrypted payloads.

### `POST /api/vault/records`
* **Description:** Batch saves client-side encrypted records.
* **Auth Required:** Yes
* **Request Body:** `{ records: VaultRecord[] }`
* **Response (200 OK):** `{ saved: number }`

### `POST /api/vault/migration`
* **Description:** Sets vault migration state (`copying`, `verified`, `failed`).
* **Auth Required:** Yes
* **Request Body:** `{ status: "copying" | "verified" | "failed" }`

### `GET /api/vault/legacy-export`
* **Description:** Exports legacy plaintext notes, documents, and artifacts prior to encrypting.
* **Auth Required:** Yes

---

## 4. Notes & Organization

### `GET /api/notes`
* **Description:** Lists all notes for the authenticated user with search and filtering.
* **Query Parameters:**
  * `q` (string): Text search across title and content.
  * `tag` (string): Filter by tag.
  * `trash` (boolean): Set to `true` to view trashed notes (default `false`).
* **Auth Required:** Yes
* **Response (200 OK):** Array of `Note` objects.

### `POST /api/notes`
* **Description:** Creates a new note. Triggers asynchronous background task generation (title, tags, summary, vectors).
* **Auth Required:** Yes
* **Request Body:**
```json
{
  "title": "Workout Plan",
  "content": "Bench press: 3x10...",
  "tags": ["fitness", "gym"],
  "specialized_category": "gym_workout",
  "specialized_fields": { "date": "2026-10-18", "exerciseCount": 5 },
  "color": "lavender"
}
```
* **Response (201 Created):** Created `Note` object.

### `GET /api/notes/:id`
* **Description:** Retrieves a single note by UUID.
* **Auth Required:** Yes

### `PUT /api/notes/:id`
* **Description:** Updates note content, tags, custom fields, and color accent.
* **Auth Required:** Yes
* **Request Body:** Partial or full note fields.
* **Response (200 OK):** Updated `Note` object.

### `DELETE /api/notes/:id`
* **Description:** Soft-deletes a note (moves it to Trash).
* **Auth Required:** Yes

### `POST /api/notes/:id/restore`
* **Description:** Restores a soft-deleted note from Trash.
* **Auth Required:** Yes

### `DELETE /api/notes/:id/permanent`
* **Description:** Permanently deletes a note from PostgreSQL and cleans up its vector embedding from Qdrant.
* **Auth Required:** Yes

### `POST /api/notes/bulk-trash`
* **Description:** Moves multiple note IDs to Trash simultaneously.
* **Request Body:** `{ ids: string[] }`

### `POST /api/notes/bulk-restore`
* **Description:** Restores multiple note IDs from Trash simultaneously.
* **Request Body:** `{ ids: string[] }`

### `DELETE /api/notes/bulk`
* **Description:** Permanently removes multiple notes and removes embeddings.
* **Request Body:** `{ ids: string[] }`

### `DELETE /api/notes/trash`
* **Description:** Empties all items currently in Trash.
* **Auth Required:** Yes

### `DELETE /api/notes/:id/summary`
* **Description:** Clears the AI-generated summary from a note.

### `DELETE /api/notes/:id/tasks`
* **Description:** Clears extracted tasks from a note.

### `POST /api/notes/:id/organize`
* **Description:** Runs an AI organization pass over a note to format structure, fix headings, and normalize bullet points.
* **Auth Required:** Yes

---

## 5. Media & Image Uploads

### `POST /api/uploads`
* **Description:** Uploads an image binary directly.
* **Auth Required:** Yes
* **Headers:** `Content-Type: image/jpeg` (or `image/png`, `image/webp`, `image/gif`, `image/avif`)
* **Query Parameters:** `?noteId=<uuid>` (optional)
* **Request Body:** Raw image buffer (up to 5 MB).
* **Response (201 Created):**
```json
{
  "url": "/api/images/<uuid>"
}
```

### `GET /api/images/:id`
* **Description:** Streams image binary with private 24-hour cache control headers.
* **Auth Required:** Yes

### `POST /api/research/documents`
* **Description:** Uploads and security-scans research documents (PDF, DOCX, TXT up to 10MB). Checks for macro injection and malicious prompt vectors before ingesting.
* **Headers:** `X-Research-Filename: <encoded_filename>`, `Content-Type: <mime>`
* **Request Body:** Raw file binary.
* **Response (200 OK):**
```json
{
  "id": "uuid",
  "filename": "financial_report.pdf",
  "mime": "application/pdf",
  "size": 1048576,
  "created_at": "2026-10-18T10:00:00Z"
}
```

### `GET /api/reports/:noteId/export`
* **Description:** Exports deep research reports as downloadable files.
* **Query Parameters:** `?format=html` (or `pdf`, `docx`)
* **Response (200 OK):** File binary download.

---

## 6. Knowledge Graph

### `GET /api/graph`
* **Description:** Computes graph topology across notes. Creates node elements for notes and generates edges based on vector cosine similarity in Qdrant and shared tags.
* **Auth Required:** Yes
* **Response (200 OK):**
```json
{
  "nodes": [
    { "id": "note-1", "title": "Gym", "tags": ["fitness"], "val": 1.2 }
  ],
  "links": [
    { "source": "note-1", "target": "note-2", "similarity": 0.84, "reason": "semantic" }
  ]
}
```

---

## 7. Calendar & Scheduling

### `GET /api/calendar/events`
* **Description:** Lists calendar events.
* **Query Parameters:** `from` (ISO string), `to` (ISO string).
* **Auth Required:** Yes
* **Response (200 OK):** Array of `CalendarEvent` objects.

### `POST /api/calendar/events`
* **Description:** Creates a calendar event.
* **Request Body:**
```json
{
  "title": "Gym Workout",
  "start_time": "2026-10-19T10:00:00Z",
  "end_time": "2026-10-19T11:00:00Z",
  "all_day": false,
  "note_id": "uuid",
  "description": "Leg day session"
}
```

### `POST /api/calendar/events/quick-add`
* **Description:** Parses natural language scheduling strings using AI into a structured event.
* **Request Body:**
```json
{
  "prompt": "Dentist appointment next Tuesday at 2:30pm",
  "clientDate": "2026-10-18T17:00:00Z",
  "note_id": null
}
```

### `PUT /api/calendar/events/:id`
* **Description:** Updates event details, dates, or note association.

### `DELETE /api/calendar/events/:id`
* **Description:** Deletes a calendar event.

---

## 8. Dedicated Tasks Management

### `GET /api/tasks`
* **Description:** Retrieves tasks with optional filtering.
* **Query Parameters:** `?due_date=YYYY-MM-DD`
* **Auth Required:** Yes
* **Response (200 OK):** Array of `Task` objects.

### `POST /api/tasks`
* **Description:** Creates a standalone or note-linked task.
* **Request Body:**
```json
{
  "text": "Review pull request",
  "due_date": "2026-10-19",
  "due_time": "14:00",
  "priority": "high",
  "note_id": null
}
```

### `PATCH /api/tasks/:id`
* **Description:** Updates task completion or text.
* **Request Body:** `{ completed: true }` or partial task object.

### `DELETE /api/tasks/:id`
* **Description:** Permanently deletes a task.

---

## 9. Smart Schedule & Task Detection

### `POST /api/notes/:id/detect` & `POST /api/notes/detect`
* **Description:** Analyzes note text using AI to identify calendar dates, meetings, milestones, and actionable tasks.
* **Request Body (if no note ID):** `{ title: "string", content: "string" }`
* **Response (200 OK):**
```json
{
  "events": [
    { "title": "Team sync", "start_time": "2026-10-20T14:00:00Z", "all_day": false }
  ],
  "tasks": [
    { "text": "Prepare presentation slides", "due_date": "2026-10-20", "priority": "high" }
  ]
}
```

### `POST /api/notes/:id/apply-detections` & `POST /api/notes/apply-detections`
* **Description:** Atomically commits confirmed detected events and tasks into the calendar and task lists.
* **Request Body:** `{ events: [...], tasks: [...] }`
* **Response (200 OK):** `{ success: true, addedEvents: 1, addedTasks: 2 }`

---

## 10. AI Jobs, Search & RAG

### `POST /api/chat/note`
* **Description:** Answers questions strictly constrained to the single active note's content.
* **Request Body:**
```json
{
  "noteId": "uuid",
  "question": "What weights did I use for bench press?",
  "history": [{ "role": "user", "text": "..." }]
}
```
* **Response (202 Accepted):** AI job descriptor for polling.

### `POST /api/chat/search`
* **Description:** RAG semantic search. Queries Qdrant vectors across all user notes, retrieves matching notes, and cites them in the response.
* **Request Body:** `{ question: string, history?: HistoryItem[] }`

### `POST /api/ai/stream`
* **Description:** Server-Sent Events (SSE) token streaming for real-time text formatting and rewrites.
* **Request Body:** `{ text: string, mode: "summarize" | "professional" | "bullets" | ... }`

### `POST /api/ai/jobs`
* **Description:** Enqueues background AI job (e.g. `research`, `summarize`, `tags`).
* **Request Body:** `{ type: "research", topic: "AI Trends", depth: "in-depth" }`
* **Response (202 Accepted):** `{ id: "job-id", status: "queued" }`

### `GET /api/ai/jobs/:id`
* **Description:** Checks status and results of an enqueued AI job (`queued`, `processing`, `completed`, `failed`).

### `GET /api/ai/jobs/:id/artifacts`
* **Description:** Retrieves structured report artifacts generated by deep research jobs.

### `GET /api/ai/active`
* **Description:** Returns `{ running: boolean, type?: string }` indicating whether background processing is active.

### `GET /api/models`
* **Description:** Returns all supported AI models:
  * Gemini hierarchy (`gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`).
  * Ollama Cloud models (`beam:cloud` - Reflection AI 501B MoE, `gpt-oss:120b-cloud`, `nemotron-3-super:cloud`).
  * Local Ollama models (`gemma4-ab-qat:e4b`).

### `GET /api/ai/usage`
* **Description:** Returns real-time API quota counters, requests used today, and token usage limits. Dynamically routes to the active model or provider.
* **Query Parameters:**
  * `?model=<model_name>`: (Optional) Model name to inspect (e.g. `beam:cloud` for Ollama Cloud, or `gemini-3.7-flash` for Gemini).
  * `?provider=gemini|ollama`: (Optional) Explicitly inspect quota for Google Gemini or Ollama Cloud.
* **Response (Gemini):**
```json
{
  "configured": true,
  "provider": "gemini",
  "plan": "Google AI Studio · Free Tier",
  "dailyLimit": 1500,
  "requestsToday": 42,
  "totalTokens": 125000,
  "session": { "usedPct": 2.8, "models": [{ "name": "gemini-3.7-flash", "requests": 42, "tokens": 125000 }] },
  "weekly": { "usedPct": 12.5, "models": [] }
}
```
* **Response (Ollama Cloud):**
```json
{
  "configured": true,
  "provider": "ollama",
  "plan": "Ollama Cloud",
  "session": { "usedPct": 15.0, "models": [{ "name": "beam:cloud", "requests": 8 }] },
  "weekly": { "usedPct": 22.4, "models": [{ "name": "beam:cloud", "requests": 8 }] }
}
```

---

## 11. AI Settings & Provider Keys

### `GET /api/settings`
* **Description:** Returns which API keys are configured and the active provider (`gemini`, `ollama`, or `local`).
* **Response (200 OK):**
```json
{
  "hasApiKey": true,
  "hasGeminiKey": true,
  "hasOllamaKey": true,
  "activeProvider": "gemini"
}
```

### `PUT /api/settings`
* **Description:** Validates and saves an API key (Google Gemini AI Studio key or Ollama Cloud key).
* **Request Body:** `{ apiKey: string, provider?: "gemini" | "ollama" }`

### `DELETE /api/settings`
* **Description:** Deletes the stored API key for a provider.
* **Query Parameters:** `?provider=gemini` or `?provider=ollama`

---

## 12. Bip Autonomous Agent & Chat Sessions

### `GET /api/chat/sessions`
* **Description:** Lists all conversational sessions with Bip.
* **Response (200 OK):** Array of `ChatSession` objects ordered by `updated_at DESC`.

### `POST /api/chat/sessions`
* **Description:** Creates a new chat session.
* **Request Body:** `{ title?: string, context_type?: string, context_id?: string | null }`

### `GET /api/chat/sessions/:id`
* **Description:** Retrieves session metadata and recent message history.

### `PATCH /api/chat/sessions/:id`
* **Description:** Renames a chat session title.
* **Request Body:** `{ title: string }`

### `DELETE /api/chat/sessions/:id`
* **Description:** Deletes a session and all its associated messages.

### `POST /api/chat/sessions/:id/messages`
* **Description:** Sends a message to Bip. Executes autonomous tool calls (create notes, tasks, events, memories), evaluates waterfall model cascade, and returns confirmed user and assistant messages with action cards.
* **Request Body:**
```json
{
  "message": "Add a task to submit the quarterly report tomorrow at 3pm and write a note with the checklist",
  "model": "gemini-3.8-flash"
}
```
* **Response (200 OK):**
```json
{
  "userMessage": { "id": "uuid", "role": "user", "content": "..." },
  "assistantMessage": {
    "id": "uuid",
    "role": "assistant",
    "content": "Beep boop! 🤖 I have created your task and prepared the note.",
    "action_cards": [
      { "type": "task", "id": "task-uuid", "title": "Submit quarterly report", "action": "created" },
      { "type": "note", "id": "note-uuid", "title": "Checklist", "action": "created" }
    ]
  },
  "sessionTitle": "Quarterly Report Tasks"
}
```

### `PATCH /api/chat/messages/:id`
* **Description:** Edits the text content of a chat message (user prompt or assistant note).
* **Auth Required:** Yes
* **Request Body:**
```json
{
  "content": "Updated message text"
}
```
* **Response (200 OK):** Updated `ChatMessage` object.

### `DELETE /api/chat/messages/:id`
* **Description:** Deletes an individual message from the session history.
* **Auth Required:** Yes
* **Response (200 OK):** `{ "success": true }`

---

## 13. User Memories

### `GET /api/chat/memories`
* **Description:** Lists persistent user preferences, goals, and facts remembered by Bip.
* **Auth Required:** Yes
* **Response (200 OK):** Array of `UserMemory` items (`id`, `fact`, `category`, `updated_at`).

### `POST /api/chat/memories`
* **Description:** Stores a new permanent user fact or preference.
* **Request Body:**
```json
{
  "fact": "I prefer morning meetings before 11am",
  "category": "schedule"
}
```

### `DELETE /api/chat/memories/:id`
* **Description:** Deletes a stored memory.

---

## 14. Voice & Speech Transcription

### `POST /api/voice/transcribe`
* **Description:** Server-side fallback audio transcription using Gemini Multimodal Audio when client browser SpeechRecognition is unsupported.
* **Auth Required:** Yes
* **Headers:** `Content-Type: audio/webm` (or `audio/wav`, `audio/mp4`, `audio/ogg`), `X-Muse-User-Name: <encoded>`
* **Request Body:** Raw recorded audio blob (up to 15 MB).
* **Response (200 OK):**
```json
{
  "text": "Transcribed spoken text here"
}
```

---

## 15. Remote Mobile Companion

Endpoints facilitating secure remote pairing and synchronization between mobile companion clients (Flutter app) and Muse host over Wi-Fi / LAN or remote tunnels (Tailscale, Cloudflare).

### `GET /api/remote/network-info`
* **Description:** Detects and returns host network connection addresses (LAN IP, Tailscale IP, configured Public URL).
* **Auth Required:** No
* **Response (200 OK):**
```json
{
  "localIp": "192.168.100.136",
  "localUrl": "http://192.168.100.136:8080",
  "tailscaleIp": "100.84.254.110",
  "tailscaleUrl": "http://100.84.254.110:8080",
  "publicUrl": "http://192.168.100.136:8080"
}
```

### `POST /api/remote/pairing/create`
* **Description:** Generates a short-lived (5-minute TTL) one-time cryptographic pairing token and 6-digit verification PIN for desktop QR pairing.
* **Auth Required:** Yes
* **Request Body:**
```json
{
  "serverUrl": "http://192.168.100.136:8080"
}
```
* **Response (200 OK):**
```json
{
  "token": "muse_pair_...",
  "pin": "482910",
  "serverUrl": "http://192.168.100.136:8080",
  "qrPayload": "muse://pair?data=...",
  "expiresAt": "2026-10-18T19:50:00.000Z"
}
```

### `POST /api/remote/pairing/claim`
* **Description:** Redeems a pairing token or PIN from the mobile app, creates a secure persistent device authentication token, and registers the mobile phone.
* **Auth Required:** No (one-time claim with token or pin)
* **Request Body:**
```json
{
  "token": "muse_pair_...",
  "pin": "482910",
  "deviceName": "Xiaomi Redmi Note 13",
  "deviceModel": "Android 15"
}
```
* **Response (200 OK):**
```json
{
  "success": true,
  "serverUrl": "http://192.168.100.136:8080",
  "deviceToken": "muse_dev_...",
  "device": {
    "id": "uuid",
    "name": "Xiaomi Redmi Note 13",
    "model": "Android 15"
  }
}
```

### `GET /api/remote/pairing/status`
* **Description:** Polled by desktop client while the pairing QR code modal is open. Detects when the mobile camera scans and claims the session.
* **Query Params:** `?token=muse_pair_...`
* **Auth Required:** No
* **Response (200 OK):**
```json
{
  "claimed": true,
  "device": {
    "name": "Xiaomi Redmi Note 13",
    "model": "Android 15"
  }
}
```

### `GET /api/remote/devices`
* **Description:** Lists all active mobile and remote companion devices authorized on this workspace.
* **Auth Required:** Yes
* **Response (200 OK):** Array of `RemoteDevice` objects (`id`, `device_name`, `device_model`, `last_active_at`, `created_at`).

### `DELETE /api/remote/devices/:id`
* **Description:** Immediately revokes access for a paired companion device.
* **Auth Required:** Yes
* **Response (200 OK):** `{ "success": true }`

