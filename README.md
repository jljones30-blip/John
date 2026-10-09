# HOT POTATO: BOMB SQUAD
Real-time multiplayer browser game. 2–8 players, room codes, synced movement, server-controlled bomb and eliminations.

## Run locally
1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run `npm install` then `npm start`.
4. Open `http://localhost:3000`.

## Deploy
Deploy this folder as a Node.js web service on a host that supports WebSockets (such as Render or Railway). Build command: `npm install`; start command: `npm start`. Share the resulting HTTPS URL. A single server instance holds all active rooms in memory; restarting it clears rooms. For production-scale deployment, add persistent/shared room state and reconnect handling.

## Rules
The host creates a room and shares its code. 2–8 players join with nicknames. Host starts the match. Move with WASD, arrow keys, or mobile touch arrows. Whoever holds the bomb must tag another player before the fuse expires. The bomb eliminates its holder when time runs out. Last surviving player wins. Host can start a rematch.
