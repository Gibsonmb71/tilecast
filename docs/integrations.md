# Integration tokens

A school's lunch menu, sports scores, and bell times already live in another
system. An integration token lets that system write them into Tilecast, and lets
existing monitoring read fleet health, without anyone sharing a Studio password.

Only the Owner creates or revokes a token. A token cannot create another token.

## What a token can do

The capability set is closed and short, in the same spirit as the fixed player
command set. There is no scope that reaches general administration, creates or
deletes content, or touches screens.

| Capability          | What it permits                                        |
| ------------------- | ------------------------------------------------------ |
| `data_source:write` | Replace the rows of a Manual Table Data Source         |
| `activity:read`     | Read fleet health counts as JSON or Prometheus metrics |

A write token cannot create a Data Source, delete one, or change its columns.
Columns are what Widgets bind to, so changing them is a decision for a person in
Studio.

Limit a write token to named Data Sources when you create it. Selecting none
allows every Manual Table source; naming them is safer.

## Authentication

Send the token as a bearer token:

```
Authorization: Bearer tci_<public-id>.<secret>
```

The public part selects the record. The secret is compared against its SHA-256
hash in constant time. Tilecast never stores the secret, so a disclosed backup
cannot be turned into a working token.

Tilecast shows the token one time, when you create it. No endpoint reads it back.
Copy it then.

Every authentication failure returns the same `401 invalid_token`. A revoked
token is not distinguishable from an unknown one.

A token is attributed to the account that created it. Everything the token does
is recorded against that person and the token, so a change always
has a person behind it. **Removing that account stops the token working.** This
is deliberate: a token must not outlive everybody who knows why it exists.

Revoking is permanent. There is no un-revoke; replace the token instead.

## Expiry

Set **Expires on** when you create a token and it stops working at the end of
that day. Leave it empty for a token with no expiry.

An expiry is worth setting for anything short-lived: a vendor doing an
installation, a pilot, a script somebody is trying out. It is the difference
between a token that stops on its own and one that keeps working until somebody
remembers it exists.

The token list says **Active**, **Expired**, or **Revoked**, and shows the expiry
date. Expired and revoked are different answers on purpose: one is a date that
passed, the other is a decision somebody made. Both answer `401 invalid_token` to
the caller, which learns nothing about which it was.

## Write rows to a Manual Table Data Source

```
PUT /api/v1/integration/data-sources/{id}/rows
Authorization: Bearer tci_<public-id>.<secret>
Content-Type: application/json

{
  "rows": [
    { "values": { "item": "Chicken sandwich", "price": "3.50" } },
    { "values": { "item": "Garden salad", "price": "2.75" } }
  ]
}
```

This replaces every row. Send `"rows": []` to clear them. A missing `rows` field
is rejected, so a malformed request cannot empty a board by accident.

Keys must match columns the Data Source already declares. A key that does not is
rejected with `422 rows_invalid`, naming the row and the key, so a renamed column
upstream fails loudly instead of writing rows no Widget can display.

No more than 500 rows in one write.

The write goes through the same path as a Studio edit, so the cached player
payload, the audit entry, and the Widgets bound to the source are all updated the
same way.

## Read fleet health

```
GET /api/v1/integration/activity/fleet
GET /api/v1/integration/metrics
```

The first returns JSON. The second returns Prometheus text, so an installation
that already runs Prometheus needs no shim.

Both report the same counts:

- screens by reporting state: recent, stale, offline, disabled
- unresolved incidents, by severity
- content problems: stale Data Sources and playlists with nothing to play

**There is no "online" count.** Live presence lives in the server process that
holds the player socket, which these reads cannot see. `recent` means the screen
contacted the server within the last two minutes. Studio remains the authority on
per-screen status.

These endpoints are counts, not a report. Anything needing per-screen detail,
history, or proof of play belongs in [Activity](activity.md), where the metric
definitions are documented and load-bearing.

## Known limitations

- One token cannot be scoped to a subset of screens. Screen-level scoping does
  not exist yet.
- There is no read endpoint for content, playlists, or media. A token cannot
  enumerate the library.
- A token cannot mint, list, or revoke another token.
- Tokens are organization-wide, like everything else in an installation.
