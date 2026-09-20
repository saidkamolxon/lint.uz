/* lint.uz — the landing worker.
   Its only job beyond serving the page is to send /json and friends to the
   subdomain that actually hosts each tool, so a shortened URL someone types
   or remembers still lands in the right place. */

const TOOLS = {
  json: 'https://json.lint.uz/',
  xml: 'https://xml.lint.uz/',
  yaml: 'https://yaml.lint.uz/',
  csv: 'https://csv.lint.uz/',
  pdf: 'https://pdf.lint.uz/'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* one trailing slash and any capitalisation should behave the same */
    const name = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    const target = TOOLS[name];

    if (target) {
      /* carry the query string through — nothing uses one today, but a link
         someone shares with ?theme= or similar should not lose it */
      const to = new URL(target);
      to.search = url.search;
      return Response.redirect(to.toString(), 301);
    }

    /* everything else is the landing page and its assets */
    return env.ASSETS.fetch(request);
  }
};
