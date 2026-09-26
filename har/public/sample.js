/* The sample: a shop's page loading, as Chrome would save it. It has a
   login that sets a cookie and returns a token, calls made with that token,
   an API key in a URL, a failing request and a missing image, so the list,
   the details and the secrets all have something to show. The tokens are
   made up. Loaded only when "Load a sample" is asked for. */
(function (global) {
  'use strict';

  function makeSampleHar(now) {
    var t0 = (now || Date.now()) - 60000;
    var JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsIm5hbWUiOiJEaWxub3phIiwiZXhwIjoxOTAwMDAwMDAwfQ.c2FtcGxlLXNpZ25hdHVyZS1ub3QtcmVhbA';
    var SESSION = 'sess_8f3a91c2d7e64b0a9c1f';
    var entries = [];

    function h(obj) {
      return Object.keys(obj).map(function (k) { return { name: k, value: String(obj[k]) }; });
    }
    function add(o) {
      var start = t0 + o.at;
      var wait = o.wait || 20, recv = o.recv || 4;
      var text = o.body === undefined ? '' : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body));
      var size = o.size || text.length;
      var reqHeaders = {
        ':authority': 'shop.example', ':method': o.method || 'GET', ':path': o.path, ':scheme': 'https',
        'accept': o.accept || '*/*', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
      };
      if (o.auth) reqHeaders.authorization = 'Bearer ' + JWT;
      if (o.cookie) reqHeaders.cookie = 'session=' + SESSION + '; theme=dark';
      if (o.post) reqHeaders['content-type'] = o.postMime || 'application/json';
      var url = (o.host ? 'https://' + o.host : 'https://shop.example') + o.path;
      var q = [];
      try { new URL(url).searchParams.forEach(function (v, k) { q.push({ name: k, value: v }); }); } catch (e) {}
      var resHeaders = { 'content-type': o.mime, 'content-length': size, 'date': new Date(start).toUTCString(), 'server': 'nginx' };
      if (o.setCookie) resHeaders['set-cookie'] = 'session=' + SESSION + '; Path=/; HttpOnly; Secure; SameSite=Lax';
      if (o.cache) resHeaders['cache-control'] = o.cache;
      var e = {
        _initiator: o.initiator || { type: 'parser', url: 'https://shop.example/', lineNumber: 12 },
        _priority: o.priority || 'High',
        _resourceType: o.type,
        cache: {},
        connection: '443',
        pageref: 'page_1',
        request: {
          method: o.method || 'GET', url: url, httpVersion: 'http/2.0',
          headers: h(reqHeaders), queryString: q,
          cookies: o.cookie ? [{ name: 'session', value: SESSION }, { name: 'theme', value: 'dark' }] : [],
          headersSize: -1, bodySize: o.post ? JSON.stringify(o.post).length : 0
        },
        response: {
          status: o.status || 200, statusText: o.statusText || '', httpVersion: 'http/2.0',
          headers: h(resHeaders),
          cookies: o.setCookie ? [{ name: 'session', value: SESSION, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }] : [],
          content: { size: size, mimeType: o.mime },
          redirectURL: '', headersSize: -1, bodySize: -1, _transferSize: o.transfer || Math.round(size * 0.35) + 180, _error: null
        },
        serverIPAddress: o.host && o.host !== 'shop.example' ? '203.0.113.' + (10 + entries.length) : '198.51.100.7',
        startedDateTime: new Date(start).toISOString(),
        time: 0,
        timings: {
          blocked: o.blocked || 1.2, dns: o.dns == null ? -1 : o.dns, ssl: o.ssl == null ? -1 : o.ssl,
          connect: o.connect == null ? -1 : o.connect, send: 0.2, wait: wait, receive: recv, _blocked_queueing: 0.8
        }
      };
      if (text && o.keepBody !== false) e.response.content.text = text;
      if (o.base64) { e.response.content.text = o.base64; e.response.content.encoding = 'base64'; }
      if (o.post) e.request.postData = { mimeType: o.postMime || 'application/json', text: typeof o.post === 'string' ? o.post : JSON.stringify(o.post) };
      var t = e.timings;
      e.time = [t.blocked, t.dns, t.connect, t.send, t.wait, t.receive].reduce(function (s, x) { return s + (x > 0 ? x : 0); }, 0);
      entries.push(e);
      return e;
    }
    var js = function (line) { return { type: 'script', stack: { callFrames: [{ functionName: 'request', scriptId: '1', url: 'https://shop.example/assets/app.4f2c.js', lineNumber: line, columnNumber: 18 }] } }; };

    var PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAAAK0lEQVR42mN4+/IfQcQAVb1FQ0SqMIAKMFUgqwBVZWMFrM+AgDOFMMnbSyZ4gADLz1sAAAAASUVORK5CYII=';

    add({ at: 0, path: '/', type: 'document', mime: 'text/html', accept: 'text/html', dns: 12, connect: 38, ssl: 22, wait: 84, recv: 6, priority: 'VeryHigh', initiator: { type: 'other' },
          body: '<!doctype html><html><head><title>Shop</title><link rel="stylesheet" href="/assets/app.9b1e.css"></head><body><div id="app"></div><script src="/assets/app.4f2c.js"></script></body></html>', cookie: true });
    add({ at: 140, path: '/assets/app.9b1e.css', type: 'stylesheet', mime: 'text/css', wait: 18, recv: 9, size: 48213, cache: 'public, max-age=31536000, immutable', keepBody: false });
    add({ at: 141, path: '/assets/app.4f2c.js', type: 'script', mime: 'application/javascript', wait: 22, recv: 48, size: 412877, cache: 'public, max-age=31536000, immutable', keepBody: false });
    add({ at: 143, path: '/assets/vendor.77ad.js', type: 'script', mime: 'application/javascript', wait: 25, recv: 96, size: 903114, cache: 'public, max-age=31536000, immutable', keepBody: false });
    add({ at: 190, host: 'fonts.example-cdn.com', path: '/inter/v18/inter-latin-400.woff2', type: 'font', mime: 'font/woff2', dns: 9, connect: 31, ssl: 19, wait: 28, recv: 12, size: 48256, keepBody: false });
    add({ at: 192, host: 'fonts.example-cdn.com', path: '/inter/v18/inter-latin-600.woff2', type: 'font', mime: 'font/woff2', wait: 30, recv: 11, size: 49112, keepBody: false });
    add({ at: 330, path: '/api/session', method: 'POST', type: 'fetch', mime: 'application/json', wait: 212, recv: 2, initiator: js(1044),
          post: { email: 'dilnoza@example.uz', password: 'correct-horse-battery', remember: true },
          body: { user: { id: 42, name: 'Dilnoza Karimova', email: 'dilnoza@example.uz' }, access_token: JWT, refresh_token: 'rt_5b0d2e7a9c4f41e8b6a3', expires_in: 3600 },
          setCookie: true });
    add({ at: 560, path: '/api/me', type: 'fetch', mime: 'application/json', wait: 61, recv: 1, auth: true, cookie: true, initiator: js(1102),
          body: { id: 42, name: 'Dilnoza Karimova', email: 'dilnoza@example.uz', plan: 'pro', country: 'UZ' } });
    add({ at: 566, path: '/api/orders?page=1&limit=20', type: 'fetch', mime: 'application/json', wait: 148, recv: 5, auth: true, cookie: true, initiator: js(1180),
          body: { page: 1, total: 64, orders: [ { id: 1064, status: 'paid', total: 119.0, items: 2 }, { id: 1063, status: 'pending', total: 49.0, items: 1 }, { id: 1062, status: 'paid', total: 32.9, items: 3 } ] } });
    add({ at: 571, path: '/api/recommendations?for=42', type: 'fetch', mime: 'application/json', status: 500, statusText: 'Internal Server Error', wait: 2034, recv: 1, auth: true, cookie: true, initiator: js(1311),
          body: { error: 'upstream_timeout', message: 'The recommendation service did not answer within 2 s', request_id: 'req_01J8Z4K7QH' } });
    add({ at: 548, path: '/api/config', type: 'fetch', mime: 'application/json', wait: 38, recv: 1, cookie: true, initiator: js(980),
          body: { currency: 'USD', features: { reviews: true, wishlist: false } } });
    add({ at: 612, path: '/api/config', type: 'fetch', mime: 'application/json', wait: 35, recv: 1, cookie: true, initiator: js(2011),
          body: { currency: 'USD', features: { reviews: true, wishlist: false } } });
    add({ at: 640, path: '/img/banner/autumn-sale.jpg', type: 'image', mime: 'image/jpeg', wait: 41, recv: 386, size: 1482113, transfer: 1482390, cache: 'public, max-age=86400', keepBody: false, initiator: js(2190) });
    add({ at: 700, path: '/img/products/kb-75.webp', type: 'image', mime: 'image/webp', wait: 35, recv: 14, size: 38114, cache: 'public, max-age=86400', keepBody: false, initiator: js(2210) });
    add({ at: 702, path: '/img/products/ms-02.webp', type: 'image', mime: 'image/webp', wait: 33, recv: 11, size: 29502, cache: 'public, max-age=86400', keepBody: false, initiator: js(2210) });
    add({ at: 703, path: '/img/products/hb-7.webp', type: 'image', mime: 'image/webp', status: 404, statusText: 'Not Found', wait: 29, recv: 1, size: 146,
          body: '<html><body><h1>404 Not Found</h1></body></html>', initiator: js(2210) });
    add({ at: 705, path: '/img/avatar/42.png', type: 'image', mime: 'image/png', wait: 27, recv: 1, base64: PIXEL, size: 104, initiator: js(2244) });
    add({ at: 910, host: 'metrics.example-analytics.io', path: '/v1/collect?api_key=ak_live_7Hq2Lr9Xw3Nz5Kp8&event=page_view&page=%2F', type: 'ping', mime: 'text/plain',
          dns: 14, connect: 40, ssl: 25, wait: 52, recv: 0, size: 0, status: 204, statusText: 'No Content', initiator: js(3001) });
    add({ at: 1020, path: '/api/orders/1064', type: 'fetch', mime: 'application/json', wait: 58, recv: 1, auth: true, cookie: true, initiator: js(1244),
          body: { id: 1064, status: 'paid', total: 119.0, items: [{ sku: 'KB-75', qty: 1 }] } });
    add({ at: 1090, path: '/api/orders/1063', type: 'fetch', mime: 'application/json', wait: 61, recv: 1, auth: true, cookie: true, initiator: js(1244),
          body: { id: 1063, status: 'pending', total: 49.0, items: [{ sku: 'MS-02', qty: 1 }] } });
    add({ at: 1150, path: '/api/orders/1062', type: 'fetch', mime: 'application/json', status: 500, statusText: 'Internal Server Error', wait: 1320, recv: 1, auth: true, cookie: true, initiator: js(1244),
          body: { error: 'db_timeout', message: 'The order store did not answer', request_id: 'req_01J8Z4M2XB' } });
    add({ at: 1204, path: '/api/cart', method: 'PUT', type: 'fetch', mime: 'application/json', wait: 96, recv: 1, auth: true, cookie: true, initiator: js(1402),
          post: { items: [{ sku: 'KB-75', qty: 1 }, { sku: 'CB-2M', qty: 2 }] },
          body: { items: 2, subtotal: 143.0, currency: 'USD' } });
    add({ at: 1210, path: '/api/cart/coupon', method: 'POST', type: 'fetch', mime: 'application/json', status: 422, statusText: 'Unprocessable Entity', wait: 74, recv: 1, auth: true, cookie: true, initiator: js(1460),
          post: { code: 'AUTUMN10' },
          body: { error: 'coupon_expired', message: 'This coupon ended on 30 September' } });

    return {
      log: {
        version: '1.2',
        creator: { name: 'WebInspector', version: '537.36' },
        pages: [{ startedDateTime: new Date(t0).toISOString(), id: 'page_1', title: 'https://shop.example/',
                  pageTimings: { onContentLoad: 420, onLoad: 980 } }],
        entries: entries
      }
    };
  }

  global.makeSampleHar = makeSampleHar;
})(typeof self !== 'undefined' ? self : globalThis);
