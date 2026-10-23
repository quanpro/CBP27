// Runs before first paint (classic script).
// 1. Frame-busting: GitHub Pages cannot send frame-ancestors, so the Hub refuses to run inside another site's frame.
if (window.top !== window.self) {
  try { window.top.location.replace(window.location.href); } catch (e) { document.documentElement.style.display = 'none'; }
}
// 2. Apply the saved light/dark choice so it does not flash.
try { var m = localStorage.getItem('hub.theme'); if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-theme', m); } catch (e) { /* ignore */ }
