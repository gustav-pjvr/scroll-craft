# Subjects: what an event, a nonprofit, a portfolio, or a case study needs

Step 0's eight questions cover any subject. This file is what SKILL.md points
you to once question 1 tells you the subject is one of the five below: extra
questions to fold into the same interview pass, and what the page has to
carry functionally that a product or service page does not. Read the section
that matches; skip the rest.

The hard rule underneath all five: **no invented numbers, ever.** taste.md
already bans this for a stat counter; it applies here to attendance figures,
donation totals, impact claims, and outcomes just as hard. Real numbers with
a source, or no number.

---

## Events

**Extra questions**, asked in the same Step 0 pass:

- The real date and start time, and the time zone it is stated in, or "not
  announced yet" (see "Date not yet announced" below).
- The venue, or the platform if it is online, and the address or the link.
- The registration platform (Eventbrite, Luma, a ticketing system the client
  already uses) and its URL.
- Real capacity, if there is one, or "open" if there is not.
- Where the schedule comes from, so the page can be regenerated when it
  changes rather than hand-edited and drifting from the real one.

**What the page needs:**

- An `Event` JSON-LD block: name, start and end date-time with the time
  zone, location, and (when it exists) an `offers` block pointing at the
  real registration URL rather than a price the page invents.
- The schedule as a real `<table>` (multi-track) or `<dl>` (single-track),
  with the time zone stated once and applied to every row, never buried in a
  tooltip. A schedule the page cannot show without JavaScript is a schedule
  half the visitors cannot read.
- An `.ics` download link generated from the same data that fills the
  schedule and the JSON-LD. Three sources of truth for one date is how an
  event page ends up wrong on the actual day.
- Registration as a real link or the platform's own embed. Never a
  home-built payment or RSVP form; see Forms below for why.
- A countdown only if the date is real, using the `count` device from
  devices.md §7. A countdown to a date nobody confirmed is a lie with a
  timer on it.

The JSON-LD, `.ics` and countdown bullets apply once a date is announced.
Until then, the page follows the path below instead.

### Date not yet announced

A recurring event between editions, or a first edition still being planned,
often has no confirmed date. That is an honest state, and the page says so
rather than implying a date it does not have. The first real build was
exactly this (a marathon whose next edition read "Date: TBD" on the
organisers' own registration page), and the skill had no path for it.

- **No Event JSON-LD for the unannounced edition.** Structured data with a
  guessed or placeholder date is a false claim that search engines repeat.
  A past edition's Event JSON-LD (on a results page, with its real date,
  time and time zone) is an archive record and may stay; `site-check.mjs
  --date-tba` exempts a past date and flags any current or future one.
- **No `.ics`, no countdown, no "save the date".** There is no date to put in
  any of them.
- **An honest TBA line**, stated plainly where a date would otherwise sit:
  in the hero or the first screen, and again at the close. "Date to be
  announced" is enough; do not dress it up as "coming soon" or imply a month
  the client has not confirmed.
- **An updates route that really exists**: the organiser's newsletter or
  mailing list, the registration page that will open, the official social
  account where the date will be posted. Link to it as the primary CTA with a
  label that says what it is ("Registration, not open yet" worked on the
  first build). If no such route exists, say where the announcement will
  appear and do not invent a sign-up form.
