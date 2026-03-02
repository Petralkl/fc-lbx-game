# 🎬 LetterCLASH

A locally-hosted app for comparing Letterboxd taste profiles in a group "room."  
Add usernames → scan their ratings → see who matches, who clashes, and on which films.

---

## Features

- **Room system** — add multiple Letterboxd users to a shared session
- **Match % leaderboard** — ranked compatibility scores for every pair
- **Clash mode** — films where two users rated wildly differently (2+ star gap)
- **Agreement view** — films both users loved equally
- **Taste profile** — genre breakdown per user (when available)

---

## Setup

### Requirements
- Node.js 18+ installed ([nodejs.org](https://nodejs.org))

### Install & Run

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in your browser
open http://localhost:3000
```

For auto-reload during development:
```bash
npm run dev
```

---

## How It Works

The backend scrapes Letterboxd's public HTML pages (no API key required):
- `/[username]/films/rated/page/N/` — fetches rated film slugs and star ratings
- Scrapes up to 8 pages (~640 films) per user by default (tweak `maxPages` in `server.js`)

**Clash detection**: Films where the rating gap is ≥ 2 stars (out of 5)  
**Match %**: Based on average rating difference across all shared films

---

## Tips

- Letterboxd rate-limits aggressive scrapers. If you get errors, wait a moment and retry.
- Ratings are cached for 5 minutes to avoid hammering Letterboxd.
- Users with private profiles or no public ratings will fail to scan.
- More shared films = more accurate match %.

---

## Notes

This app scrapes Letterboxd's public HTML. It does not use an official API.  
For personal/local use only — respect Letterboxd's terms of service.
