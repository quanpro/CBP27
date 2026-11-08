// YouTube episodes play inside the Hub (docs/js/video.js): a YouTube link pasted in Episodes.blink_url
// or embed_url becomes the privacy-enhanced youtube-nocookie.com player in the course page.
import { test, expect } from './helpers/hub.mjs';

const YT_HOST = 'www.youtube-nocookie.com';

test.describe('YouTube episodes', () => {
  test('links are turned into embed URLs, other links are left alone', async ({ hub }) => {
    const { page } = hub;
    await hub.goto('index.html');
    const got = await page.evaluate(async () => {
      const v = await import(`${location.origin}/js/video.js`);
      const cases = [
        'https://www.youtube.com/watch?v=AbCdEfGhIj1',
        'https://youtu.be/AbCdEfGhIj1?t=75',
        'https://youtu.be/AbCdEfGhIj1?si=share123',
        'https://m.youtube.com/watch?v=AbCdEfGhIj1&t=1m15s',
        'https://www.youtube.com/watch?v=AbCdEfGhIj1&list=PLabcdefghij1234',
        'https://www.youtube.com/shorts/AbCdEfGhIj1',
        'https://www.youtube.com/embed/AbCdEfGhIj1',
        'https://www.youtube.com/playlist?list=PLabcdefghij1234',
        ' https://youtu.be/AbCdEfGhIj1 ',
        'http://youtu.be/AbCdEfGhIj1',
        'https://youtu.be/short',
        'https://www.youtube.com/watch?v=AbCdEf"><x',
        'https://notyoutube.com/watch?v=AbCdEfGhIj1',
        'https://blink.example/ep1',
        '',
        null,
      ];
      return {
        embed: cases.map((c) => v.youTubeEmbed(c)),
        player: [
          v.playerSrc('', 'https://youtu.be/AbCdEfGhIj1'),
          v.playerSrc('https://player.example/e/1', 'https://blink.example/ep1'),
          v.playerSrc('', 'https://blink.example/ep1'),
          v.playerSrc('javascript:alert(1)', ''),
        ],
        isYt: [v.isYouTube('https://youtu.be/x'), v.isYouTube('https://blink.example/x'), v.isYouTube('https://evil.com/youtube.com')],
      };
    });
    const E = 'https://www.youtube-nocookie.com/embed/AbCdEfGhIj1?';
    expect(got.embed).toEqual([
      `${E}rel=0&playsinline=1`,
      `${E}start=75&rel=0&playsinline=1`,
      `${E}rel=0&playsinline=1`,
      `${E}start=75&rel=0&playsinline=1`,
      `${E}list=PLabcdefghij1234&rel=0&playsinline=1`,
      `${E}rel=0&playsinline=1`,
      `${E}rel=0&playsinline=1`,
      'https://www.youtube-nocookie.com/embed/videoseries?list=PLabcdefghij1234&rel=0&playsinline=1',
      `${E}rel=0&playsinline=1`,
      '', '', '', '', '', '', '',
    ]);
    expect(got.player).toEqual([`${E}rel=0&playsinline=1`, 'https://player.example/e/1', '', '']);
    expect(got.isYt).toEqual([true, false, false]);
  });

  test('a YouTube link in the Sheet plays in the course page, not in a new tab', async ({ hub }) => {
    test.skip(!hub.isMock, 'the demo data is patched in flight; the real fixtures carry no video links');
    const { page } = hub;
    // Give every demo episode a YouTube link (ep 0–9 → 11-character ids), as if pasted in Episodes.blink_url.
    const EP_DECL = "blink_url: '', embed_url: ''";
    await page.route('**/js/mock-api.js', async (route) => {
      const resp = await route.fetch();
      const src = await resp.text();
      if (!src.includes(EP_DECL)) throw new Error('mock-api.js: episode links not found; update tests/e2e/video.spec.mjs');
      await route.fulfill({ response: resp, body: src.replace(EP_DECL, "blink_url: `https://www.youtube.com/watch?v=AbCdEfGhIj${ep}&t=75`, embed_url: ''") });
    });
    // The player itself is not fetched from YouTube in tests: an empty page stands in for it.
    await page.route(`https://${YT_HOST}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>' }));

    await hub.signIn(hub.account('shell'));
    await hub.goto('course.html?c=P1');
    const frame = page.locator('.player iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/AbCdEfGhIj\d\?start=75&rel=0&playsinline=1$/);
    await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin');
    await expect(frame).toHaveAttribute('allowfullscreen', '');
    const sandbox = (await frame.getAttribute('sandbox')).split(/\s+/);
    expect(sandbox).not.toContain('allow-top-navigation');
    await expect(page.locator('.player .poster')).toHaveCount(0);

    // Another episode swaps the video in the same place.
    const first = await frame.getAttribute('src');
    await page.locator('.ep-open').nth(1).click();
    await expect(frame).not.toHaveAttribute('src', first);
    await expect(frame).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/AbCdEfGhIj\d\?start=75/);

    // The stand-in player is the only off-site request, and it went to the privacy-enhanced host.
    const off = hub.requests.filter((u) => /^https?:/.test(u) && !u.startsWith(new URL(page.url()).origin) && !/fonts\.(googleapis|gstatic)\.com/.test(u));
    expect(off.length).toBeGreaterThan(0);
    for (const u of off) expect(new URL(u).host).toBe(YT_HOST);
    hub.requests = hub.requests.filter((u) => !u.startsWith(`https://${YT_HOST}/`));
  });
});