- **Past editions labelled as past.** Schedules, distances and start times
  from a previous edition may appear, marked with their year ("as run in
  2026"), never presented as the next edition's.
- **Record it in BRIEF.md.** The subject block says "Date: to be announced"
  and names the updates route. Run `site-check.mjs` with `--date-tba`, or
  with `--brief <path>` to BRIEF.md so it reads the TBA state from that line.
  It then asserts the absence of fake date claims (no current or future Event
  JSON-LD, no `.ics` link, no countdown) and that at least one page says the
  date is to be announced, instead of demanding the JSON-LD and the `.ics`.
  It recognises a countdown by `data-sc-countdown` or an id or class naming
  one, so name any countdown-like element honestly.

When the date is announced, the page switches to the full list above: the
JSON-LD, the `.ics` and the schedule all come from the one data source, on the
same day. Without `--date-tba`, site-check requires every Event `startDate`
to carry a time and a time zone and flags any that is already in the past,
archive records included, so take a past edition's JSON-LD off when the new
date goes up.

**Grammar leanings:** rhythmic cutlist (the pulse of an announcement) or
filmic one-shot (the single-argument case for attending). Both are leanings,
not requirements; uniqueness.md's gate still applies.

---

## Nonprofits

**Extra questions:**

- The mission, in the organisation's own words, not a paraphrase into
  marketing prose.
- The donation platform (a link or an embed the org already uses, such as
  Givebutter, PayPal Giving, or a payment processor they have an account
  with) and its URL.
- Any impact facts the org can source: an annual report, a funder's report,
  an audited figure. If none exists, the answer is "we do not have a sourced
  number yet," and that is the honest state of the page.
- Transparency links that exist: an annual report, a registration or charity
  number, a board or governance page.

**What the page needs:**

- Donations as a link to, or an embed of, the real platform. Never a
  home-built payment form: a nonprofit's donation flow touches money and
  personal data, and this skill does not build either.
- Impact facts only with a source the page can cite. **No invented impact
  stats, no counter without a sourced figure.** This restates SKILL.md's
  hard rule specifically because a nonprofit brief is the one most tempted
  to round a hopeful number up into a headline stat.
- Transparency links wherever they exist, treated as real navigation, not a
  buried footer line.

**Grammar leanings:** chaptered editorial (the mission read as substance) or
split stage (before and after the org's work, when that comparison is
honest and sourced).

---

## Portfolios and creators

**Extra questions:**

- The work list: title, medium, year, and a link for each piece that has
  one.
- The one contact route the person actually wants used (not "all of the
  above"; pick one and make it the CTA).
- Social links, if any, and which ones matter enough to be on the page.
- Whether the person is currently available for work, and if that answer
  will go stale, how they want it kept current.

**What the page needs:**

- A gallery schema: the same label fields for every piece (title, medium,
  year, link), applied without exception. The schema is what turns a set of
  images into a collection instead of a grid; devices.md §6's Gallery /
  catalog grammar already states this for the label copy itself.
- The one contact route as the primary CTA, used with the same label
  everywhere it appears on the page.

**Grammar leanings:** gallery / catalog for a body of discrete work,
typographic poster for a person whose real asset is a strong verbal
identity and thin visual portfolio.

---

## Case studies

**Extra questions:**

- The client's name, and explicit permission to use it. No permission means
  an anonymised description, said plainly as anonymised, not dressed up as a
  named client.
- The problem, in one or two sentences.
- The approach: what was actually done, not a list of capabilities.
- The outcome, with real numbers if they exist and none if they do not.
- Who can be quoted, and their exact words, with permission to publish them
  verbatim. Do not paraphrase a quote into something punchier; that is
  inventing a testimonial with extra steps.

**What the page needs:**

- The problem, approach, outcome shape from site.md §2, in that order.
- `Article` JSON-LD: headline, author or organisation, date, and the client
  name only when permission was given.
- A verbatim quote, attributed, only when the person actually said it and
  agreed to its use on the page.

**Grammar leanings:** chaptered editorial for the read-it-like-a-report
feel, split stage for a genuine before-and-after comparison.

---

## Forms

Applies to any form on any subject: contact, registration interest,
inquiry, sign-up. The static-hosting route is a Cloudflare Pages Function or
a form service the client already uses (their existing CRM's form endpoint,
for instance). This skill never fakes a backend.

- **Never display success the page cannot confirm.** A form that shows a
  thank-you state on submit regardless of what the server did is the exact
  shape of approved-collection.md §7's warning against false success.
- **Submit without JavaScript to a real endpoint via POST.** A disabled
  scripted form must not fall back to a GET request, because a GET puts
  whatever the visitor typed, including a name, an email, or a phone
  number, directly in the URL: in browser history, in server logs, and in
  the referrer header of whatever the visitor clicks next.
- **If no real backend exists, the form is a `mailto:` link**, and BRIEF.md
  says so plainly. A `mailto:` link that says "we'll get back to you" when
  nothing is actually wired up is the same false-success failure with a
  different mechanism.

`site-check.mjs` checks the mechanical half of this rule on every page of a
site build: every `<form>` has `method="post"` and an `action` that is not
the page itself, and no `<form method="get">` contains an input whose type
or name looks like personal data. See [site.md](site.md) and
[verify.md](verify.md).
