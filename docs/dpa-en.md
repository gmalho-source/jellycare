# Data Processing Agreement

> **Template.** Fields in `[ ]` are completed per contract. `[to confirm]`
> marks legal facts that must be verified with the vendor before first use —
> do not invent them.
>
> This template describes what Jellycare actually does. Annexes I to III
> describe the system as deployed, not as intended: the retention periods in
> Annex I are the ones `packages/db/src/retention.ts` enforces daily, and
> Annex III lists the services the platform actually calls. **When the
> infrastructure changes, the annexes change with it** — which is why they
> live in this repository and not in a contracts folder.
>
> This is the English counterpart of `docs/dpa-pt.md`. It is drafted on the
> GDPR, which is the right basis for EU clients and for UAE clients who
> offer goods or services into the EU or monitor behaviour there. For a UAE
> client with no EU nexus, the applicable regime is Federal Decree-Law No. 45
> of 2021 (or DIFC DP Law 2020 / ADGM DPR 2021 if the client is established
> in one of those free zones), and the clauses on supervisory authorities,
> international transfers and governing law have to be reworked accordingly.
> That reworking is a decision for counsel, not a translation exercise.
>
> To be reviewed by legal counsel before first signature.

---

## Parties

**Controller** (the "Client")
[LEGAL NAME], [company number], registered at [ADDRESS], represented by
[NAME], [TITLE].

**Processor** ("Jelly")
[JELLY LEGAL NAME], [company number], registered at [ADDRESS], represented by
[NAME], [TITLE].

Together, the "Parties".

## Background

1. On [DATE] the Parties entered into an agreement for website maintenance,
   monitoring and surveillance services (the "Main Agreement"), delivered
   through the Jellycare platform.
2. Performing the Main Agreement requires Jelly to process personal data for
   which the Client is the controller.
3. This Agreement gives effect to Article 28(3) of Regulation (EU) 2016/679
   ("GDPR") and forms an annex to the Main Agreement.
4. Where this Agreement and the Main Agreement conflict on data protection
   matters, this Agreement prevails.

---

## 1. Definitions

"Personal data", "processing", "controller", "processor", "data subject",
"personal data breach" and "supervisory authority" have the meanings given in
Article 4 GDPR.

"Sub-processor" means any entity engaged by Jelly to process personal data on
behalf of the Client under Article 28(2) GDPR.

## 2. Subject matter, nature, purpose and duration

1. The subject matter, nature and purpose of the processing, the categories of
   personal data and data subjects, and the retention periods are set out in
   **Annex I**.
2. Processing lasts for the term of the Main Agreement and ends with it,
   subject to Clause 11.
3. Jelly processes personal data solely to perform the Main Agreement. It does
   not process the data for its own purposes, does not disclose it to third
   parties beyond this Agreement, and does not use it to train models, build
   profiles, or feed any product other than the contracted service.

## 3. Documented instructions

1. Jelly processes personal data only on the Client's documented instructions,
   including those in the Main Agreement, this Agreement, and the settings the
   Client enters in the platform.
2. The Client's documented instructions include, in particular: the sites
   nominated for monitoring, the declaration of pages whose forms may be
   submitted for testing, the nomination of alert and report recipients, and
   the granting of access to the dashboard and the client portal.
3. Jelly informs the Client immediately if it considers an instruction to
   infringe the GDPR or other data protection law, and may suspend that
   instruction pending clarification.
4. Where Union or Member State law requires Jelly to process beyond the
   Client's instructions, Jelly informs the Client before processing, unless
   that law prohibits such information on important grounds of public
   interest.

## 4. Ownership verification and limits of monitoring

1. The Client warrants that it owns the nominated sites or is authorised by
   their owner.
2. Jelly runs security checks against a domain only after ownership has been
   proven, by DNS TXT record or by a file placed on the server. Until then,
   the site is monitored for availability only, by observing what any visitor
   would see.
3. Jelly performs no intrusive testing, does not attempt to bypass
   authentication, and does not exploit vulnerabilities: collection is
   passive.
4. Login, registration, payment, checkout, subscription and search forms are
   never submitted automatically. Only forms located on pages expressly
   declared by the Client are submitted, up to the limit configured in the
   platform.

## 5. Confidentiality

1. Jelly ensures that persons authorised to process the personal data have
   committed themselves to confidentiality or are under an appropriate
   statutory obligation of confidentiality.
2. Access is limited to personnel who need it to perform the Main Agreement.
3. The confidentiality obligation survives termination of the Main Agreement
   indefinitely.

## 6. Security of processing

1. Jelly implements the technical and organisational measures described in
   **Annex II**, appropriate to the risk, in accordance with Article 32 GDPR.
2. Jelly may change those measures provided the level of security is not
   reduced, and informs the Client of material changes.

## 7. Sub-processors

1. The Client authorises Jelly to engage the sub-processors listed in **Annex
   III** (specific authorisation) and to engage others under the paragraphs
   below (general authorisation).
