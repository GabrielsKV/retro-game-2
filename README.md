# RetroHub

Real-time retro games for Scrum Masters. Up to 15 people join from any phone or computer by QR code or room code, on any network. 55 games, zero dependencies (plain Node.js, Server-Sent Events).

## Run locally
    node server.js        # http://localhost:8080

## Deploy to Fly.io
    fly auth login
    fly launch --no-deploy --copy-config   # pick a unique app name, keep fly.toml settings
    fly scale count 1                      # IMPORTANT: one machine only, rooms are in memory
    fly deploy
Open `https://<your-app>.fly.dev`, click **Create a room**, and show the QR code on screen.

## Push to GitHub
    git init && git add . && git commit -m "RetroHub"
    git branch -M main && git remote add origin <your-repo-url> && git push -u origin main

## Notes
- Rooms are in memory; a redeploy or restart clears them. Participants rejoin automatically if the server is still up.
- Add games in `games.js`: use `T` (cards + dot voting), `S` (rating scale) or `C` (pick one).
