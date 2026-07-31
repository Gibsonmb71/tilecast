# Content review and the Contributor role

Approvals already exist for Forms records. This is the other half: a student
club, a branch librarian, or a volunteer can build content, and somebody checks
it before it reaches a hallway.

Both parts are off or unused until you choose them. An installation that
upgrades keeps working exactly as before.

## The Contributor role

A Contributor creates and edits content: media, Widgets, Data Sources,
playlists, Layout drafts, folders, collections, and tags.

A Contributor cannot:

- publish a Layout
- delete content
- assign anything to a screen
- reach screens, groups, schedules, takeovers, commands, settings, or users
- approve content, including their own

Assignment has always been Owner and Administrator only, so the boundary that
matters for a Contributor is publish and delete.

| Role          | Creates content | Publishes and deletes | Operates screens | Reviews |
| ------------- | --------------- | --------------------- | ---------------- | ------- |
| Owner         | Yes             | Yes                   | Yes              | Yes     |
| Administrator | Yes             | Yes                   | Yes              | Yes     |
| Editor        | Yes             | Yes                   | Yes              | Yes     |
| Contributor   | Yes             | No                    | No               | No      |
| Viewer        | No              | No                    | No               | No      |

## Review

Turn on **Require approval before content reaches a screen** under
**Settings**, **Content review**.

With it on, a playlist or a published Layout must be approved at its current
revision before it can be assigned to a screen. Assignment refuses with
`content_not_approved` until it is.

**There is no submit step.** Content is waiting for review whenever its current
revision has no decision:

- pending: the current revision has no decision
- approved: a decision of approved exists for exactly this revision
- sent back: a decision of rejected exists for exactly this revision

Editing content bumps its revision, so **editing approved content sends it back
for review by itself**. That is the point of the design: a workflow with an
explicit submit step has to be kept in step with every edit path, and the first
path that forgot would let unreviewed content onto a screen while still reading
as approved.

Reviewing is the same for a new playlist and for an edit to one that is already
on forty screens. The queue lists the number of screens each item is already on,
because that is the difference that matters.

## Reviewing

**Content review** in the main navigation lists the queue. An Owner,
Administrator, or Editor approves or sends back. A Contributor sees the queue
and where their work stands, but no decision controls.

A rejection needs a note. A rejection with no reason leaves the author with
nothing to act on, so it is refused.

Approving again after a rejection replaces the decision for that revision. There
is no third state to get stuck in.

A decision carries the revision the reviewer was looking at. If the content
changed while the review was open, the decision is refused and the reviewer is
told to look again, so an approval can never land on a revision nobody read.

## Where the check happens

The gate is in the assignment path in the server, not in Studio. Single
assignment, sync group assignment, bulk changes, and anything added later all
pass through it.

The check runs inside the transaction that writes the assignment, and it holds
the content against an edit until that transaction commits. An edit that arrives
during an assignment waits for it, and then bumps the revision as any edit does.
Without that, an assignment approved at one revision could commit after the
content had already changed.

Bulk changes check it during the preview, so unreviewed content is refused once
by name rather than failing separately on every screen in the selection. The
preview takes no lock, because it writes nothing; the apply that follows goes
through the assignment path and is checked again there.

## Known limitations

- Only playlists and published Layouts are reviewed. Media, Widgets, and Data
  Sources are reviewed through the playlist or Layout that carries them.
- An unpublished Layout draft is not in the queue. It cannot reach a screen, so
  there is nothing to decide yet.
- Approval does not apply to a Takeover, which is an emergency path by design.
- There is no per-reviewer routing. Anyone who can review can review anything.
- A Contributor cannot delete their own draft. Ask an Editor.
