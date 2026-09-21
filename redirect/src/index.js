/* lint.uz — the old domain, kept alive as a redirect.
   Every host and path maps to its lint.one equivalent, so links people have
   already shared or bookmarked keep working and search engines move their
   ranking across rather than splitting it. */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    /* json.lint.uz -> json.lint.one, www.lint.uz -> lint.one, lint.uz -> lint.one */
    const host = url.hostname.replace(/^www\./, '');
    const target = host.endsWith('.lint.uz')
      ? host.slice(0, -'.lint.uz'.length) + '.lint.one'
      : 'lint.one';

    /* A path beginning with // (or a backslash, which browsers fold to /) is
       read as protocol-relative, so "lint.uz//evil.com" would resolve to
       evil.com — an open redirect wearing a trusted domain. Collapse any
       leading slashes to exactly one before resolving. */
    const path = '/' + url.pathname.replace(/^[/\\]+/, '');

    const to = new URL(path + url.search + url.hash, 'https://' + target);
    /* belt and braces: never leave the new domain */
    if (to.hostname !== target) return Response.redirect('https://' + target + '/', 301);
    return Response.redirect(to.toString(), 301);
  }
};
