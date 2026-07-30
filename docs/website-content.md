# Website content

Website assets are configuration records. They are not uploaded or downloadable media.

A website plays fullscreen as a playlist item with a fixed duration. It uses the existing assignment, group, schedule, and precedence systems.

Website pages do not operate offline. Downloaded images and videos continue to play when a website is not available.

## URL and navigation policy

HTTPS is required by default. `TILECAST_WEBSITE_ALLOW_PRIVATE_HTTP=true` permits HTTP for these destinations:

- Literal private addresses
- Loopback addresses
- Link-local addresses
- `localhost`
- `.local` hosts

Tilecast does not change the configured URL scheme. Tilecast rejects credentials, invalid hosts, non-HTTP schemes, and nonstandard ports.

The original host is always permitted for top-level navigation. Additional entries must be exact hosts.

Tilecast does not support wildcards. Tilecast blocks invalid redirects and top-level navigation.

A target is invalid if it changes the scheme or uses an unapproved host. Credentials and nonstandard ports are also invalid.

This control does not intercept all requests. An approved page can load third-party resources through normal Android WebView behavior.

## WebView security and data

Tilecast Player disables these WebView functions:

- File and content access
- File URL privileges
- Mixed content
- Geolocation
- Popups and downloads
- File selectors
- External schemes
- Permission grants
- Native JavaScript bridges
- Certificate bypasses
- Release WebView debugging

Tilecast enables Safe Browsing when the installed WebView supports it. A TLS error always stops the load.

JavaScript and DOM storage settings apply to each asset. Cookies can be disabled, first-party, or first-party and third-party.

Android WebView shares cookies and DOM storage in the Tilecast Player application. Tilecast does not supply separate browser profiles for each asset.

Do not use cookies as credential storage. Tilecast does not support website authentication or administrator-supplied cookies.

Tilecast also does not support OAuth imports, session imports, or JavaScript interfaces.

Owners and Administrators can send a clear-data command from the screen details. The command expires after ten minutes.

The command removes cookies, HTTP cache, DOM storage, history, and temporary WebView state. A complete player reset also removes website data.

## Reliability and offline behavior

Each website playlist item requires an explicit duration. Tilecast reports a category for each load failure.

Failure categories include DNS, connection, TLS, HTTP, redirect, timeout, and renderer errors. Reports do not contain raw URLs or page content.

Configure one of these failure responses:

- Keep the previous page.
- Show the Tilecast placeholder.
- Show a verified fallback image.
- Skip the item.

A failure cannot remove the playlist time limit.

Fallback images must have the ready state. Manifest v3 contains their playback variants.

The player downloads fallback images before activation. Normal cache rules protect them.

Tilecast does not use the WebView HTTP cache as offline content.

Fire TV devices can have older WebView versions than Google TV devices. Tilecast uses platform APIs that are available from API 23.

Tilecast shows a safe placeholder or fallback image when a WebView function is not available.

Test each target combination of Fire OS and WebView on a physical device.