2. Jelly gives the Client at least **30 days'** notice of any intended
   addition or replacement of a sub-processor.
3. The Client may object in writing within that period on reasonable data
   protection grounds. Failing agreement, either Party may terminate the
   affected services under the Main Agreement without penalty on 30 days'
   notice.
4. Jelly imposes on each sub-processor, by contract, data protection
   obligations no less onerous than those in this Agreement, and remains
   fully liable to the Client for that sub-processor's performance.

## 8. Data subject rights

1. Taking into account the nature of the processing, Jelly assists the Client
   by appropriate technical and organisational measures in responding to
   requests to exercise the rights in Chapter III GDPR.
2. Jelly notifies the Client within **five business days** of any request it
   receives directly from a data subject concerning data processed on the
   Client's behalf, and does not respond to it independently unless instructed
   by the Client or required by law.
3. The platform allows the Client to delete a site and its data, and to remove
   individual access, directly.

## 9. Personal data breaches

1. Jelly notifies the Client **without undue delay and in any event within 24
   hours** of becoming aware of a personal data breach affecting data
   processed on the Client's behalf.
2. The notification includes, so far as available: the nature of the breach,
   the categories and approximate number of data subjects and records
   affected, the likely consequences, the measures taken or proposed, and a
   contact point. Information not available at the time is provided in
   phases as it is established.
3. Jelly does not notify the supervisory authority or data subjects on its own
   initiative in respect of data processed on the Client's behalf, unless
   required by law in its own right; that decision rests with the Client.

## 10. Assistance to the Client

Taking into account the nature of processing and the information available to
it, Jelly assists the Client in complying with its obligations under Articles
32 to 36 GDPR, including security, breach notification, data protection
impact assessments and prior consultation with the supervisory authority.

## 11. Deletion or return of data

1. On termination of the Main Agreement, at the Client's written election
   given within 30 days, Jelly returns the personal data in a structured,
   commonly used format, or deletes it.
2. Absent an election within that period, Jelly deletes the data.
3. Deletion is completed within **90 days** of termination, including backups,
   save where storage is required by law, which Jelly identifies to the
   Client.
4. During the term, the retention periods in Annex I apply and are enforced
   automatically by the platform.

## 12. Audit

1. Jelly makes available to the Client all information necessary to
   demonstrate compliance with this Agreement.
2. The Client may conduct audits, including inspections, itself or through an
   independent auditor it mandates and who is bound by confidentiality, on
   **30 days'** notice, no more than once per calendar year, during business
   hours and without disproportionate disruption to Jelly's operations. These
   limits do not apply following a confirmed personal data breach or an order
   of a supervisory authority.
3. Jelly may discharge its information duty through certifications,
   independent audit reports or applicable codes of conduct, where these
   address the scope of the intended audit.

## 13. International transfers

1. Data is processed within the European Economic Area, except as stated in
   Annex III.
2. Where data is transferred to a third country without an adequacy decision,
   Jelly ensures appropriate safeguards under Article 46 GDPR, in particular
   Standard Contractual Clauses, supported by a transfer impact assessment and
   supplementary measures where required.
3. Annex III identifies, for each sub-processor, the location of processing
   and the applicable transfer mechanism.

## 14. Liability

1. Liability between the Parties is governed by Article 82 GDPR and by the
   liability regime of the Main Agreement.
2. No limitation of liability in the Main Agreement applies to damage caused
   to data subjects or to fines imposed by a supervisory authority for a
   matter attributable to the responsible Party.

## 15. Term, governing law and jurisdiction

1. This Agreement takes effect on signature and remains in force for as long
   as the processing continues.
2. It is governed by [the law of Portugal / the law of [JURISDICTION]].
3. The courts of [JURISDICTION] have exclusive jurisdiction.

[PLACE], [DATE]

For the Client: ______________________
For Jelly: ______________________

---

# Annex I — Description of the processing

## Subject matter

Monitoring, surveillance and preventive maintenance of the websites nominated
by the Client, covering availability, certificates, security headers,
reputation, contact form integrity, WordPress component inventory and known
vulnerabilities, and periodic reporting.

## Nature of the processing

Collection, recording, organisation, storage, retrieval, use, transmission to
the recipients nominated by the Client, and erasure.

## Purpose

Performance of the Main Agreement: detecting outages, security weaknesses and
form delivery failures on the Client's sites, alerting the people the Client
nominates, and accounting for the service delivered.

## Categories of data subjects

| Category | Source |
|---|---|
| Client staff and representatives with dashboard or portal access | Nominated by the Client |
| Recipients of alerts and monthly reports | Nominated by the Client |
| Third parties whose personal data incidentally appears in publicly accessible content of the monitored site | Technical collection |

## Categories of personal data

