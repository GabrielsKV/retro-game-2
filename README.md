# RetroHub

Real-time retro and team games for Scrum Masters. Up to 15 people join from any phone or computer by QR code, link or room code, on any network. 61 games, zero dependencies (plain Node.js + Server-Sent Events).

## Run locally
    node server.js        # http://localhost:8080

## Deploy to Fly.io
    fly launch --no-deploy --copy-config
    fly scale count 1                      # IMPORTANT: exactly one machine
    fly deploy
    fly ips allocate-v4 --shared && fly ips allocate-v6

## Keep rooms across deploys and restarts (recommended)
    fly volumes create retro_data --size 1 --region ams
Then add this to `fly.toml` and redeploy:

    [mounts]
      source = "retro_data"
      destination = "/data"

Rooms are saved to `/data/rooms.json`. Players reconnect automatically after a restart.

## Optional settings (fly secrets / env)
- `TEAM_NAME` shows your team name on the start page: `fly secrets set TEAM_NAME="Team Falcon"`
- `SLACK_WEBHOOK_URL` enables "Send to Slack" for the notes: `fly secrets set SLACK_WEBHOOK_URL=https://hooks.slack.com/...`

## Features
Agendas, action items with owners, Markdown export, discuss timer, card editing and reactions, anonymous or named cards, kick / make host, room password, custom quiz builder, session leaderboard, Two Truths and a Lie, present mode, light/dark theme, sound and confetti.

## Security
- Room codes are 6 characters; player tokens are 128-bit random secrets and are never shown to other players.
- Room and team passwords are stored salted and hashed (scrypt), compared in constant time.
- Rate limits per IP (room creation, joins, password attempts, requests), connection and size limits, request timeouts.
- Strict headers: Content-Security-Policy, HSTS, no framing, no sniffing; cross-site requests are rejected.
- Team trends are tied to the team password, so another team cannot read your history.
- All user text is escaped before display. Do not put confidential data in a retro: this is a casual team tool, not a hardened enterprise system.

## Add games
Edit `games.js`: `T` (cards + dot voting), `S` (rating scale), `C` (pick one), `R` (quiz, poll or who-is-most-likely rounds).
