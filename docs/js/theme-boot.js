// Runs before first paint (classic script) so dark/light choice does not flash.
try { var m = localStorage.getItem('hub.theme'); if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-theme', m); } catch (e) { /* ignore */ }
