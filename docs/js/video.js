// Video links from the Sheet (Episodes.blink_url / embed_url). A YouTube link in either column is
// turned into the privacy-enhanced embed player (youtube-nocookie.com) so the episode plays inside
// the Hub. Any other link is left alone: an https embed_url still plays in the frame, a Blink link
// still opens Blink in a new tab. Pure functions, no DOM: tested in tests/e2e/video.spec.mjs.

const ID = /^[A-Za-z0-9_-]{11}$/;
const LIST = /^[A-Za-z0-9_-]{10,64}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

function parse(url) {
  if (typeof url !== 'string') return null;
  const s = url.trim();
  if (!/^https:\/\/[^\s]+$/i.test(s)) return null;
  try { return new URL(s); } catch (e) { return null; }
}

/** True when the link points at YouTube (any of its usual hosts). */
export function isYouTube(url) {
  const u = parse(url);
  return !!u && YT_HOSTS.has(u.hostname.toLowerCase());
}

// "90", "90s", "1m30s", "1h2m3s" → seconds (0 when absent or unreadable).
function seconds(t) {
  if (!t) return 0;
  if (/^\d+s?$/.test(t)) return parseInt(t, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m && m[0] ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0;
}

/**
 * The embed URL for a YouTube video or playlist link, or '' when the link is not YouTube (or has no
 * readable video id). Accepts watch?v=, youtu.be/, shorts/, live/, embed/ and playlist?list= links.
 */
export function youTubeEmbed(url) {
  const u = parse(url);
  if (!u || !YT_HOSTS.has(u.hostname.toLowerCase())) return '';
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  let id = '';
  if (host === 'youtu.be') id = parts[0] || '';
  else if (parts[0] === 'watch') id = u.searchParams.get('v') || '';
  else if (['shorts', 'live', 'embed', 'v'].includes(parts[0])) id = parts[1] || '';
  const list = u.searchParams.get('list') || '';
  const q = new URLSearchParams();
  let path;
  if (ID.test(id)) {
    path = id;
    if (LIST.test(list)) q.set('list', list);
  } else if ((parts[0] === 'playlist' || (parts[0] === 'embed' && id === 'videoseries')) && LIST.test(list)) {
    path = 'videoseries';
    q.set('list', list);
  } else return '';
  const start = seconds(u.searchParams.get('t') || u.searchParams.get('start') || '');
  if (start > 0) q.set('start', String(start));
  q.set('rel', '0');
  q.set('playsinline', '1');
  return `https://www.youtube-nocookie.com/embed/${path}?${q.toString()}`;
}

/**
 * What the course player should frame for an episode: a YouTube link in embed_url or blink_url
 * becomes the YouTube player; otherwise an https embed_url as given; otherwise ''.
 */
export function playerSrc(embedUrl, blinkUrl) {
  const yt = youTubeEmbed(embedUrl) || youTubeEmbed(blinkUrl);
  if (yt) return yt;
  const e = parse(embedUrl);
  return e ? e.href : '';
}
