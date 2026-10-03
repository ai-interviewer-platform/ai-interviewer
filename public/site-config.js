// Which Site collection kinds are collecting, fetched once per page and shared by
// every caller. Resolves null when the configuration cannot be reached.
let config;
export function siteConfig() {
  config ??= fetch('/api/site-config').then(response => response.json()).catch(() => null);
  return config;
}
