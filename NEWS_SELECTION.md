# Website news selection

## Writer decision: Codex, same editorial policy (2026-10-07)

The owner selected **Codex signed in with ChatGPT** as the website's future
summary writer to reduce Claude API costs. This is a writer migration, not a
change to article selection, factual standards or final review requirements.
The local entry point is `codex_website_producer.generate_codex_website_edition`.
Its provider calls the same `isolated_news_producer` article and overview stages
with their complete existing instructions and frozen evidence. The internal
method name `claude()` is only a compatibility seam; this entry point makes no
Anthropic request and never falls back to an API writer.

The inherited policy is:

- Front overview: explain one verified lead story in about **200–300
  Japanese characters**. Opened details: one or two other distinct stories,
  each about **200–400**. Accuracy
  and readability take priority, with the existing 330/440 upper room; do not
  pad or repeatedly buy rewrites solely to reach the length target.
- Write clear, polite Japanese for a middle-school reader. Explain necessary
  unfamiliar terms, avoid difficult terms in the headline, and use only numbers
  needed to understand the event. The overview normally uses at most two
  numbers other than dates, not a target to fill.
- Keep each detail understandable on its own: identify its separate event and
  add useful source-backed explanation. Do not repeat the opening event.
- Preserve who did what, conditions, scope, units and degree of certainty.
  A plan, possibility or discussion is not a completed action. Do not invent
  daily-life effects or a future outlook when the source does not support them.
- Choose at most three suitable distinct topics; never manufacture topics on
  quiet days. Keep real announcement dates, source attribution, source-body
  hashes and the existing morning-window selection/release rules.

Gemini and OpenAI must independently check the **same final copy** against
the original verified bodies. The existing local checks and both fresh reviews
remain mandatory before publication. ChatGPT-authenticated Codex drafting uses
the subscription's Codex allowance; Gemini/OpenAI review requests still use
their separate APIs and can incur charges. An API-authenticated CLI is rejected
before drafting, and review keys are not passed to the Codex subprocess.

Subscription writing is capped at eight CLI attempts per edition, including
failures. Paid reviews retain Gemini's three-request and OpenAI's two-request
ceilings, at most five HTTP attempts combined. The same 12-minute overall
deadline applies. A stopped writer or failed review cannot publish a draft.

**Current boundary:** this is an undeployed migration candidate, not confirmation
of a production writer switch or a successful 08:00 release. In the candidate,
`website_news_execution.py` defaults to the external Codex writer role: Render
collects and freezes sources, reports `waiting_for_writer`, and consumes only a
reviewed durable edition. It never claims a generation attempt or invokes a
paid writer in that role. `NEWS_WEBSITE_WRITER=claude` is an explicit legacy
rollback setting, not an automatic fallback. The currently deployed server
has not received this wiring change and may still invoke its previous writer.

`scripts/run_codex_news.py` is the real-clock local worker. Its default invocation
only reports missing configuration names and CLI availability; it performs no
authentication, collection, generation or storage writes. Live operation needs
both `--run-live` and `--once` or `--serve`. **That live mode can publish** through
the private shared storage and is not the private rehearsal. It must only be
started after the private final-copy review and actual connection checks.
There are no simulated dates or force/upload options. Existing frozen bodies,
history and immutable claim records are shared with the server. By default the
local worker permits one durable generation attempt per day, including failed
attempts; restart does not reset that cap. That bounds an automatic day to at
most eight Codex CLI writing calls and five review HTTP requests. Raising the
cap is an explicit operator choice. Claims refresh the actual clock after slow
storage reads so a late read cannot start generation outside the allowed hours
or consume the recovery lease before writing starts.

The Mac's server-storage connection and recurring local execution are not
connected yet. The local runner now has an explicit `--use-keychain` mode that
reuses the existing private-test Gemini/OpenAI keys. Its default check queries
attributes only and never reads credential bytes. A separate, owner-approved
Supabase URL/service-key pair is required in the fixed production Keychain item;
metadata presence must not be mistaken for successful connection or valid keys. The Mac must be running for the local path. Do not
copy personal login tokens into Render or silently restart the old paid writer
as a substitute.

Transport check on October 7: one actual ChatGPT-authenticated Codex call
produced a locally valid draft from the October 5 MOF HTML announcement. No
review API was called. That historical HTML-only check is explicitly private
and nonpublishable; it does not establish complete attachment verification,
the two fresh final-copy reviews, today's news eligibility or a daily release.

