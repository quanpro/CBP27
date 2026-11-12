// Runs before first paint (classic script).
// 1. Frame-busting: GitHub Pages cannot send frame-ancestors, so the Hub refuses to run inside another site's frame.
if (window.top !== window.self) {
  try { window.top.location.replace(window.location.href); } catch (e) { document.documentElement.style.display = 'none'; }
}
// 2. Apply the saved light/dark choice so it does not flash.
try { var m = localStorage.getItem('hub.theme'); if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-theme', m); } catch (e) { /* ignore */ }
// 3. Ask for the strings of the saved language and the course list now, alongside the scripts (they
//    are needed before anything can be drawn; without this they wait until the scripts have run).
try {
  var lang = localStorage.getItem('hub.lang') === 'vi' ? 'vi' : 'en';
  ['i18n/' + lang + '.json', 'data/courses.json'].forEach(function (href) {
    var l = document.createElement('link');
    l.rel = 'preload'; l.as = 'fetch'; l.crossOrigin = 'anonymous'; l.href = href;
    document.head.appendChild(l);
  });
} catch (e) { /* the page fetches them itself */ }
