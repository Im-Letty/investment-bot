# Shared user profile
The hamburger menu contains one profile editor: a public display username (20 Unicode characters), an optional preset or album icon and a self-introduction (160 characters). The existing login email is read-only and private. Provider names and email addresses never become public usernames automatically.

Registered accounts save only the kn_profile_v1 metadata namespace. The same-origin self-profile endpoint uses one frozen caller bearer token for verification and the self-user update; no target account ID is accepted. Guest chat names keep the existing encrypted cm_nick setting in this browser. Guest icon/bio are browser-local public profile preferences, not private contact records.

Both chat composers and replies read the committed shared username. Failed or unsaved edits do not replace it. Chat retry IDs retain the original name and account, and an account switch before transport cancels the write. Existing chat names stay as posted.

New Shorts reservations snapshot only the verified owner's explicit username into nullable author_name. Existing posts remain unnamed, and unknown-outcome retries return their original reservation/name. The API exposes only that public name; email, profile metadata, owner IDs, storage paths and authentication values remain excluded. The frontend requires a saved name before a new upload. Same-owner profile refreshes preserve the selected video and caption; actual account changes clear them.

Install migrations/20261022_shorts_author_profile.sql once on the existing project. Its revision guard refuses an unexpected existing function body, and the RPC retains its service-only grants, owner checks, quotas and private bucket. No existing post is backfilled or renamed.

Album images are prepared locally as square JPEG previews before Save (10 MiB input limit, 40-million-pixel decode limit, at most 256 × 256 pixels and 48 KiB after normalization). Cancelling restores the committed profile. Choosing a preset or the standard reset removes a photo only when saved. Unsupported image formats leave the prior photo intact.

For account photo persistence, install migrations/20261022_profile_avatars.sql on the existing project. It creates or checks the private website-profile-avatars bucket and blocks browser Storage access to that bucket. The backend verifies the caller, constructs the owner-bound path and exposes only that owner's current image through /api/user-profile/avatar. Metadata stores a content reference, not image bytes; guest photos remain browser-local. Photo bytes, references and paths are excluded from chat/post events. Existing text-only profile saves preserve a committed photo.
