/* Everything that is not lint.one itself redirects to a path on it: the old
   domain, and any subdomain of either. Paths are canonical because a search
   engine pools a domain's authority across them, where subdomains split it.

   This worker only rewrites the address. Whether a path is a tool, a format
   worth a waitlist, or nothing at all is decided by the site worker, so both
   ways of guessing give the same answer. */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname.replace(/^www\./, '');

    /* Every subdomain becomes the matching path: json.lint.uz is lint.one/json,
       and anything.lint.one is lint.one/anything. What that path means is not
       decided here — lint.one answers a format-looking name with a waitlist
       and everything else with a plain not-found. Keeping that judgement in
       one place means the two ways of guessing agree. */
    const isApex = host === 'lint.one' || host === 'lint.uz';
    const label = isApex ? '' : host.split('.')[0];
    const tool = label ? '/' + encodeURIComponent(label) : '';

    /* A path starting // (or a backslash, which browsers fold to /) parses as
       protocol-relative: "lint.uz//evil.com" would send visitors to evil.com,
       an open redirect wearing a trusted domain. Collapse leading slashes. */
    const path = '/' + url.pathname.replace(/^[/\\]+/, '');

    /* on a tool subdomain the path is already inside that tool, so keep both:
       pdf.lint.uz/vendor/x.mjs -> lint.one/pdf/vendor/x.mjs */
    const target = tool + (path === '/' ? '/' : path);

    const to = new URL(target + url.search + url.hash, 'https://lint.one');
    if (to.hostname !== 'lint.one') return Response.redirect('https://lint.one/', 301);
    return Response.redirect(to.toString(), 301);
  }
};
