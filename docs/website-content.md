# Website content

Website assets are configuration records, not uploaded or downloadable media. They play fullscreen as duration-bounded playlist items and use the existing direct assignment, group, scheduling, and precedence systems. Website pages are not offline-capable; downloaded images and videos continue normally when a site is unavailable.

## URL and navigation policy

HTTPS is required by default. `TILECAST_WEBSITE_ALLOW_PRIVATE_HTTP=true` permits HTTP only for literal private, loopback, or link-local addresses, `localhost`, and `.local` hosts. Tilecast never upgrades or downgrades a configured URL silently. Embedded credentials, non-HTTP schemes, malformed hosts, and nonstandard ports are rejected.

The original host is always allowed for top-level navigation. Additional entries are exact hosts—wildcards are unsupported. Redirects and top-level navigation to another scheme, host, embedded credential, or nonstandard port are blocked. This is not complete request interception: an allowed page may load third-party scripts, styles, fonts, images, media, or API requests under normal Android WebView behavior.

## WebView security and data

Tilecast Player disables file/content access, file-URL privileges, mixed content, geolocation, popups, downloads, file choosers, external schemes, permission grants, native JavaScript bridges, certificate bypasses, and release WebView debugging. Safe Browsing is enabled where the installed WebView/API supports it. TLS errors are always fatal.

JavaScript and DOM storage are per asset. Cookies can be disabled, first-party, or first-and-third-party. Android WebView cookie and DOM storage are shared within the Tilecast Player application; Tilecast does not claim per-asset browser profiles, and cookies are not credential storage. Website authentication, administrator-supplied cookies, OAuth/session imports, and JavaScript interfaces are unsupported.

Owners and Administrators can queue a clear-data command from screen details. It expires after ten minutes and clears cookies, HTTP cache, DOM storage, history, and temporary WebView state when delivered. A complete player reset also clears website data.

## Reliability and offline behavior

Every website playlist item requires an explicit duration. Load failures, DNS/connection/TLS errors, HTTP errors, blocked redirects, timeouts, and renderer termination produce categorized status without raw URLs or page content. The configured response is to retain a previously rendered page, show Tilecast's placeholder, show a verified downloaded fallback image, or skip the item. No failure can make the playlist timer unbounded.

Fallback images must be ready images. Their playback variants are included in manifest v3, downloaded before activation, and protected by normal cache rules. WebView's incidental HTTP cache is not supported as offline content.

Fire TV devices can ship older WebView versions than Google TV. Tilecast uses platform APIs available from API 23 and falls back to the safe placeholder or fallback image when a WebView capability or renderer is unavailable. Physical-device validation remains necessary for the target Fire OS/WebView combination.
