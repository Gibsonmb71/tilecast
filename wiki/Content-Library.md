# Content Library

The Content library holds uploaded media and reusable Sources. Playlist items reference library entries, so one asset or Source can be reused across many playlists.

Owners, Administrators, and Editors can manage content. Viewers can inspect it.

## Uploaded media

Open **Content → Add content → Upload media**.

Supported selections in Studio include:

- JPEG
- PNG
- WebP
- GIF
- MP4
- QuickTime/MOV
- WebM
- Matroska/MKV

Uploads are resumable. Studio sends files in chunks and keeps incomplete upload information in the browser. To resume after a failure, select the original file with the same name and size.

## Processing states

| State      | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| Uploading  | Browser is sending file data                                         |
| Uploaded   | Transfer finished                                                    |
| Waiting    | A media job is queued                                                |
| Inspecting | Tilecast is identifying the file and reading trusted metadata        |
| Processing | A compatible playback variant or thumbnail is being created          |
| Ready      | The item can be added to playlists                                   |
| Failed     | Processing failed. Open the item to see the reason and retry option. |

Tilecast stores media under generated identifiers. The uploaded filename is metadata and never controls a filesystem path.

For video, Tilecast may reuse a compatible original, remux it, or transcode it. The default compatibility ceiling is H.264/AAC MP4 up to 1920×1080 and 60 fps, subject to deployment limits.

## Website Sources

Choose **Add content → Create source → Website**.

Website Sources are intended for public pages such as dashboards, calendars, menus, and status pages.

Common settings:

- HTTPS URL
- reload once, on each activation, or at an interval
- load timeout
- failure behavior
- fallback image
- allowed top-level hosts
- JavaScript and DOM storage
- cookie policy
- zoom and scroll position
- custom user agent
- background color

Public HTTP is rejected. Private-network HTTP requires the server administrator to enable `TILECAST_WEBSITE_ALLOW_PRIVATE_HTTP=true`.

The allowed-host list restricts top-level navigation. It is not a request-interception proxy and does not claim to block every third-party subresource.

Tilecast does not store website usernames, passwords, cookies supplied by an administrator, or other authenticated-site credentials.

### Website failure behavior

A Website Source can:

- show a Tilecast placeholder
- keep the last successfully rendered page
- show a selected fallback image
- skip the playlist item

Choose a failure mode that is safe for the display's purpose. A fallback image is usually better than a blank screen for operational signage.

## YouTube Sources

Choose **Add content → Create source → YouTube**.

Paste a YouTube video or playlist URL. No YouTube Data API key is required.

Available controls include:

- start and optional end time
- loop
- mute and volume
- captions and caption language
- embedded controls
- play until the video ends or use a fixed duration
- placeholder, fallback image, or skip on failure

YouTube content plays through the embedded IFrame player and requires network access. It is streamed rather than cached as a media file.

## Edit, duplicate, and delete

Open a content item to edit its name or description. Sources can also be duplicated.

Before deleting a Source, check its playlist usage count. Removing content referenced by a playlist can make that playlist incomplete or invalid.

## Delivery policy

Delivery is selected per playlist item:

- **Download**: prepare and verify the media in the local cache before activation.
- **Stream**: read it while playing.
- **Automatic**: let Player policy choose for uploaded media.
- Sources use **Stream**.

Download is the normal choice for reliable offline playback. Streaming reduces local storage use but depends on the network.
