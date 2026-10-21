# Shared user profile
The hamburger menu contains one profile editor: a public display username (20 Unicode characters), an optional preset icon and a self-introduction (160 characters). The existing login email is read-only and private. Provider names and email addresses never become public usernames automatically.

Registered accounts save only the kn_profile_v1 metadata namespace. The same-origin self-profile endpoint uses one frozen caller bearer token for verification and the self-user update; no target account ID is accepted. Guest chat names keep the existing encrypted cm_nick setting in this browser. Guest icon/bio are browser-local public profile preferences, not private contact records.

Both chat composers and replies read the committed shared username. Failed or unsaved edits do not replace it. Chat retry IDs retain the original name and account, and an account switch before transport cancels the write. Existing chat names stay as posted.

New Shorts reservations snapshot only the verified owner's explicit username into nullable author_name. Existing posts remain unnamed, and unknown-outcome retries return their original reservation/name. The API exposes only that public name; email, profile metadata, owner IDs, storage paths and authentication values remain excluded. The frontend requires a saved name before a new upload. Same-owner profile refreshes preserve the selected video and caption; actual account changes clear them.

Install migrations/20261022_shorts_author_profile.sql once on the existing project. Its revision guard refuses an unexpected existing function body, and the RPC retains its service-only grants, owner checks, quotas and private bucket. No existing post is backfilled or renamed.