References: [Codex authentication](https://learn.chatgpt.com/docs/auth),
[non-interactive structured output](https://learn.chatgpt.com/docs/non-interactive-mode).

### Reader feedback and distinct-news preview (2026-10-07)

The owner found the term `財務大臣` unfamiliar and the expanded stories too
similar to the opening text. The requested reading structure is an opening
news item followed by **different news**, rather than a more detailed retelling
of the opening item. The new private example shows one opening story and two
other distinct stories. It preserves the real October 2/5 announcement dates
and is not today's morning edition. The toggle example is `ほかのニュース`.
It must not repeat the opening event, split one event into extra stories, or
fill a quiet day with old announcements disguised as new news.

The example uses the Japan–Australia dialogue memorandum, August employment,
and the separately verified October 2 MOF press-conference statement about
reviewing government-funded activities. It is kept separately from the earlier
approved text. Its revised copy has **not** received fresh Gemini/OpenAI
approval; it is a nonpublishable structure example, with no paid API calls.

The shared readability guard now requires `財務大臣` to be explained at the
first occurrence in each standalone body and avoided in headlines. The fixed
role example is `国のお金の使い方などを担当する大臣`, based on the
[MOF functions page](https://www.mof.go.jp/about_mof/introduction/functions/index.htm).
This general role must not imply that spending was decided in this announcement
or that one minister alone controls every government decision. Both semantic
reviewers must still check those distinctions. The affected checks passed 126
tests at that stage; this local guard change is undeployed. The follow-up guard
also explains `基金` and `総務省統計局` at each standalone body's first occurrence
and avoids the country abbreviations `豪州`/`日豪` in headlines. These fixed
explanations describe general meanings; they never establish a current funding
decision, new agency task or achieved effect.

The local migration now uses the code-owned
`reading_structure: lead-plus-other-news-v1` marker. The overview receives only
the lead article's evidence, while ordered `selected_indexes` retains all
selected articles for the complete final-copy checks. Saved-digest validation,
server initial rendering and browser rendering preserve this contract. Both
reviewers check the opening and every additional article against all selected
originals. Only marked new editions omit the lead detail from the expanded UI;
older editions retain their original complete rendering. The public reading
structure remains undeployed until the real storage connection and local
recurring worker are ready.


### Actual distinct-news copy check (2026-10-07, 18:10 JST)

A separate fresh nonpublic run used the three verified historical originals
listed above. Codex produced a lead overview and three complete article drafts;
Gemini and OpenAI both approved the same complete final copy and all selected
originals. This run includes the new role/fund/agency explanation guards and
full country names in headlines. It used four subscription CLI writing calls,
one Gemini HTTP review and one OpenAI HTTP review, with no Anthropic request.
The final-copy SHA-256 is
`a56d86428c4e870b97e99e046c36fb808135c5a72f1f9fb8dcabfc1a66806d95`;
both approved submission hashes are
`8f9a6ae3345600572d0e9ae45651f8e8b83fa3be0a5d58d951072767801eb796`.
This is historical-copy confirmation only, not current morning eligibility,
production storage publication, a deployed writer switch or a real 08:00 test.

The resulting local regression checks passed 442 Python tests and 90 browser
rendering/refresh tests. The actual Mac preflight also verified the saved
ChatGPT subscription login without generating text or creating a daily claim.
A secret-free candidate archive and readiness report were saved separately.

### Production handoff checks prepared (2026-10-07)

`scripts/check_codex_connection.py` is a separate read-only connection checker.
The default only reports saved-item metadata. Explicit
`--check-live --use-keychain` loads the storage pair and makes at most three
fixed GETs: the private `website-news` bucket, today's preparation manifest and
today's edition. It never creates storage, claims a generation attempt, fetches
sources, invokes AI or prints credentials. Missing current objects, inaccessible
credentials, authentication errors, network failures and nonprivate storage are
separate states. A valid connection with no current issue is not a successful
08:00 update.

The Mac live runner checks the ChatGPT login before creating its runtime or
claiming a daily attempt. `--run-live --serve --morning --use-keychain` accepts
new real-clock ticks only from 06:45 through 08:14:59 JST and stops scheduling
new ticks at 08:15. An in-progress bounded generation can finish afterward;
this is not a forced cancellation or a publication-time override. The normal
Codex writer also rechecks its subscription login for every writing request.
The one-attempt default, immutable claims, 12-minute generation ceiling and
independent review gates remain unchanged. No native recurring job has yet
been installed. The owner subsequently chose Mac-off operation; the private CI
path below supersedes the local morning scheduling plan.

### Mac-off private CI deployment (2026-10-07)

The owner authorized Mac-off operation, production connection and a real 08:00
check. The deployed implementation uses a **private GitHub Actions runner with native
Codex CLI**, not the unverified built-in scheduling of an OpenAI-hosted Codex
Cloud environment. Render collects and freezes the same two official sources.
`scripts/run_private_news_job.py` waits for today's immutable manifest without
starting a collector, then runs at most one durable generation attempt. Its
default is dry and prints configuration names only.

The private job starts around 07:17 JST, is bounded to 35 minutes and at most
08:15, and requires at least 16 minutes remaining before generation. The
inherited 12-minute generation budget and both final-copy review gates remain
mandatory. There are no force, arbitrary-date, retry-cap or key arguments on
this runner. Waiting/collecting/freezing and partial source checks cannot count
as publication success. Both enabled official sources must be healthy before
an empty window is called `source_empty`.

`cloud_news_auth.py` handles only a **new, dedicated ChatGPT login**. It never
seeds from the owner's existing Mac profile. It restores AES-256-GCM encrypted
managed auth to a private temporary home, preserves refreshed auth even after
generation failure, and rejects API-key auth. The fixed private ciphertext path
is `ops/codex-auth/v1.json`; `CODEX_AUTH_ENCRYPTION_KEY` stays separately in the
private CI secret manager. Fixed paths do not reduce the Supabase service-role
key's project-wide privileges. Every use of this auth must be serialized; a
failed checkpoint needs attention, and forced host termination may require a
new dedicated login. This is not an uninterrupted-service guarantee.

The public verifier now checks the new reading structure, ordered article
references and language consistently with the publishing validator. It records
the first observed release time and its delay after 08:00. Offline boundary
tests do not prove that GitHub cron will start at a specific instant. Free
GitHub scheduling and Render cold starts can still be delayed.

The operations workflow and explanation are maintained separately in the private
`Im-Letty/investment-news-ops` repository (`../news-cloud-ops` locally). The owner
explicitly approved that repository, dedicated encrypted ChatGPT auth and transfer
of the Gemini/OpenAI/Supabase connection secrets. These are now registered; the
existing Mac Codex profile was never copied. Real Linux runs confirmed offline
safety checks, storage/login connectivity, one native subscription JSON response,
encrypted auth checkpoint and transient-auth cleanup. No review API call was
needed for those infrastructure checks.

Render was verified on 2026-10-07 at 23:39 JST with `enabled=true`,
`configured=true`, `writer_provider=codex_subscription` and
`generation_owner=external`; both public news endpoints returned HTTP 200.
The private daily schedule is enabled and its producer is pinned to an approved
commit. The existing dated October 5 edition remains public until a valid new
edition is available. The first real new morning is **2026-10-08**, whose source
freeze, final-copy review and actual release time are still unverified. The
public wake/check records that observation, and a follow-up is scheduled to read
the result. Successful connection is not proof of an actual 08:00 publication.

### Actual private final-copy check (2026-10-07, 16:38 JST)

The final historical-copy run used the real October 5 Ministry of Finance
announcement with its verified complete supporting PDF, and the October 2
Statistics Bureau release for August employment. Their original dates, body
hashes and actual October 7 verification times were retained. The Tokyo CPI
index page was excluded because the fetched body contained no result values.
This is a private historical text test, not a current morning edition.

The final run completed three ChatGPT-authenticated Codex writing calls and one
actual review request to each of Gemini and OpenAI. Both approved the identical
final draft and submission hash. An independent source/readability check
found no remaining mandatory issue. The overview is 193 characters; the two
details are 218 and 106, allowed by `flexible-v1` without padding a short source.
The exact approved copy is preserved in the private result and preview; no
post-approval copy edit, `build_issue`, runtime publication or LINE send occurred.

An earlier approved draft still needed a readability correction: the
employment overview only reported that results were announced, and its detail
used an unexplained indicator. A second bounded run correctly stopped when
OpenAI rejected an unexplained unemployment count. The shared instructions now
require a statistical release's meaningful main result and comparison, and the
local gate covers unemployment rates/counts, employment counts and seasonally
adjusted values. A source-supported plain-language result may be chosen instead
of inventing a definition. Revised copy always needs both fresh reviews.

Across these three private runs there were twelve Codex writing calls and eight
review API requests (Gemini four / OpenAI four), with zero Anthropic requests.
These are request counts, not measured currency charges. The final affected
regression checks passed 234 tests, and the private harness checks passed 60.
Production remains undeployed: the real Mac worker's dry configuration check
still reports missing shared-storage and reviewer environment configuration.
The saved private-test Keychain keys remain available; they are not lost.
Actual server handoff, local recurring execution and the production 08:00 release
remain separate unfinished checks. Older Claude checkpoint sections below are
historical evidence and do not override this result or prove deployment.

## Website source path and verification status (2026-10-07)

The owner reconfirmed this source pair on October 7: continue collecting the
Statistics Bureau and Ministry of Finance originals directly, without adding
Gemini Search to the morning source path. Codex writes the easy-Japanese copy;
Gemini and OpenAI are the two independent reviewers, not substitute collectors.
Both must approve the identical final copy against the identical verified
originals after any repair. Unverified evidence, unresolved factual concerns,
or an unavailable reviewer must block a new publication. Zero misinformation
is the owner's aim, not a guarantee established by official attribution or
two AI approvals. The two agencies' limited announcement feeds do not cover
every economic development or establish continuous real-time coverage.

The locally implemented automatic website path uses **総務省統計局・財務省**. `website_news.py` explicitly enables those two sources in `official_news_sources.py`; it does not retrieve BOJ or start the shared LINE RSS cache. Collection, the immutable morning source window, drafting/review, saved-edition validation and public metadata are connected in the local code. The official source/runtime path was deployed in earlier revisions. The recovered Codex writer/adapter candidate now has the private historical-copy approval above, but its actual server-storage connection and deployment remain unfinished; an actual production 08:00 release has not been confirmed.

The owner selected public-agency announcements on 2026-10-05, with **日本銀行** also proposed, but BOJ remains on hold pending clarification of its use conditions. Broader market, disclosure and licensed news sources remain later candidates. The [statistics-site terms](https://www.stat.go.jp/info/riyou.html) and [finance-ministry terms](https://www.mof.go.jp/about_mof/notice/index.html) were rechecked on 2026-10-05. For those two agencies, use the selected announcement text under the applicable PDL1.0 terms, credit the source URL and identify the site's summary as edited content. Do not assume that third-party material, imagery, logos or separately restricted content is covered.

**The Bank of Japan has different terms.** Its [copyright policy](https://www.boj.or.jp/about/copyright.htm) calls for advance consultation for commercial reproduction, restricted passages and images, and disallows unauthorized alterations. An explicit permission for this site's automated commercial summary workflow has not been established. This does not establish that independently reporting facts is prohibited; it does mean that the other two sources' PDL permission must not be applied to BOJ. The BOJ addition is a private retrieval implementation only; public/AI use requires resolving the applicable scope before connecting it. No inquiry has been sent and no license purchased.

`official_news_sources.py` retains the original publication date and its precision. An announcement with no published time keeps `published_at: null`, `published_date: YYYY-MM-DD` and `publication_precision: day`; neither the retrieval time nor midnight becomes an invented publication time. `observed_at` records retrieval and `body_verified_at` records successful body/date verification; neither is substituted for publication. The month measured by a statistical release remains part of its source text, distinct from the date of announcement.

The local Ministry of Finance adapter also supports individually inspected parent/PDF pairs in `MOF_SUPPORTING_PDFS`, beginning with the October 5 announcement linking the Japan–Australia financing memorandum signed October 2. It requires the registered link in the verified article body, the exact approved PDF endpoint, matching document title/signing text, and successful bounded extraction of every page. HTML plus PDF bytes share the 2 MB ceiling; combined text stays within 30,000 characters. Missing links, unreadable pages or failed downloads reject that combined record rather than silently reverting to the introduction. The parent's publication date remains the article date; the PDF's signing date is separately labelled. Raw text and `supporting_documents` stay in private evidence, and all three providers receive the same frozen combined body. Public source references link to the parent announcement. This is a small explicit attachment registry, not permission to crawl every linked PDF or treat unverified links as evidence.

The registered public memorandum permits viewing without a password and text extraction despite having an encryption flag. Only this explicit supporting-PDF route may open such a document using the empty user password, and only when its declared permissions allow extraction. Password-required, unknown-permission and copy-restricted PDFs remain rejected. The ordinary and BOJ PDF paths retain their existing encrypted-document rejection.

On 2026-10-05 the owner selected **announcements since the preceding day's 08:00, verified before the morning preparation cutoff**, with post-cutoff items considered the next morning. The implementation uses 07:30 JST as the cutoff, preserving 30 minutes for writing and independent review before the 08:00 target. The date-only and cutoff-gap routes below prevent fabricated times or lost boundary items. An empty period must remain empty.

The retained **private BOJ adapter (not enabled for website collection)** checks the [official general RSS](https://www.boj.or.jp/rss/whatsnew.xml) and only accepts the policy-decision titles `金融市場調節方針について`, `金融市場調節方針の変更について`, and `当面の金融政策運営について` on narrowly allowed decision-document paths. Minutes, opinions, speeches, schedules and reference slides are not treated as new rate decisions. RSS history is limited; this is not an exhaustive historical backfill. Exact approved HTTP article links in the official RSS are upgraded to HTTPS without making HTTP requests.

BOJ HTML requires a matching heading, a leading dated BOJ attribution and substantive text; PDF/link-only indexes are excluded. PDF text is extracted with `pypdf==6.19.0` in an isolated, bounded child process (2 MB, 20 pages, 8 seconds, 30,000 characters). Encrypted, scanned/unreadable, partial or oversized documents are rejected. The leading document date is cross-checked against the RSS publication date; effective dates, meeting dates, PDF metadata and future publication schedules do not replace it. The 2026-09-18 five-page policy PDF and the 2026-01-23 HTML decision were read successfully in private checks, preserving their historical dates. They are test documents, not today's news.

`collect_official_articles(..., diagnostics=report)` reports source status and counts separately. A failed/unfinished feed, no matching candidates in a successfully read limited feed, failed article verification and partial collection are distinct states. It rejects well-formed HTML maintenance pages as invalid feeds. No matching RSS entry still does not prove that no announcement exists elsewhere. The collector and producer were tested locally with network/API calls replaced or blocked, including original-date handling, invalid sources, cutoff boundaries and fixed-snapshot generation. The retained BOJ retrieval tests do not enable BOJ in the website path.

`build_issue`, saved-edition validation, initial HTML, browser rendering and the publication checker support the official source window and original date precision. Previously published editions retain their actual dates. The older NHK/Reuters path documented below remains compatibility code for existing records and the separate RSS/LINE flow; it is not the new automatic website source selector. No private fixture or local code change is considered published merely because local checks pass.

Historical connection check: a private Claude draft and independent Gemini/OpenAI reviews succeeded on 2026-10-05 using two announcements from 2026-10-02. That earlier check did not cover current-day collection or the release gate. The later source-isolated test `morning-session-afd5c2f592c54aa3a859a8d5b81f9de7-run-2` passed the nine private morning-flow checks, as recorded below; neither result establishes an actual production 08:00 release.

### Implemented morning window

- All boundaries use Asia/Tokyo. There are seven collection slots: **07:00, 07:05, 07:10, 07:15, 07:20, 07:25 and 07:29**. Each slot has a durable create-only claim; a missed slot is not replayed as a burst. Freeze verified source content at **07:30:00**, then draft/review for **08:00** publication. Do not permanently finalize the edition at the first 07:00 success. Free-host startup and failed review can still cause delay; never backdate a late release.
- Main timed announcements: original publication at or after the preceding day's 08:00 and at or before today's 07:30. The exact body version must also be verified by 07:30. `body_verified_at` is captured after extraction/date checks for that body hash; `observed_at` alone is not sufficient.
- Prevent the 30-minute gap: an unpublished timed announcement after the preceding 07:30 cutoff but before the preceding 08:00 is an eligible carryover candidate. A release exactly at the preceding cutoff that missed verification can also enter through the explicit deferred-candidate record. This keeps "post-cutoff goes to the next morning" consistent with the owner's main window.
- Date-only announcements use their actual publication day, never a guessed 00:00 or retrieval time. Announcements dated the preceding or current day are eligible through a separate date-only route if their body was verified by the cutoff and the announcement identity (canonical URL plus original publication date) has not already been published. Their time is still null, and they are not represented as proven to be after 08:00. Collection begins from the preceding day's 00:00 date boundary; `morning_news_window.py` then applies the more precise eligibility routes.
- Freeze each edition's source manifest with article identity, original date/precision, body hash, verified body and verification time. Retries/restarts use this immutable manifest and cannot silently include content fetched after cutoff. A substantive correction invalidates the affected draft and requires a new review, rather than silently updating the frozen body.
- Durable slot snapshots and frozen manifests preserve source, canonical URL, original date/precision, body hash and verification evidence. Re-fetching the same version retains its earliest verified time during selection. Published-edition history records actual inclusion; selection or an unreleased prepared edition is not publication. An already published URL plus original publication date is excluded, including when that announcement's body changes. The runtime derives separate deferred reasons from preceding-edition records: `late_verification`, `review_failed` or `omitted`; the AI does not supply this evidence.
- Unpublished/deferred candidates may be reconsidered for **the next morning only**, preserving their original dates, relevance and source checks; this is eligibility, not a promise to publish every item. Further carryover is not automatic. Older information needs an explicit dated-background/correction decision and must not pad a quiet day's current roundup. After a prolonged outage, do not automatically drain an old backlog as today's news.
- If the same URL and original publication date have a changed body, inspect it as a correction; a new body hash alone is not a newly announced story. Some official statistics pages reuse the same URL for successive releases. If both the feed and body verify a new original publication date, that is a new announcement identity and is not permanently blocked merely because its URL was used before. An edit/retrieval date cannot establish that new identity. Withdrawn or conflicting evidence cannot be published, even if an earlier version passed AI review.

Boundary examples (local implementation policy, not claims about the currently deployed code):

| Example for the October 6 edition | Handling |
| --- | --- |
| October 5 08:00 publication, verified by October 6 07:30 | Main candidate; display October 5 as source date |
| October 5 07:45 publication, missed the previous cutoff | Carryover candidate; not lost in a cutoff gap |
| October 6 07:29 publication, verified at 07:30:00 | Candidate |
| Same publication, verification finishes 07:30:01 | Defer to the following edition's candidate review |
| October 5 publication day only, verified before cutoff, not previously published | Date-only candidate; no invented time |
| Same URL/date/body already published | Do not publish again |
| Same recurring statistics URL, with a new original release date verified in both feed and body | New announcement identity; apply the current window and body checks |
| Source body changes after the cutoff | Recheck as a correction; do not alter the frozen draft invisibly |
| No suitable candidate, or an unverified source outage | Do not invent copy or advance an older article's date |

The private frozen manifest contains the verified bodies alongside the window fields: `version: 1`, `edition_date`, numeric `window_start` (preceding 08:00), `carryover_start` (preceding 07:30) and `cutoff_at` (current 07:30). The runtime passes those fields as `source_window` and the fixed bodies as `articles` to the producer; it cannot fetch extra articles or run Gemini Search on this path. Public editions carry `source_window` and references with source/title/URL, original date/precision, `body_sha256`, `body_verified_at` and `selection_route` (`main`, `carryover`, `date_only` or `deferred`). Only the deferred route exposes its preceding-edition date and reason. Raw source bodies stay in private preparation records and are not included in the public references.

If the checked source window has no eligible new candidate, the runtime reports `source_empty` and makes no AI generation call. Failed or incomplete source checks instead report `source_unavailable`; they are not treated as a confirmed quiet morning. In either case, an earlier valid publication remains under its original date. Deployment and an actual production release must be verified separately from these local implementation checks.

### Source-use review and BOJ inquiry draft (not sent)

The [PDL1.0 text](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0), Statistics Bureau terms and Ministry of Finance terms were re-read on 2026-10-05. For material covered by PDL1.0, reproduction, adaptation and commercial use are allowed subject to its conditions. Retain the actual document link, provider attribution and an explicit indication that this site created/edited the summary. The compact UI approved on 2026-10-11 shows each article's actual provider as its original-document link, with `公式発表をもとに要約` in a native ⓘ disclosure for summarized official announcements. In the lead-plus-other-news layout, the + opens a final source row for all articles; links are kept per article, including separate URLs from the same provider, with the article title in the link title and accessible name. The collapsed row keeps only the original publication date and the +. The source row inside the opened panel includes one native ⓘ with the unchanged summary explanation; neither sources nor summary help appears before + is opened. A single-article edition also provides the + so its source remains reachable. The edition date remains in the dated header, while each article keeps its original publication date and precise metadata. Do not imply official endorsement. Photos, maps, logos, separately restricted material and third-party rights are not cleared by that general rule; check each chosen document. PDL1.0 does not itself establish an AI provider's retention/training settings.

BOJ has not been cleared for external-AI submission or public summaries. The absence of an AI-specific permission is not a determination that independent reporting of facts is prohibited. Obtain clarification on the planned workflow rather than treating a link or attribution as permission. The official [contact page](https://www.boj.or.jp/about/services/contact.htm) lists the Information Services Department for content-use inquiries. No message has been sent, no mailbox opened, and no operator identity or commercial status has been inferred.

宛先候補：日本銀行 情報サービス局 `post.prd8@boj.or.jp`

件名案：金融政策の公表資料の取得・AIによる要約公開に関する利用条件の確認

日本銀行 情報サービス局 ご担当者様

一般向けの経済ニュースサイト（https://investment-bot-ta24.onrender.com/）で、貴行の金融政策に関する公表内容を、専門知識がない方にも分かりやすく紹介する方法を検討しています。実施前に、下記の利用方法について確認させてください。

対象は公式新着RSSに掲載された金融政策の決定資料のHTML・PDF本文です。例として https://www.boj.or.jp/mopo/mpmdeci/mpr_2026/k260918a.pdf のような資料を想定しています。朝の準備時間帯に少数回取得し、原文の発表日・リンクを保持する方法を計画しています。

取得した本文をAnthropic・Google・OpenAIのAPIへ送信して文章生成と内容照合を行い、1件につき200〜400字程度を目安とする独自の日本語要約を作成する想定です。当方でAIモデルを学習させる目的はありません。API事業者側の保存・学習利用条件は契約・設定によって異なるため、必要な条件をご教示いただいた上で適合を確認する予定です。

原文全文、写真、ロゴ等を掲載する予定はなく、サイトが作成した要約であること、貴行の資料名・出典リンク・実際の発表日を示す予定です。

1. このような事実・数値に基づく独自要約の一般公開について、事前許諾や申請が必要でしょうか。
2. 要約作成・照合のために本文を上記の外部AIサービスへ送信・処理することに、条件や制限はありますか。
3. 無料・非広告の公開と、広告・有料機能等を伴う公開では、条件はどのように異なりますか。
4. 定期取得の頻度、必要な出典・加工表示、対象外資料、保存・再利用等に関する条件があればご教示ください。

よろしくお願いいたします。

送信前に運営者名・連絡先・実際の広告/有料機能の有無と取得頻度を本人に確認し、本文を確定する。現在は条件照会の下書きであり、利用許諾の取得済み記録ではない。

## Legacy RSS source path — compatibility and separate LINE flow

`WEB_NEWS_SOURCES` and `daily_news_sources.py` retain the former fixed pair, `NHK経済` and `ロイター経済`, for legacy record validation and compatibility. An explicitly reviewed Reuters article from an attributed distribution page is still Reuters reporting; independent commentary by the host is not eligible. A missing RSS feed does not authorize automatic publisher substitution. The shared raw cache also serves the separate LINE/report flow. The new `PublishedWebsiteNews` adapter uses reviewed website editions without starting this shared cache; the official-source migration does not change or send LINE messages.

### Legacy same-day RSS selection

These rules describe the retained RSS compatibility selector. The official morning edition instead uses the frozen window and date-only/deferred routes above; it does not recompute source selection on each page view.

- Use the article's original publication time, converted to Japan time (UTC+09:00).
- Never substitute an edit timestamp, retrieval time, or a guessed date.
- Missing, invalid, future-dated publications and invalid article URLs are excluded.
- Select up to three distinct, important current-day economic developments (normally two or three; one is valid on a quiet morning) for a published edition, with Japanese economic and household relevance central. Multiple reports about one event count as one topic. The raw feed fallback remains newest-first, up to three articles.
- Deduplicate by normalized title or article URL. Differently worded reports about the same event still need editorial comparison; this is not semantic AI deduplication.
- When no eligible articles have been confirmed, show that state without padding the current-day list with older stories.
- A source outage is separate from a successfully checked feed with no eligible articles.
- Recompute selection at request time. Live RSS caches require policy version 4 and the current Japan-time date. Curated publications keep their actual edition date until a newer validated edition is released, including across midnight and temporary source outages.

## One short daily summary

The front of the card shows one short headline and **200–300 Japanese characters for the two or three topics combined**. Opening Read more shows each news item with its own plain Japanese headline and **200–400 characters per article as a guideline**. These individual summaries are readable together without another disclosure click or leaving the site. Publisher names are listed once beside the footer publication date, without repeating them on each article. Publication times and original article links remain alongside each summary.

The writer, length repair and both reviewers share the same readability rules. Keep the combined summary to normally two essential numbers besides dates; preserve every comparison period. Each detail begins with one short sentence identifying the development, then adds source-backed information or an explanation, so it stands alone without repeating the whole overview. Do not turn a proposal or stated intention into a decision in a headline. These are generation and review requirements, not a guarantee that AI will never make a mistake.

`news-digests.json` holds committed reviewed Japanese copy, supplemented by validated runtime editions. Each record contains `edition_date`, `lang: "ja"`, `headline` (1–80 characters), `summary` (200–300 characters for legacy unmarked copy), and `article_refs`. New website editions set the code-selected `copy_length_policy: "flexible-v1"`: the overview aims for 200–300 characters and details aim for 200–400, with 10% upper room (330 and 440) for necessary explanations/qualifications. A nonempty shorter summary is allowed if it passes all other validation and both final content reviews; no padding is purchased merely to reach 200. Every reference contains the verified `source`, normalized `url`, original `published_at` of the linked article, and its exact `title`. Official-window records additionally preserve `published_date`, `publication_precision`, `body_sha256`, `body_verified_at` and `selection_route`; date-only articles have a null `published_at`. The authored Japanese text keeps its language marker when a reader changes the interface language.

The `article_summaries` list adds a `headline` (1–80 characters) and `summary` (legacy 200–300; `flexible-v1` nonempty and at most 440) to each article's exact reference metadata, including the official date/verification fields when present. It must cover all reference articles exactly once. Partial, duplicate, mismatched or malformed copy invalidates the reviewed digest; a missing list retains the older link-only behavior for compatible saved records. New automatic editions include individual summaries. Original source titles remain in the provenance records. Both initial HTML and browser rendering use the same reviewed copy. Short paragraphs are authored with line breaks, and all rendered text is escaped.

An edition explicitly approved for publication uses `publication_mode: "curated"` and an actual `reviewed_at` timestamp. It requires one to three distinct references; do not invent a second topic on a quiet day. For official editions, every reference must qualify under the edition's `source_window`, and the review must finish on the edition date at or after 07:30. Original article dates may be earlier and are kept unchanged. `publish_at` is required and is no earlier than both 08:00 JST and the actual review completion. It gates a prepared edition until release and never backdates late approval. Saved legacy curated records without `source_window` retain their same-day publication-date validation and optional `publish_at` compatibility.

The review covers every topic in the edition. RSS absence alone does not revoke a checked article, and unrelated new feed entries do not silently change the scope of its summary. Conflicting source identity, title, timestamp or body-version evidence within the same URL/original-date identity invalidates selection; a changed body is not automatically a new article. A recurring URL with a newly verified original release date is handled as a separate announcement. The latest released edition is selected by edition date and release timestamp. Equal latest dates/timestamps are ambiguous and revoke cached publication. A delayed or failed new edition leaves the previous publication under its original date.

Unmarked legacy records remain tied to the exact current live selection before headline translation. Unmarked records retain strict 200–300 limits. Only code-marked `flexible-v1` records use the role-specific flexible bounds. Unknown or explicit-null policy values invalidate the record. This version is preserved through normalization, initial HTML, the API and browser storage/rendering.

Before adding a review, read the source content, confirm its publication date, and combine overlapping events. Write for a middle-school reader: replace unfamiliar terms or explain them briefly at first use. Explain what happened and any supported relevance to daily life or companies. Include a next development only when the source establishes it; do not fill a mandatory outlook with speculation. Distinguish reported facts, general economic mechanisms and possible future effects. Do not invent causes from a headline, imply that prices must move in one direction, or manufacture a Japan-related consequence. Established background sources may verify a mechanism; they are not counted or presented as another piece of today's news.

If no valid edition has ever been published, show the unpublished state. The new website path does not start the legacy RSS cache to fill that space. Do not fabricate extra topics or substitute older events just to reach two or three. The automatic website producer described below uses verified frozen bodies, Claude drafting, and independent Gemini and OpenAI editorial checks. Automated review can miss errors; it is not a guarantee of factual correctness.

## Immediate first display

The root HTML includes the current news card and an inert `knInitialNews` JSON payload. `news_initial.py` renders the current curated edition without waiting for news generation. Its generic cache interface retains legacy feed support, but the new website adapter returns no live RSS fallback and does not start LINE's feed refresh. The API and HTML use the same curated selection. A published edition has `delivery: "published"`, `fetched_at: null` and a publication-date label; it is not a freshly fetched RSS response. Official references display their original source dates, with no invented time for date-only announcements. Source-level fetch diagnostics remain separate. Cold fallback for a legacy record never revives a rejected curated edition.

The browser reads embedded content immediately, keeps it readable during pending or unavailable requests, and accepts subsequent published editions from the API. A confirmed identity conflict sets `publication_revoked` and removes the invalid summary; the official path does not replace it with fabricated copy or start a legacy feed. Published content is persisted separately from RSS under `kn_published_news_v1_<lang>`, stays separate per interface language, and does not disappear at midnight. The browser checks the 08:00 JST publication boundary once, then uses the normal two-minute refresh interval; it does not poll every second when the visible edition is older. Expanded article panels and focus survive the initial JavaScript handover.

The HTML remains revalidated on each visit. Its ETag includes the Japan date and rendered content, so changed publications and dates are revalidated. Prepared editions are omitted until `publish_at`, and their release changes the ETag. Render's existing compression remains in use. This removes the extra news-request wait once the page arrives; network and server startup time still affect the page itself. A new day's authored summary still requires publication through the reviewed path above.

### Historical reviewed edition: 2026-09-22 (legacy sources)

- Body: 224 Japanese characters covering **two developments**, currency movements and US shares.
- Reuters article: [Yen squeezed as hawkish turn grips central banks](https://www.marketscreener.com/news/yen-squeezed-as-hawkish-turn-grips-central-banks-ce785adbd08ef321), Tom Westbrook / Reuters. The linked distribution page states first publication September 21, 2026 20:53 EDT, or September 22 09:53 JST. Its later modification at 01:28 EDT / 14:28 JST is not used as publication. This is the linked page's original timestamp, not a claim about the inaccessible Reuters-hosted original.
- NHK article: [Nasdaq record](https://news.web.nhk/newsweb/na/nd-20260922de51819), published September 22 09:25 JST about the September 21 US session. The index explanation was checked against the [Nasdaq Composite definition](https://indexes.nasdaq.com/Index/Overview/COMP).
- The possible effect of a weaker yen on imported food/fuel and household costs is background explanation supported by the [Bank of Japan's March 2022 press-conference record](https://www.boj.or.jp/about/press/kaiken_2022/kk220322a.htm). No past numeric data or policy decision is presented as today's news.
- Interest-rate developments are a watchpoint, not a prediction that yen or share prices will rise or fall. The copy does not claim household prices have already risen because of today's trading.
- Individual detail bodies: Reuters 220 characters and NHK 258 characters, including paragraph breaks. Each article has a separate plain-language Japanese headline. The combined 224-character front summary remains unchanged.
- The Reuters detail's 157-yen range and concern about possible official currency intervention were rechecked in the [same Reuters report distributed by Yahoo Finance](https://ca.finance.yahoo.com/news/yen-squeezed-hawkish-turn-grips-052642961.html). A possible intervention is not a confirmed decision. Publication metadata still refers to the originally linked MarketScreener page.
- Stock-index background was checked against the [Japan Exchange Group explanation](https://www.jpx.co.jp/faq/stock_price_index.html). General explanations are not additional current news reports or forecasts about every individual share.

## Legacy explicit older context

This saved RSS supplement mechanism is separate from the official morning window's evidence-backed, next-morning-only deferred route. It does not authorize the new automatic producer to pad a quiet window with older articles.

`news-supplements.json` contains explicit editorial approvals and is initially empty. Only add a record after checking why it is important context for current economic news:

```json
[
  {
    "url": "https://publisher.example/article",
    "reason": "A short, plain-language explanation of why this earlier article matters now."
  }
]
```

Approval cannot invent an article or override its publication date. The URL must match an article currently obtained from the fixed sources. The article must have been published before the current edition, within seven Japan calendar days. At most one approved older article appears, in the separately labeled and dated supplement section. It never fills a vacant current-day slot. Empty, missing or invalid approval files approve nothing.

The legacy Reuters RSS may be unavailable. The retained legacy collector supports approved publisher article pages and explicitly attributed Reuters distribution pages, with original publication metadata and article bodies verified separately from search. It does not bypass access restrictions or substitute publishers. The new automatic website path uses the two official sources above and does not invoke this collector. No LINE messages are sent by the website publication flow.


## Publication operation and 08:00 release

### Production wiring and verification boundary (2026-10-06)

`line_bot.py` passes `website_news_producer.generate_website_edition` to `daily_news_runtime.py`. Render confirmed revision `a6d38b3` Live after owner approval. This adapter calls the same `isolated_news_producer.generate_isolated_edition` as the successful private test below. October 6 scheduled workflow logs independently confirmed the source-isolated generator, both official sources, all required configuration and the three default models. The earlier revision `ba1d464` remains historical evidence, not a verification of this pipeline. No credentials or Keychain values were read for these checks.

**Deployment is confirmed; successful daily publication is not.** The October 6 automatic attempts stopped with `generation_call_limit`, reaching the existing six-attempt daily ceiling. Offline reproduction found a contradictory one-fact JSON example despite a two-fact minimum, and no local-repair allowance for a three-detail draft. This follow-up aligns the example with validation and reallocates the writing allowance from four to six calls while retaining the eight-call total. It does not erase immutable attempt claims, reset today's ceiling or manufacture a published edition. When a repair cannot fit, the original local-validation or editorial-review failure is preserved. Actual scheduled release still requires a successful production record. Direct public API verification was rejected by automatic approval review because these endpoints can start paid generation; verification used existing workflow logs and the Render dashboard instead.

The initial local wiring check passed **356 offline tests**. The October 6 repair follow-up passed **382 distinct news and LINE tests**, including three-detail local repair, strict total caps, retained failure reasons and the documented JSON shape, with HTTP mocked or blocked. This connection work made **zero new paid API calls**. The earlier successful private run used five real provider calls; its evidence is distinct from these offline tests and from an actual deployed morning release.

`publish_news.py issue.json --check-only` validates a reviewed edition without writing. Running it without `--check-only` atomically replaces only that edition date in `news-digests.json`, retains the latest 30 editions and leaves all published data unchanged on invalid input or write failure. It does not collect source content, generate copy, send LINE or call AI. A producer must run before 08:00, verify source content, set the actual `reviewed_at`, and set `publish_at` to that day's 08:00 JST (or the actual later publication time when late). Do not backdate a late review to pretend that it was ready at 08:00.

The server runs `daily_news_runtime.py` every 30 seconds after a serving worker receives its first request (the external wake/check supplies this even without visitors). Startup is deferred until after Gunicorn fork; inherited locks, threads and HTTP pools are reset in each child process. `website_news.create_source_preparer` supplies the official two-source `MorningNewsPreparer`. Collection uses the seven 07:00–07:29 slots above; the 07:30 cutoff freezes only bodies verified by that cutoff. Generation starts from the frozen manifest. Verified prepared editions are released no earlier than 08:00. Late editions keep their actual review/release time. A dated edition already checked into the repository takes precedence over unnecessary regeneration.

`website_news_producer.generate_website_edition(now, articles=..., source_window=...)` validates the fixed official snapshot before any paid call through the shared source validators. It accepts only Statistics Bureau and Ministry of Finance articles with eligible dates, valid body hashes and verification times no later than cutoff. It preserves the caller's articles/window and never fetches extra articles or uses Gemini Search on this path. An empty or invalid snapshot does not start AI. It returns the existing `build_issue` digest contract, so storage, source references, initial HTML and the 08:00 release gate remain compatible. The older `daily_news_producer.generate_edition` entry remains compatibility code; the newly wired website runtime does not call it.

Claude first writes each selected article separately, then writes one combined overview from the source-bound cards. The overview aims for 200–300 characters and each independently readable detail for 200–400. The code-selected `flexible-v1` policy allows necessary modest excess up to 330/440, respectively; empty copy is rejected and shorter copy still needs readability/content approval. Gemini and OpenAI independently check exactly the same final draft against the same selected frozen source bodies, evidence cards and date/window metadata for facts, dates, economic relevance, distinct topics, readability, unsupported outlook and copied wording. Neither reviewer receives the other's verdict. Both must return the strict boolean-check/issue-list contract and approve every check, with no outstanding issues. Agreement is not a guarantee of factual truth.

Each article/overview stage has at most three local writing attempts (the initial draft and up to two local-validation corrections), and there are still at most two complete editorial-review rounds, always subject to the stricter remaining HTTP budget. The extra local correction does not relax the policy-selected safety bounds, readability, evidence or final-review requirements. It does not force a paid rewrite merely because a nonempty complete text is shorter than the target or modestly exceeds it within the allowed safety bounds. Only fixed failed-check names enter an editorial rewrite; free-form reviewer prose cannot leak another article's conditions into its source-isolated context. A revised draft requires fresh approval by both reviewers. Invalid review JSON, connection errors, refusals, incomplete output, expired deadlines or an exhausted budget stop the attempt without publishing. The new path never invokes legacy `fit_lengths`, never appends text through its repair route, and never falls back to a mixed-source draft. No eligible body or a failed check leaves the previous published edition under its original date.

The website adapter allows **Claude six / Gemini three / OpenAI two, at most eight HTTP attempts in total, and a 12-minute cooperative deadline**. Three details plus their overview require four writing calls; two local validation repairs and both final reviewers can now fit in the unchanged total ceiling. The historical private rehearsal used a four-call writing cap. A complete editorial rewrite may still exceed the available total and must stop safely; the allowance is not a promise that every repair will fit. Counts include failed requests and Gemini's internal output-token retry. Before writing, `reserve_drafting` checks the pending detail/overview calls and at least one remaining review by each provider; it does not promise that an additional token retry will fit. A new website attempt creates a fresh single-use provider. Its Session is closed and its private environment copy cleared on success or failure. An earlier inherited deadline is never extended. These are per-attempt limits; the daily retry limits below also apply.

The retained `daily_news_sources.py` legacy collector fixes the publishers to NHK and Reuters, allowing explicitly Reuters-attributed articles distributed by MarketScreener, Euronext or Newsweek Japan. Its original timezone-bearing publication metadata, access and request limits remain unchanged. It is not called by the official-source website wrapper. Neither missing official announcements nor a failed body check authorizes a fallback to those publishers or to search snippets.

Private Supabase Storage bucket `website-news` stores collection-slot claims/snapshots, each edition's immutable source manifest, generation-attempt claims and validated editions before local publication. Verified source bodies remain in the private preparation records; public editions expose only source references, dates, hashes and verification metadata. Only a server service key is accepted; the bucket must be private. Unique create-only claims coordinate workers and survive restart. A retry reuses the frozen body versions instead of adding later news. There are at most six generation attempts per Japan day, at least 15 minutes apart. An unfinished attempt holds a 16-minute lease; the producer cooperatively stops starting new stages after 12 minutes and late results are rejected. Completed failures release their pending state but still respect the 15-minute retry interval, leaving attempts available at and after 08:00. This is not an OS-level cancellation of an already blocking network call. A successful edition prevents additional paid generation that day. A confirmed empty window also causes no paid generation; a failed source check remains a distinct operational failure. The runtime restores durable copy to `NEWS_RUNTIME_PATH` (default `/tmp/kn-daily-news.json`) and merges it with committed editions. The browser and initial HTML both read this merged publication history without waiting for AI or Storage.

Server-only `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL` and service-role `SUPABASE_KEY` are required. Missing OpenAI configuration disables new automatic generation rather than silently skipping its review; previously published editions remain available. The new website adapter's defaults are **Claude Sonnet 4.6 (`claude-sonnet-4-6`), Gemini 2.5 Flash and GPT-6 Luna**. Explicit `NEWS_CLAUDE_MODEL`, `NEWS_GEMINI_MODEL` and `NEWS_OPENAI_MODEL` settings are respected without modifying the caller's environment. The October 6 workflow status from deployed revision `a6d38b3` confirmed these three effective models. An existing override can still select another model. The retained shared Providers class keeps its older Haiku default; the website adapter does not change the LINE generator.

For the exact default `claude-sonnet-4-6`, the local website adapter uses `thinking: {type: enabled, budget_tokens: 2048, display: omitted}`, `output_config.effort: medium`, `max_tokens: 8000` and streaming, without a `temperature` field. The stream decoder discards thinking, redacted-thinking and signature blocks, and accepts only a complete ordered response with `end_turn`, `message_stop` and clean EOF. Partial streamed text cannot become a draft. The vendor still supports manual thinking for this model, although it is deprecated; 2048 is a thinking target, not a strict thinking cap or guaranteed final-answer reservation. The 8000 ceiling bounds the combined response. This exact native website path has a 180-second per-request window and 90-second read timeout; other paths retain their 100/45-second limits. The existing 1 MB response bound, eight-total HTTP ceiling and 12-minute cooperative attempt deadline remain unchanged. Non-default Claude overrides and the shared/LINE provider retain their existing paths. These local revisions still await a newly passing real-AI/editorial check and deployment; historical private successes do not establish that check or an actual production 08:00 release.

The exact website `gemini-2.5-flash` review with search disabled uses `thinkingBudget: 4096`. Shared/LINE, search-enabled calls and explicit other model overrides retain 1024. Thinking and response text share the unchanged 6000-token output cap; only a genuine `MAX_TOKENS` result may use the existing bounded 12000-token retry. Every HTTP attempt, including that retry, counts against the same limits. This setting provides more room to compare the complete source bodies and completed draft; it is not factual approval and cannot convert a rejection into a retry or success.

OpenAI uses the Responses API with a strict review JSON schema, medium reasoning, a 4,000-token output cap and `store: false`; it receives no browser session or ChatGPT credentials. API access and billing must be configured in the owner's OpenAI project. A ChatGPT subscription is not the API credential. Production uses Render's server environment, while the wake/check workflow needs no provider keys. **macOS Keychain credentials used for local private tests are not transferred to Render automatically.** `DAILY_NEWS_ENABLED=0` stops automatic paid generation while retaining published content. No new paid hosting plan or news subscription is created.

### Source-isolated writer — shared by the private test and website adapter

`isolated_news_producer.py` is used by `work/news-private-final-preview/live_morning_rehearsal.py` and the website adapter `website_news_producer.py`. Each article is drafted and repaired with only its own frozen body, attachments and dates. The code fixes its source index, splits the exact body into numbered passages, and resolves the AI's chosen evidence IDs only within that article. The AI does not retype original quotes. These reference checks do not prove the interpretation is true: the complete final draft still requires independent Gemini and OpenAI approval against the originals.

The candidate takes at most three records in the preparation snapshot's existing stable order. This is a bounded candidate set, not an importance ranking of every announcement. A separate overview call receives source-bound cards, not all original bodies, and cannot alter the details. Details remain independently readable and two paragraphs, aiming for 200–400 characters; the whole overview aims for 200–300. Necessary modest excess is accepted up to 440/330, respectively. Writer guidance favors short complete sentences of about 40–45 characters, with source meaning, necessary qualifications and readability taking precedence over soft length targets. It never pads copy to reach the lower target. A correction never falls back to the old mixed-source full-draft or length-repair call. Free-form reviewer issues do not enter article calls because they can contain another article's conditions; only fixed failed-check names are supplied. Reducing duplicate topics to one article also removes the old multi-article overview from the next writing input.

Each detail answers one reader question with one additional concrete point from its own source, rather than listing internal coordination methods. The introduction identifies the actor, date and core event in one short sentence, aiming for 40–70 characters without dropping required scope or conditions. The second paragraph explains the selected point and its necessary qualifications; an explicit source purpose is included there only when it helps explain that point. These are soft structure targets; the policy-selected character safety bounds and two-paragraph checks remain mandatory. A fictional 218-character style example illustrates this structure without introducing real announcement facts. Confirmed actors can be stated explicitly, but a missing actor cannot be borrowed from an adjacent item. Participants, procedural responsibilities, signing dates and announcement dates remain distinct. Omitting a nonessential claim also omits its conditions; retaining a claim requires retaining the qualifications that limit its meaning, including applicable confidentiality, classification and jurisdictional requirements elsewhere in the same document. The actor exploring support must remain distinct from a financing institution whose functions are used; conditions must not be narrowed to statutory requirements without source support. Undefined specialist names do not justify inventing a general definition: omit a nonessential name and explain the documented purpose or role instead. This does not require enumerating conditions for methods the article does not adopt.

Review originals and evidence cards follow the final draft's declared article-index order, even when it differs from collection order. Bodies, hashes, dates and indexes are unchanged; both reviewers receive identical newly assembled projections. This reduces positional confusion without changing selection, interpreting sources for the reviewer or overriding a verdict.

The overview headline describes only one core action from the first selected article, without implying an unsupported sequence of meeting and signing. New isolated overviews are locally limited to 35 headline characters; detail headlines retain their 80-character compatibility limit. Bounded correction receives a numeric headline-length measurement, and the native overview schema repeats the same actor/action scope without unsupported JSON-schema length patterns. Correction-only system directives now follow the general task and example, keeping the existing fixed-vocabulary and measured-length feedback at the end; initial drafting instructions remain unchanged. This ordering is not a factual validator or a guarantee that a model follows the instruction. It must not combine another article's signatory, date or document into a shared event. The overview prose separately states each article's actor, core event and explicit purpose; its quotations verify those selected claims and qualifications rather than supply a list of methods. Both reviewers check the same first-article headline correspondence, event-date precision and separation of the overview from detailed methods. Review input keeps completed headline/summary text only under `draft`; `article_evidence` contains the selected index, unchanged facts/quotes and source reference. Both reviewers identify the exact `draft.headline`, `draft.summary` or `draft.articles[*]` field before reporting an issue, avoiding attribution of a detail title to the overview. This does not relax the factual or editorial checks, and both receive identical newly corrected drafts and complete original bodies. A mocked two-article regression uses different signatories and event dates with the same publication date: a merged headline is rejected without publication, and a newly written correction requires fresh identical-draft review by both providers.

The isolated generator requires a budget-checking provider in both paths. If a two-article draft fails after three Claude calls, a repair needing another three Claude calls stops before spending on it. No approval is reused for a revised draft. Private diagnostic records omit the fact cards and original evidence quotes; they retain chosen public-draft text, redacted review findings, source-reference metadata, safe validation codes and numeric candidate measurements. Original bodies and supporting-document metadata remain private, never part of the public digest. Offline regressions exercise the legal-condition/anniversary mix-up and the simulated 07:59:59 / 08:00 release boundary.

The writer can return `summary` plus **at most two optional complete `summary_alternatives`** in the same bounded response; the normal instruction requests one alternative. Shared source IDs, headline, evidence and selection metadata must validate independently of the alternatives. Code selects the first complete candidate satisfying the policy-selected character safety bounds, paragraph and copy rules, discards the alternatives, and sends only the chosen final draft to both reviewers. It never truncates or stitches candidate prose. If all candidates fail, the same three local stage attempts and unchanged Claude-six/eight-total HTTP caps apply. Rejection cannot silently select an unreviewed alternative. Diagnostic metadata records the selected candidate and measured counts without persisting unused alternatives. This can avoid a length-only repeat request, but increases output tokens per response; no general cost or success-rate improvement is claimed.

Writing instructions preserve the actor, action, object, counted unit and certainty in facts, headlines, details and overview. Agreement to explore cooperation must not become agreement to implement it; confirmed signatures must not be weakened to guesses. The small copy rule checks a fixed list of unexplained terms, including 経済安全保障, 法的拘束力, 法的な拘束力, サプライチェーン, 官民, 覚書, 政策・金融関係機関, 重要鉱物, 政府系金融機関, マクロ経済, 融資, インド太平洋地域, 安全保障上の経済目標, エネルギー安全保障, 共同投資, 戦略的なリスク, グリーン産業, 機密指定, 共同出資, 戦略投資 and 戦略金融. Headlines use everyday wording; necessary terms are explained at first occurrence in each independently readable summary. The initial and correction prompts explicitly list the same fixed headline and first-use glossary vocabulary before the stage task; the terms are code-selected, never supplied by source text or reviewers. It never rewrites the original evidence or automatically substitutes a term. A separate headline-only rule refuses 「初めて」 and 「初の」 because compact headlines repeatedly broadened the first meeting of a named new framework into the first-ever conversation between its participants. A bounded rewrite must change that headline; adding a gloss does not resolve it. A separate narrow check also refuses observed signature-to-dialogue/meeting conjunctions such as 「署名し対話会合を開催」 before buying reviews; a bounded rewrite must choose one core action. This is not a Japanese grammar parser and other multi-action titles still require semantic review. Negated modifiers such as 「署名しない企業向けの説明会を開催」 are not caught. Accurate, qualified first-meeting wording in the article body remains allowed. This checks wording structure, not semantic truth or measured reading age; both final reviews remain mandatory.

### Copy-form adjustment after recovery (2026-10-07)

The local readability validator now recognizes one narrowly defined explanation-first form for 経済安全保障. Its first occurrence in each summary may be immediately preceded by exactly one of 「経済の面から国の安全を守る考え方」, 「経済の面から国の安全を守ること」 or 「経済の面から国の安全を守る」 and enclosed in matching `（経済安全保障）` or `(経済安全保障)`. These fixed phrases are an editorial simplification informed by [the Ministry of Foreign Affairs explanation](https://www.mofa.go.jp/mofaj/ecm/es/index.html), not a verbatim official definition or proof that an article's use is accurate. The usual term-followed-by-explanation form remains preferred.

This exception does not modify generated text or introduce a source/model-supplied glossary. It does not accept partial explanations, mismatched parentheses, an unexplained first use followed by a later gloss, or arbitrary reverse glosses for the other 20 fixed terms. All 21 terms remain prohibited in headlines. The policy-selected character safety bounds, detail paragraphs, evidence checks, finite call budgets and fresh independent Gemini/OpenAI review of the same final draft remain unchanged; an explanation's meaning must still pass both reviewers. Native private tests have exercised this local change, but it is not deployed. A machine-approved rehearsal after recovery was independently rejected for a dropped co-investment qualification; later runs stopped on genuine editorial or validation failures. No unverified or failed draft was published. The current source passes 480 free regression tests; the frozen 456-test recovery snapshot remains separate.

### Historical private failures and earlier successful execution

Before source isolation, three private session runs on 2026-10-05 ended in editorial rejection, eight HTTP calls each, including the Sonnet comparison and compact writer instructions. One draft applied the first document's conditions to a second official release. OpenAI rejected it while Gemini approved. At that stage, evidence separation was unresolved and no run had passed the editorial and simulated release gates together. These are historical failures, not the status of the latest implementation.

Three further private real-AI attempts on 2026-10-05 used ten HTTP calls in total. The first two stopped before reviews at article validation (the second recorded an evidence-quote mismatch). The third used the new passage-ID protocol: article evidence resolved successfully, the second article required a length correction, and both independent reviewers received the same completed draft and source snapshot. Gemini approved, but OpenAI rejected overstatement of proposed cooperation as agreed implementation and unexplained economic-security terminology. Claude four / Gemini one / OpenAI one exhausted the writer-call allowance before repair could begin. No new edition was published, no LINE was sent, and none of those three attempts reached the simulated release gates. Correct passage IDs alone did not establish correct interpretation.

The subsequent bounded editorial rehearsal first stopped at a 311-character overview after four Claude calls. Its second run produced valid lengths (252 and 201 characters for details, 276 for the overview) in three calls, but OpenAI rejected an unverified meeting frequency, an overbroad headline and repeated overview/detail content. The next source-depth revision registers one additional inspected MOF parent/attachment pair: `20260925182036.html` with its actual body link to `JP_MoU.pdf`, the Japanese provisional translation of the finance-ministers dialogue memorandum signed on 2026-10-05. The exact body link, title, signing statement, size, redirect and PDF extraction restrictions remain mandatory; this is not a general PDF crawl. It remains separate from the strategic-financing memorandum signed on October 2. Its verified body provides the annual meeting principle and cooperation period, which must not be inferred from the short introduction alone. The writer allocates core facts before details, uses explicit paragraph/overview length targets, and must not turn a policy goal into the name or achieved effect of an investment. No retry or approval limits were expanded.

The third run in that editorial session used four Claude calls, with details of 243 and 261 characters after one repair, then stopped at a 307-character overview. Neither reviewer was called for that run. All three runs together used 13 provider HTTP calls. Manual comparison also found that its first detail changed approximately 20 participating institutions into approximately 20 people; a valid character count would not have made that draft correct. The original HTML counts policy/financial institutions, not their representatives. The second document supports meetings in principle every year and an initial five-year cooperation period; these remain its own conditions, not conditions shared with the October 2 document. The session reached its three-run limit and erased its keys. No new edition or LINE message was sent, and neither a real-AI simulated release nor actual 08:00 publication succeeded.

### Local saved credentials and historical successful private test

At the owner's explicit request to avoid repeated entry, the loopback-only form has a separate save-only step using native macOS Keychain bindings. The three keys are stored together in one fixed generic-password item, not project files, browser storage, command-line arguments or clipboard. Startup checks presence metadata only; saving does not collect sources or call AI. An explicit test click loads saved keys into a bounded in-memory batch of up to 60 minutes and three runs. Nonces and immutable run records prevent repeated requests from starting the same run twice. Expiry, finish and normal shutdown clear the memory batch and stop its active child, while retaining the Keychain item for later explicit tests. A separate confirmed delete action removes it. The owner handles any Keychain permission dialog. This local facility does not configure the Render server.

The owner saved the keys and started two private tests on 2026-10-05. The first used five HTTP calls (Claude three, Gemini one, OpenAI one); OpenAI rejected unexplained specialist language while factual/date checks passed. The wording rules and term checks were then refined. The explicitly triggered repeat reused the saved keys without another input. The successful record is `work/news-private-final-preview/morning-session-afd5c2f592c54aa3a859a8d5b81f9de7-run-2/completion.json`, with `verified_success: true` and `status: private_rehearsal_passed`; it used **Claude Sonnet 4.6 and five HTTP calls: Claude three / Gemini one / OpenAI one**. The chosen overview was 283 characters and the details were 240 and 288 characters.

Both reviewers approved the same final draft and all nine private checks passed: no generation before cutoff, identical new draft approved by both, unchanged source snapshot, hidden at simulated 07:59:59, ready and visible at simulated 08:00:00, public-checker contract, restart without regeneration, and no original bodies in the public payload. This proves that private execution, not real Render cron execution, exact-time availability or general factual correctness. No new public edition or LINE message was sent. Total for this saved-key session was ten provider HTTP calls across two runs. Live reuse without re-entry was observed. On October 7, native tests also reused the retained Keychain item after a real local server restart without credential input; this confirms local reuse, not Render configuration. The later local website wiring and its 356 mocked/blocked tests added no paid calls.

### Deployment verification

Before enabling this version in production, confirm the required server configuration, model access and agreed spending budget without exposing key values. Do not paste keys into chat, source files, front-end code or GitHub workflow logs. Run the offline collector/selector/producer/runtime/publication checks first, then verify an authorized bounded live run using permitted source bodies. Confirm that both reviews passed for the same final copy, the original source dates are retained, and the edition is withheld before `publish_at` and served after it. Private API connection tests alone do not demonstrate the deployed source window or an actual 08:00 release. Article access and reuse permissions remain separate prerequisites; the extra AI review does not supply missing article bodies or grant publication rights. This change applies to newly generated website editions, not retroactive review of saved human-approved editions or LINE messages.

Official implementation references: [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), checked 2026-10-05.

`.github/workflows/daily-website-news.yml` starts an external wake/check at 04:47 JST, with recovery schedules at 05:47, 06:47, 07:17, 07:47, 08:17 and 09:17 JST. The early wake buffer addresses delayed scheduled runs observed on 2026-10-05; it does not move article collection earlier than 07:00 or spend on AI before 07:30. A job starting at 04:47 stays awake until at least 08:20 (bounded to 240 minutes, job timeout 245 minutes). This public repository uses a standard Ubuntu runner, which is free under [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions); review that choice if the repository becomes private. Manual dispatch is supported. Render owns collection, freezing and publication; the private runner owns generation and review. The public workflow cannot supply arbitrary prompts or dates and uses no secrets. A delayed GitHub cron or sleeping/unavailable free host can still delay preparation; this is an 08:00 target with recovery, not an exact-time availability guarantee.

No new HTTP endpoint was added for this connection. The existing `/api/news-publication` includes operational status and safe `generation_mode`, model IDs and limit metadata, never provider keys or raw responses. **Its ordinary application request hooks intentionally wake background workers.** Fetching it can therefore start eligible collection or generation; it is not a side-effect-free private dry-run endpoint. It accepts no caller-selected date, prompt or force flag. For an inspection that must not wake the application, use the hosting dashboard instead. The new metadata becomes available on Render only after deployment.

The checker confirms a new publication only when the current curated summary is visible. After 08:00 it also accepts an explicit current-day `source_mode: official`, `status: source_empty`, correct cutoff and fixed two-source, error-free result with a healthy public API response as a successfully checked quiet window. It reports that no new AI edition was created and that the earlier publication keeps its real date. This outcome is not a newly published article. Expired unfinished collection slots and corrections awaiting review cannot produce a successful quiet-day result; neither can `source_unavailable`, an unverified state or an HTTP-200 error object. Legacy current-day headlines alone generate one warning while it keeps waiting; if neither a valid current edition nor the explicit empty-window outcome is confirmed before the bounded deadline, the workflow fails.

## Immediate market display

`market_snapshot.py` supplies verified saved prices in the initial HTML (`knInitialMarket`) and through `/api/morning-data` without awaiting Yahoo requests. The server refreshes at most three quotes concurrently in one background job. The frontend displays these values or newer local values immediately, then refreshes independently of news. Each quote retains its original retrieval timestamp; stale values display that timestamp in JST. Snapshots older than seven days are rejected. `market-snapshot.json` is a verified deployment seed, not live or fictional pricing. Runtime snapshots are saved to `MARKET_SNAPSHOT_PATH` (default `/tmp/kn-market-snapshot-v1.json`); ephemeral hosting and a first unseen custom symbol still need a successful upstream refresh. Network delivery and hosting startup remain outside this local cache guarantee.

### Historical reviewed edition: 2026-09-23 (legacy sources)

- Two distinct developments: oil supply/price and the yen. Combined copy 228 characters, detail copy 229 and 232 characters, including line breaks. Market figures explicitly describe the reports' observation times.
- Reuters oil article distributed by [MarketScreener Saudi Arabia](https://sa.marketscreener.com/news/oil-falls-1-on-better-supply-outlook-hopes-for-us-iran-talks-ce785ad9db88f522): first publication 2026-09-23 07:45 +03, or 13:45 JST. Facts and the 04:21 GMT market observation were cross-checked in the complete attributed [Euronext distribution](https://live.euronext.com/en/financial-news/oil-falls-1-better-supply-outlook-hopes-us-iran-talks). The supply restart was on Tuesday; the article and price report are Wednesday's. No completed peace agreement is claimed.
- Reuters currency article distributed by [MarketScreener Hong Kong](https://hk.marketscreener.com/news/dollar-holds-near-2-month-high-as-markets-weigh-rate-hikes-iran-diplomacy-ce785ad9d88ff025): first publication 2026-09-23 09:39 HKT, or 10:39 JST. Full text also verified via the [India distribution](https://in.marketscreener.com/news/dollar-holds-near-2-month-high-as-markets-weigh-rate-hikes-iran-diplomacy-ce785ad9d88ff025), whose first timestamp is 07:09 IST, the same instant. Modification times were not substituted for first publication. Possible intervention is not described as a confirmed action.
- The import-cost/consumer-price mechanism is contextual explanation from the [Bank of Japan's 2026-03-02 speech, section 3](https://www.boj.or.jp/about/press/koen_2026/ko260302a.htm). It is not a third piece of current news. NHK's current RSS and metadata were available but full article text was not verified, so this edition uses two Reuters reports rather than fabricating NHK details.

### Earlier recovered Claude candidate checkpoint (2026-10-07)

The latest completed native rehearsal at this checkpoint was local attempt 58 (session run 18): actual official collection, two verified source bodies, Claude four / Gemini one / OpenAI one HTTP attempts. Gemini approved all checks. OpenAI accepted readability but rejected a factual and certainty change: identifying coordination points that could facilitate meetings had become a confirmed decision to establish coordination windows. No final verified public copy or private 08:00 success was produced. The supported manual-thinking configuration completed actual requests, but this is not approval of the resulting copy. The attempt stopped under its bounded repair-and-review reserve; it did not return a provider credit-balance error.

The fixed writer instructions now distinguish identifying a coordination point from establishing a new window, preserve possibility rather than turn it into a decision, and avoid choosing a nonessential internal procedure just to fill the detail. An independent source comparison confirmed the rejection and a read-only patch audit confirmed that only two fixed instruction passages changed. All 467 free tests passed after this repair (3.382 seconds); the repaired instructions have not yet received a fresh native confirmation. At that checkpoint the observed Claude balance was USD 0.11, insufficient to complete another writing-and-review attempt; the later read-only audit observed USD -0.01. Replenishment, a fresh bounded native check and independent exact-copy editorial review remain required before deployment. Retained macOS Keychain credentials allow later explicit local tests without re-entry. This does not transfer credentials to Render.

The private recent-carryover test uses an actual source collection and a previous-slot fixture, with a simulated upcoming 07:30 cutoff and 08:00 release; it does not reset or modify production attempts, publish a test edition or send LINE. Production remains at the previously verified commit; no new revision was committed, pushed or deployed at this checkpoint.


## Earlier flexible-copy checkpoint before Codex verification — 2026-10-07

At this earlier Claude-only checkpoint the local flexible-copy change had no new real-AI final approval or deployment, and rehearsal 58 remained rejected. The later Codex historical-copy approval above does not turn that earlier rehearsal into a pass or establish current morning eligibility. `flexible-v1` is selected by trusted website code, never an AI draft property; shared/LINE generation and unmarked historical copy retain strict 200–300 bounds. No approved text is truncated, spliced or padded. Both independent reviewers receive the same complete final draft and selected source bodies, with fresh approval mandatory after any change. The private diagnostic handoff also requires the policy version to match both reviews and the final edition while preserving exact text and hashes.

Correction/cost controls below remain a **next implementation plan**, not completed features. The earlier Claude balance observation is historical; the later Codex test made no Anthropic request. Per-HTTP numeric usage and a persistent development monetary budget still need implementation for the remaining paid reviews, reserving fresh final reviews before sending a paid step. If the legacy Claude path is explicitly used, cumulative SSE usage must be updated, not repeatedly summed; retry requests are separate costs. Missing usage or interrupted requests remain unresolved reservations rather than being treated as free. Pricing estimates are not an absolute invoice guarantee, and external production/other-account activity is outside a local-only ledger.

The existing eight-HTTP ceiling can fund the initial two-detail/overview/two-review path (five calls), but a complete two-detail editorial rewrite plus new overview and two fresh reviews requires another five, exceeding eight even without local retries. To reduce repair cost safely, define a strict code-validated review target (selected source index, overview/detail role and fixed failed check with verified evidence references), then retain unaffected drafts and correct only identified targets. Free-form review issues cannot select arbitrary repair scopes. The full revised edition still needs both fresh independent reviews. Do not raise request ceilings or waive reviews as a substitute for cumulative monetary controls.
