const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = 3000;

// Cache to avoid hammering Letterboxd
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchLBD(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  cache.set(url, { data: html, ts: Date.now() });
  return html;
}

// Scrape a user's film ratings (paginated)
async function getUserRatings(username, maxPages = 8) {
  const ratings = {};
  const filmMeta = {};

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://letterboxd.com/${username}/films/rated/page/${page}/`;
    let html;
    try {
      html = await fetchLBD(url);
    } catch (e) {
      break;
    }

    const $ = cheerio.load(html);
    const films = $('li.poster-container');
    if (films.length === 0) break;

    films.each((_, el) => {
      const $el = $(el);
      const ratingEl = $el.find('.rating');
      const posterEl = $el.find('.film-poster');
      
      const slug = posterEl.attr('data-film-slug');
      const name = posterEl.attr('data-film-name') || posterEl.find('img').attr('alt');
      const ratingClass = ratingEl.attr('class') || '';
      const match = ratingClass.match(/rated-(\d+)/);
      
      if (slug && match) {
        const stars = parseInt(match[1]) / 2; // Convert 1-10 to 0.5-5
        ratings[slug] = stars;
        filmMeta[slug] = { name: name || slug, slug };
      }
    });

    // Check if there's a next page
    const hasNext = $('a.next').length > 0;
    if (!hasNext) break;
  }

  return { ratings, filmMeta };
}

// Scrape user profile info
async function getUserProfile(username) {
  try {
    const html = await fetchLBD(`https://letterboxd.com/${username}/`);
    const $ = cheerio.load(html);
    
    const displayName = $('h1.title-1').text().trim() || username;
    const avatar = $('div.profile-avatar img').attr('src') || null;
    const filmCount = $('a[href*="/films/"]').filter((_, el) => {
      return $(el).closest('.profile-stats').length > 0;
    }).first().text().trim();

    // Check if user exists
	const notFound = $('section.error').length > 0 || html.includes("Sorry, we can't find the page");
    if (notFound) throw new Error('User not found');

    return { username, displayName, avatar };
  } catch (e) {
    throw new Error(`User "${username}" not found on Letterboxd`);
  }
}

// Compute match % and clash films between two users
function compareUsers(userA, userB) {
  const ratingsA = userA.ratings;
  const ratingsB = userB.ratings;
  const allMeta = { ...userA.filmMeta, ...userB.filmMeta };

  const sharedFilms = Object.keys(ratingsA).filter(slug => ratingsB[slug] !== undefined);
  
  if (sharedFilms.length === 0) {
    return { matchPercent: 0, sharedCount: 0, clashFilms: [], agreements: [] };
  }

  // Match % = 1 - average normalized difference
  let totalDiff = 0;
  const clashFilms = [];
  const agreements = [];

  sharedFilms.forEach(slug => {
    const rA = ratingsA[slug];
    const rB = ratingsB[slug];
    const diff = Math.abs(rA - rB);
    totalDiff += diff;

    const film = { 
      slug, 
      name: allMeta[slug]?.name || slug,
      ratingA: rA, 
      ratingB: rB, 
      diff 
    };

    if (diff >= 2) clashFilms.push(film); // 2+ star gap = CLASH
    if (diff <= 0.5) agreements.push(film);
  });

  const avgDiff = totalDiff / sharedFilms.length;
  const matchPercent = Math.round((1 - avgDiff / 4.5) * 100); // max diff is 4.5 (0.5 vs 5)

  clashFilms.sort((a, b) => b.diff - a.diff);
  agreements.sort((a, b) => b.ratingA - a.ratingA);

  return {
    matchPercent: Math.max(0, Math.min(100, matchPercent)),
    sharedCount: sharedFilms.length,
    clashFilms: clashFilms.slice(0, 10),
    agreements: agreements.slice(0, 10),
  };
}

// Genre taste from recent films
async function getUserGenres(username) {
  const genres = {};
  try {
    const html = await fetchLBD(`https://letterboxd.com/${username}/films/genre/`);
    const $ = cheerio.load(html);
    
    // Scrape genre stats from the genre page
    $('a.genre').each((_, el) => {
      const $el = $(el);
      const genre = $el.text().trim();
      const countText = $el.find('span').text().trim();
      const count = parseInt(countText.replace(/,/g, '')) || 0;
      if (genre && count > 0) genres[genre] = count;
    });
  } catch (e) {
    // fallback: empty
  }
  return genres;
}

// ─── ROUTES ───────────────────────────────────────────────────

// Validate & fetch user
app.get('/api/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const profile = await getUserProfile(username);
    res.json({ success: true, user: profile });
  } catch (e) {
    res.status(404).json({ success: false, error: e.message });
  }
});

// Full scan of a user's ratings
app.get('/api/scan/:username', async (req, res) => {
  try {
    const { username } = req.params;
    console.log(`Scanning ${username}...`);
    const [profile, { ratings, filmMeta }] = await Promise.all([
      getUserProfile(username),
      getUserRatings(username),
    ]);
    
    const filmCount = Object.keys(ratings).length;
    console.log(`  → ${filmCount} rated films found`);
    
    res.json({ success: true, profile, ratings, filmMeta, filmCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Compare two scanned users (client sends the data)
app.post('/api/compare', (req, res) => {
  try {
    const { userA, userB } = req.body;
    const result = compareUsers(userA, userB);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎬 Letterboxd Clash running at http://localhost:${PORT}\n`);
});
