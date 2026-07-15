# Layout schema

This package owns the future renderer-neutral, versioned layout contract. Layouts use generic placements rather than a bespoke element type for every signage feature:

- `app`: stable reference to a reusable configured App/Source Content item
- `asset`: stable reference to an uploaded image or video
- `playlistZone`: reference to an existing playlist and zone playback settings
- `primitive`: static text, shape, line, decorative image, or group

Every placement carries bounded geometry, layer, opacity, visibility, and only type-approved display overrides. Shared App configuration and fetched structured data are not copied into layout revisions. Data bindings reference a Source plus a validated field path; they are not executable templates, HTML, CSS, JavaScript, or arbitrary expressions.

See `docs/apps-and-layouts.md` for the ownership and compatibility contract that layout schema versions must preserve.

`schema-v1.json` is the first published contract. Server and Player validators enforce the same hard limits in code before accepting or activating a document.