| Category | Detail | Table |
|---|---|---|
| Identity and contact | Email address; name, where provided | `users` |
| Access data | Role, creation date, single-use sign-in tokens, sessions | `memberships`, `login_tokens`, `sessions` |
| Notification recipients | Email address or webhook URL, minimum severity, status | `notification_targets` |
| Report recipients | Email addresses per site | `sites.report_recipients` |
| Delivery records | Timestamp, success or error | `notification_deliveries` |
| Site technical data | URL, hostname, platform, declared pages, components and versions | `sites`, `wp_components` |
| Check results | Status, duration, warnings, errors returned by external services | `check_runs`, `uptime_samples`, `findings` |
| Form tests | Canary token, canary address, timings, SPF/DKIM/DMARC results | `form_runs` |

**No special categories** of data within the meaning of Article 9 GDPR are
processed, nor criminal conviction data. Jelly does not collect data about
visitors to the monitored sites: it installs no measurement tags, does not
read the Client's traffic logs, and does not access the site's databases.

**Test submission content is not retained.** A submission contains only canary
values generated by the platform and a unique token. The platform stores no
message bodies and no page screenshots — an automated test fails on the day
anyone starts storing them without adding the corresponding erasure.

## Retention periods

Enforced daily by the automated retention process
(`packages/db/src/retention.ts`):

| Data | Period |
|---|---|
| Check runs, availability samples, form submissions, notification delivery records | 90 days |
| Monthly reports and resolved findings | 24 months |
| Sign-in tokens and sessions | Erased the moment they expire |
| Open findings | Retained while open — never erased by age |
| Account and configuration data | For the term of the Main Agreement |

---

# Annex II — Technical and organisational measures

## Access control

- Passwordless authentication by single-use sign-in link sent to the email
  address, invalidated immediately on first use.
- Segregation by organisation: a user reaches only their own organisation's
  sites, enforced server-side on every request.
- Separate roles for team and client. The client role reaches no
  configuration, no credentials and no verification tokens.
- Production secrets held in the hosting provider's vault, never in source;
  third-party tokens never appear in error messages or logs.

## Communication and storage security

- HTTPS only, with forced redirection.
- Database and queue reached over encrypted connections.
- Encryption at rest provided by the hosting and database providers.

## Minimisation

- Passive collection: the platform observes what any visitor would see and
  performs no intrusive testing.
- Domain ownership proof required before any security check.
- Form submission limited to pages declared by the Client, with permanent
  exclusion of login, registration, payment, checkout, subscription and
  search forms.
- The crawler honours `robots.txt` and identifies itself as
  `JellycareBot/1.0 (+https://jellycare.pt/bot)`.
- Automated daily erasure on the periods in Annex I.

## Resilience and continuity

- Managed hosting with redundancy and automated backups.
- Database migrations applied by a single process, preventing concurrent
  execution.
- Self-monitoring of the platform and run logging.

## Development process

- Version control with review before integration.
- Static typing, static analysis and an automated test suite as a condition of
  integration.
- **No release reaches production without a green test suite** — the
  dependency is declared in the delivery pipeline, not left to convention.

## Organisation

- Confidentiality undertakings from personnel with access.
- Access granted on a need-to-know basis and revoked when duties end.
- Incident logging and classification, with the notification procedure in
  Clause 9.

---

# Annex III — Authorised sub-processors

List as at [DATE]. Jelly notifies the Client of any change on the notice
period in Clause 7.

| Sub-processor | Service | Data accessed | Location of processing | Transfer mechanism |
|---|---|---|---|---|
| **Fly.io** ([entity to confirm]) | Application and collection process hosting | All data in transit and in memory during execution | Frankfurt, Germany (`fra`) | Not applicable (EEA) — [confirm contracting entity and any US-based support access] |
| **Neon** ([entity to confirm]) | Database | All stored data | [region to confirm] | [to confirm] |
| **Upstash** ([entity to confirm]) | Job queue | Site identifiers and check types; no contact data | [region to confirm] | [to confirm] |
| **Resend** ([entity to confirm]) | Sending alerts and reports, and receiving test messages in the canary inbox | Email addresses of the recipients nominated by the Client, and the content of messages sent | [to confirm] | [to confirm — Standard Contractual Clauses likely required] |
| **Cloudflare** ([entity to confirm]) | DNS and network layer | Traffic metadata, including IP addresses of dashboard and portal users | [to confirm] | [to confirm] |
| **WP Umbrella** ([entity to confirm]) | WordPress component inventory and known vulnerabilities | Site hostname, installed plugins, themes and versions | [to confirm] | [to confirm] |

**Note on the WordPress chain.** The vulnerability data presented by WP
Umbrella originates, wholly or in part, from a third-party database
(Patchstack). That entity is a sub-processor of WP Umbrella, not of Jelly; the
Client may consult WP Umbrella's own data processing agreement for that chain.
This row applies only where the Client's site runs WordPress and is linked to
a WP Umbrella project.

**Note on the limits of this annex.** The `[to confirm]` markers are
deliberate: each vendor's contracting entity, processing region and transfer
mechanism must be read from its own data processing agreement before this
annex is put in front of a client. An annex with the wrong location is worse
than an incomplete one.
