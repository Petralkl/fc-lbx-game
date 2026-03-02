const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = 3000;

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

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

async function scrapeFilmPage(username, mode, maxPages = 10) {
  const ratings = {};
  const filmMeta = {};
  const watched = {};

  for (let page = 1; page <= maxPages; page++) {
    const url = mode === 'rated'
      ? `https://letterboxd.com/${username}/films/rated/page/${page}/`
      : `https://letterboxd.com/${username}/films/page/${page}/`;

    let html;
    try { html = await fetchLBD(url); } catch (e) { break; }

    const $ = cheerio.load(html);
    const films = $('li.poster-container');
    if (films.length === 0) break;

    films.each((_, el) => {
      const $el = $(el);
      const posterEl = $el.find('.film-poster');
      const ratingEl = $el.find('.rating');

      const slug = posterEl.attr('data-film-slug');
      const name = posterEl.attr('data-film-name') || posterEl.find('img').attr('alt');
      if (!slug) return;

      filmMeta[slug] = { name: name || slug, slug };
      watched[slug] = true;

      const ratingClass = ratingEl.attr('class') || '';
      const match = ratingClass.match(/rated-(\d+)/);
      if (match) ratings[slug] = parseInt(match[1]) / 2;
    });

    const hasNext = $('a.next').length > 0;
    if (!hasNext) break;
  }

  return { ratings, filmMeta, watched };
}

async function getUserProfile(username) {
  const html = await fetchLBD(`https://letterboxd.com/${username}/`);
  const $ = cheerio.load(html);

  const notFound = $('section.error').length > 0 || html.includes("Sorry, we can't find the page");
  if (notFound) throw new Error(`User "${username}" not found on Letterboxd`);

  const displayName = $('h1.title-1').text().trim() || username;
  const avatar = $('div.profile-avatar img').attr('src') || null;

  return { username, displayName, avatar };
}

function compareUsers(userA, userB) {
  const ratingsA = userA.ratings || {};
  const ratingsB = userB.ratings || {};
  const watchedA = userA.watched || {};
  const watchedB = userB.watched || {};
  const allMeta = { ...userA.filmMeta, ...userB.filmMeta };

  const bothRated = Object.keys(ratingsA).filter(slug => ratingsB[slug] !== undefined);

  const allWatchedSlugs = new Set([...Object.keys(watchedA), ...Object.keys(watchedB)]);
  const bothWatched = [...allWatchedSlugs].filter(slug => watchedA[slug] && watchedB[slug]);
  const onlyA = [...allWatchedSlugs].filter(slug => watchedA[slug] && !watchedB[slug]);
  const onlyB = [...allWatchedSlugs].filter(slug => !watchedA[slug] && watchedB[slug]);

  let totalDiff = 0;
  const clashFilms = [];
  const agreements = [];

  bothRated.forEach(slug => {
    const rA = ratingsA[slug];
    const rB = ratingsB[slug];
    const diff = Math.abs(rA - rB);
    totalDiff += diff;
    const film = { slug, name: allMeta[slug]?.name || slug, ratingA: rA, ratingB: rB, diff };
    if (diff >= 2) clashFilms.push(film);
    if (diff <= 0.5) agreements.push(film);
  });

  const avgDiff = bothRated.length > 0 ? totalDiff / bothRated.length : 0;
  const matchPercent = bothRated.length > 0
    ? Math.max(0, Math.min(100, Math.round((1 - avgDiff / 4.5) * 100)))
    : 0;

  clashFilms.sort((a, b) => b.diff - a.diff);
  agreements.sort((a, b) => b.ratingA - a.ratingA);

  const sharedWatchedList = bothWatched
    .map(slug => ({
      slug,
      name: allMeta[slug]?.name || slug,
      ratingA: ratingsA[slug] || null,
      ratingB: ratingsB[slug] || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 300);

  return {
    matchPercent,
    sharedRatedCount: bothRated.length,
    sharedWatchedCount: bothWatched.length,
    onlyACount: onlyA.length,
    onlyBCount: onlyB.length,
    clashFilms: clashFilms.slice(0, 15),
    agreements: agreements.slice(0, 15),
    sharedWatchedList,
  };
}

app.get('/api/scan/:username', async (req, res) => {
  try {
    const { username } = req.params;
    console.log(`Scanning ${username}...`);

    const [profile, { ratings, filmMeta, watched }] = await Promise.all([
      getUserProfile(username),
      scrapeFilmPage(username, 'watched', 10),
    ]);

    const watchedCount = Object.keys(watched).length;
    const ratedCount = Object.keys(ratings).length;
    console.log(`  -> ${watchedCount} watched, ${ratedCount} rated`);

    res.json({ success: true, profile, ratings, filmMeta, watched, watchedCount, ratedCount });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

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
  console.log(`\n Letterboxd Clash running at http://localhost:${PORT}\n`);
});