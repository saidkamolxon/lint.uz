/* lint.one — one worker, every tool.

   The tools live at paths rather than subdomains because search engines pool
   a domain's authority across its paths and largely split it across
   subdomains. With six tools that meant six reputations starting from zero.

   Almost everything here is static assets; this worker exists only to be
   forgiving about how a path is typed. */

const TOOLS = ['json', 'xml', 'yaml', 'csv', 'pdf', 'log'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    /* /JSON and /json/ should both reach /json/ — one canonical spelling, so
       a search engine never sees the same tool under several URLs */
    const bare = path.replace(/^\/+|\/+$/g, '');
    if (bare && TOOLS.includes(bare.toLowerCase()) && path !== '/' + bare.toLowerCase() + '/') {
      return Response.redirect(
        url.origin + '/' + bare.toLowerCase() + '/' + url.search, 301);
    }

    return env.ASSETS.fetch(request);
  }
};
