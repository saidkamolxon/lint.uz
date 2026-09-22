/* Everything that is not lint.one itself redirects to a path on it.

   That covers the old domain (lint.uz and its subdomains) and the lint.one
   subdomains that were live briefly before the tools moved to paths. Paths
   are canonical because a search engine pools a domain's authority across
   them, where subdomains split it. */

const TOOLS = ['json', 'xml', 'yaml', 'csv', 'pdf', 'log'];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname.replace(/^www\./, '');

    /* json.lint.uz and json.lint.one both mean lint.one/json. A subdomain we
       do not serve — 3js.lint.one, say — is someone guessing at a tool, so
       send them to that path: lint.one answers it with the waitlist page. */
    const label = host.split('.')[0];
    const looksLikeFormat = /^(?=.*[a-z])[a-z0-9]{1,12}$/.test(label);
    const tool = (TOOLS.includes(label) || (looksLikeFormat && host !== 'lint.one'
                  && host !== 'lint.uz')) ? '/' + label : '';

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
