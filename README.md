# Dednate — Haunted Hollow
Halloween multiplayer party game for 2–8 players, with up to 24 total guests including spectators.

## Run
Install Node.js 22 or newer. Run `npm install`, then `npm start`. Open http://localhost:3000. Render uses PORT automatically.

## Play
Create a room and share the invite link or six-character code. The host starts the match or rematch. Move using WASD, arrow keys, or the phone joystick. Tag another player to pass the cursed pumpkin. The hidden random fuse never resets on a pass. Last survivor wins.

Candy: 5-second speed boost. Shield: blocks incoming tags for 5 seconds, but cannot prevent your own pumpkin from exploding. Portal: instant random teleport. Random events: ghost fog, witching-hour speed, and closing gates.

Late joiners watch the current match. Eliminated players also spectate. Between matches, spectators can choose Play next match if a spot is free. Wins and passes are tracked for connected guests in the room.

## Hosting
Deploy as a single Node web service: build `npm install`, start `npm start`. Health check: /health. Active rooms and scores live in memory; restarting the server or leaving a room resets that state. Use one server instance.
