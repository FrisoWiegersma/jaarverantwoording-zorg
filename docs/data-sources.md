# Data sources

Public sources that could extend Jaarverslagen Zorg, plus competitors and what can't be had. Researched on 12 November 2026 by web search; rows marked *live* were called and inspected. Check the URL, licence and price of the others before building on them.

**Status:** *live* = called from here on 12 November 2026 and the response inspected · *checked* = an official page confirms the access route · *partial* = found, but details are unclear or the sources conflict · *unchecked* = from memory, not looked up.

**Join key:** the KvK number. LRZa, CIR and the KvK APIs carry it; most other sources can be matched to it.

## 1. Already in use

| Source | What | Access |
|---|---|---|
| [DigiMV archive](https://digimv13.desan.nl/archive/search) | Annual accounts (PDF) and questionnaire per care provider, 2019 on, including WNT executive pay | Public, scraped |
| [LRZa](https://zoeken.zorgaanbiedersportaal.nl/) | Register entry per KvK: legal form, AGB codes, Wtza notification and permit, branches | JSON API behind the public portal (`sources.py`) |
| [CBS Iv3](https://dataderden.cbs.nl/ODataCatalog/Tables) | Accounts and budgets of municipalities, joint arrangements, provinces and water boards per policy area | Free OData (`sources.py`) |
| [Rechtspraak](https://www.rechtspraak.nl/uitspraken/open-data) | Court rulings: phrase search and full text | Site search JSON plus the official CC0 content API (`sources.py`) |
| [open.overheid.nl](https://open.overheid.nl/), [Officiële bekendmakingen](https://www.officielebekendmakingen.nl/), [CVDR](https://lokaleregelgeving.overheid.nl/), [TED](https://ted.europa.eu/) | Woo releases, gazettes and parliamentary papers, local regulations, EU tenders; each hit read as PDF | Each portal's own API (`documents.py`) |
| Any public URL | PDF, Word, HTML or XML read page by page; links on a page listed to reach buried files | `documents.py`, honouring `robots.txt` |
| [data.overheid.nl](https://data.overheid.nl/), [CBS StatLine](https://opendata.cbs.nl/) | Dataset catalogue, CSV/XLSX/JSON files, every CBS table (opendata and dataderden) | CKAN API, file download, OData (`datasets.py`) |
| [Zorginzicht open data](https://www.zorginzicht.nl/algemeen/map/openbare-data) | Quality indicators per care provider and location across sectors, with teller and noemer | `list_links` (for rotating file keys) and `read_table` |
| [NZa Open DIS](https://opendisdata.nza.nl/) | DBC care products per year, specialism and diagnosis, patient counts, average sales price, care activities and reference tables | `read_table` (CSV streamed up to 1 GB; old host rewritten) |
| [Zorgcijfersdatabank](https://www.zorgcijfersdatabank.nl/) | Zvw and Wlz cost tables per sector, GIP pharmacy and medical aids open data | `read_document` (HTML tables) and `read_table` (CSV) |
| [Vektis open data and publications](https://www.vektis.nl/zorgprisma/open-databestanden) | Zvw care costs by municipality and postcode area (CSV), Zorgthermometer and factsheet publications (PDF) | `read_table` (CSV) and `read_document` (PDF) |
| [RIVM StatLine](https://statline.rivm.nl/) (via dataderden) | 104 public health and care tables (ids 50xxxNED, e.g. Kosten van ziekten) behind VZinfo figures | `search_cbs` and `get_cbs` (via `dataderden.cbs.nl`) |
| [CBS site search](https://www.cbs.nl/nl-nl/zoeken) | Server-rendered search across CBS news, maatwerk publications and StatLine tables | `list_links` (honouring `Crawl-delay: 1`) and `read_table` (maatwerk Excel) |
| [Prognosemodel Zorg en Welzijn](https://prognosemodelzw.nl/) | Healthcare and welfare labour-market forecasts via the Swing Open Data Service | `search_swing` and `get_swing` (client ready, needs key) |

## 2. Healthcare, per organisation

| Source | What it adds | Access and cost | Key | Status |
|---|---|---|---|---|
| [CIBG bulk DigiMV dataset](https://data.overheid.nl/en/dataset/jaarverantwoording--jeugd-zorg--verzameld-via-digimv-) | All annual-account data in one file. Since 2023 small providers file too (about 21,000 instead of about 3,500) | Free, CC0, ODS or SPSS file on request from CIBG. Listing last updated 2022 | DigiMV id | partial |
| [LRZa](https://zoeken.zorgaanbiedersportaal.nl/) (Landelijk Register Zorgaanbieders) | Every registered care provider, including small Wmo and youth-care ones | **In use.** JSON API behind the portal (`/api/v1/Organisatie/{kvk}`, `/api/v1/Zoeken`); no bulk export | KvK | live |
| [KvK Handelsregister API](https://developers.kvk.nl/apis/vestigingsprofiel) | Legal form, branches, status | Paid: about €6.20–6.40/month plus about €0.02 per profile; search is free | KvK | checked |
| [IGJ inspection documents](https://igj.nl/publicaties) (toezichtdocumenten.igj.nl) | Inspection reports, formal directions, enforcement | Public PDFs in a Mendix app; its sitemap lists 7,578 publications, but `robots.txt` disallows all crawling. Ask IGJ for an export or permission. The LRZa entry only links to the search page. Fine reports aren't published | Name / KvK | live |
| [Central insolvency register (CIR)](https://www.rechtspraak.nl/registers/webservice-centraal-insolventieregister) | Bankruptcies, suspensions of payment | Free official webservice under a licence agreement, requested from the judiciary | KvK | checked |
| [TenderNed](https://data.overheid.nl/dataset/aankondigingen-van-overheidsopdrachten---tenderned) | Which municipality contracts whom for Wmo and youth care (CPV 85000000) | Free API, CC0, login requested from functioneelbeheer@tenderned.nl | Name / KvK | checked |
| [Zorginzicht open data](https://www.zorginzicht.nl/algemeen/map/openbare-data) | Quality indicators per provider and location per sector and reporting year (OrganisatieNaam, KvkNummer, AGB, indicator, value, teller, noemer) | **In use.** Free Excel downloads via sector pages with rotating keys (`list_links` + `read_table`); later deliveries in ZIP (readable) or 7-Zip (not readable). `robots.txt` allows all | KvK, AGB, name | live |
| [NZa decisions](https://puc.overheid.nl/nza/) | Fines and formal NZa decisions | Public; format not checked | Name | partial |
| [Rechtspraak open data](https://www.rechtspraak.nl/uitspraken/open-data) | Court rulings involving providers (fraud, youth care) | **In use.** Free API, CC0, pseudonymised; name search only through the site's JSON | Name | live |
| Officiële bekendmakingen (KOOP SRU API) | Gazettes and parliamentary papers; see section 2a | **In use** (`documents.py`). Free API | Name | live |
| [Vektis AGB register](https://www.vektis.nl/vektisnl-assets/prd/storage/uploads/AGB/Vraag%20en%20antwoord%20AGB%20Raadpleegdienst.pdf) | AGB codes; the AGB ↔ KvK link | Licence-only (REST API or daily XML). Public search pages block AI agents in `robots.txt` | AGB, KvK | live |
| [rijksfinancien.nl financial instruments](https://www.rijksfinancien.nl/open-data/overzicht-datasets) | Central-government subsidies, grants and loans, with recipient name | Free API, csv/json. Pages disagree on whether it is still updated | Name | partial |
| [Open Raadsinformatie](https://vng.nl/projecten/open-raadsinformatie) | Council documents; see section 2a | Free REST API, unreachable on 12 Nov 2026 | Name | live |
| [open.overheid.nl](https://gitlab.com/koop/woo) | Woo documents; see section 2a | **In use** (`documents.py`). Free API | Name | live |
| [ANBI list](https://belastingdienst.nl/wps/wcm/connect/bldcontentnl/themaoverstijgend/brochures_en_publicaties/open_data_anbi) | Charitable status | Free Excel download, keyed on RSIN only: joining it to a KvK number would mean matching names, which is guessing | RSIN | checked |
| [BIG register](https://www.bigregister.nl/binaries/bigregister/documenten/publicaties/2017/03/03/handleiding-webservice-big-register/Handleiding-webservices-BIG-register-v2.6.pdf) | Registration of individual practitioners | Webservice, per-person lookup only. Low value for organisations; personal data | BIG number | checked |
| Contracted-provider lists | Who is contracted by each insurer (provider finders), Wlz purchasing office and municipality or purchasing region | Scattered across websites; scrape. Valuable because nobody joins them | Name / AGB | unchecked |
| Providers' own websites | Management and supervisory board, quality reports, annual reports outside DigiMV | Scrape | Name | unchecked |
| [Zorgkaart Nederland](https://www.zorgkaartnederland.nl/content/partnerships-en-samenwerkingsverbanden) | Patient reviews | Ask for a partnership; don't scrape | Name | partial |
| Certification registers (HKZ and others) | Quality certificates | Public search | Name | unchecked |
| Parliamentary open data (Tweede Kamer) | MPs' questions and debates mentioning providers; see section 2a | Free OData API | Name | live |
| Trade press (Skipr, Zorgvisie) | News on mergers, governance, incidents | Copyrighted; link, don't copy | Name | unchecked |

## 2a. Document portals: public PDFs that are hard to find

The app's strength is reading PDFs that are public but buried. These portals hold that kind of file, for government bodies rather than care providers. Each was called from here on 12 November 2026.

| Portal | What is in it | Access | Verdict |
|---|---|---|---|
| [open.overheid.nl](https://open.overheid.nl/) (Woo platform, KOOP) | Documents released under the Woo: Woo decisions, beslisnota's, policy notes, advice, budgets, letters. Publishers include VWS (34,145 documents matching "zorg"), NZa (117), Zorginstituut (8), IGJ (5), GGDs, provinces and municipalities | `GET /overheid/openbaarmakingen/api/v0/zoek?zoektekst=…` returns JSON with title, publisher, date, page count and file type (mostly PDF); filters by organisation, document type and category. Spec: [KOOP GitLab](https://gitlab.com/koop/woo) | **Build next.** A phrase in quotes still matched loose word forms ("Basalt" found "basaltzuilen"), so check hits before calling them mentions. **In use** |
| [Officiële bekendmakingen](https://www.officielebekendmakingen.nl/) (SRU, `repository.overheid.nl/sru`) | Gemeenteblad, Provinciaal blad, Waterschapsblad, Blad gemeenschappelijke regeling, Staatscourant, Kamerstukken, Handelingen: subsidy rules, policy rules, decisions | CQL full-text query, XML metadata, documents as XML and PDF. The site's `robots.txt` disallows crawlers, but the SRU is the access route KOOP documents in its [SRU manual](https://data.overheid.nl/sites/default/files/dataset/b1b5e205-7162-48b2-b314-5ce75a94828c/resources/HandleidingSRU2.0.pdf) | **In use.** Loose words must all occur; only `"quoted words"` match as a phrase ("zorg in natura" 9,173 hits, "natura in zorg" 0) |
| [CVDR / lokaleregelgeving.overheid.nl](https://lokaleregelgeving.overheid.nl/) (SRU, `zoekservice.overheid.nl`) | Every municipality's regulations in force: Wmo and youth-care ordinances, rates, policy rules | Same SRU; title and creator queries work (13 Wmo ordinances for Leiden) | **In use.** Every word must occur; no phrase search (checked: word order makes no difference) |
| [Tweede Kamer gegevensmagazijn](https://opendata.tweedekamer.nl/) | Parliamentary documents: letters, motions, amendments, written questions, as PDF | OData v4 with filters, e.g. `contains(Titel,'jeugdzorg')` | Skipped: title search only and some files are .docx; the same letters and questions are in the gazettes as `kst` and `ah` |
| [Open Raadsinformatie](https://vng.nl/projecten/open-raadsinformatie) | Council documents (proposals, budgets, annual accounts, audit-office reports) for 265+ municipalities, text extracted | Elasticsearch API at api.openraadsinformatie.nl; port 443 timed out from this machine and from the homelab | Retry; the most valuable source for municipal PDFs if it is up |
| [organisaties.overheid.nl/woo](https://organisaties.overheid.nl/woo/Gemeenten/) | Per body, where it publishes its Woo documents: often its own site rather than open.overheid.nl | HTML index, linked from [open.overheid.nl/verwijzingen](https://open.overheid.nl/verwijzingen) | A map of sites to crawl, not a source in itself |
| IGJ toezichtdocumenten | Inspection reports per care provider | `robots.txt` disallows all crawling | Ask IGJ (see section 2) |
| [TED](https://ted.europa.eu/) (EU tenders) | Tender and award notices above the EU threshold, including Dutch Wmo, youth-care and health tenders (CPV 85000000), with a PDF per language | Anonymous search API (`POST api.ted.europa.eu/v3/notices/search`) | **In use.** Works without a key; covers what TenderNed would only for the larger tenders |
| Council information systems (`raad.{gemeente}.nl`, `*.bestuurlijkeinformatie.nl`: Notubiz, iBabs) | The council documents Open Raadsinformatie collects, at the source | One site per municipality, a few vendor layouts | **Reachable** with `list_links` for iBabs (`{gemeente}.bestuurlijkeinformatie.nl`, `Crawl-delay: 5` honoured). Notubiz's API disallows all crawling in `robots.txt`; some Notubiz sites answer 500 on robots.txt, so they are not read |
| Health insurers' purchasing policy ([ZN](https://www.zn.nl/), each insurer's site, e.g. [CZ](https://zorginkoopbeleid.cz.nl/)) and Wlz care offices' purchasing framework ([overview 2027–2029](https://www.vgn.nl/system/files/2026-06/Overzicht%20inkoop%20zorgkantoren%202027%20-%202029.pdf)) | What insurers and care offices will buy, under which terms; published every year | PDFs on about ten sites, no central index | **Reachable** with `list_links` then `read_document`; verified start pages are in the tool description (CZ, Menzis, Zilveren Kruis, DSW, Salland/ENO). Menzis wijkverpleging 2027 read end to end in the chat. VGZ, Zorg en Zekerheid and ONVZ paths not found yet; CZ's policy PDFs sit on a separate site (zorginkoopbeleid.cz.nl) |
| [Zorginzicht](https://www.zorginzicht.nl/) quality reports | Nursing-home and district-nursing providers must file the URL of their quality report, per KvK | Sector Excel files | Not found: the files carry KvK numbers and indicators, not the report URL (they link to Zorgkaart pages) |
| Local audit offices (rekenkamers), [NVRR](https://www.nvrr.nl/) library | Audit reports on Wmo, youth care and procurement | Each municipality's site; NVRR and the Vereniging van Rekenkamers keep partial libraries | Mostly reachable through council documents |
| IZA regional plans ([dejuistezorgopdejuisteplek.nl](https://www.dejuistezorgopdejuisteplek.nl/)) | Regional care pictures and plans per region | The domain redirects to [zorgakkoorden.nl](https://www.zorgakkoorden.nl/programmas/integraal-zorgakkoord/iza-onderdelen/regionale-samenwerking/regiobeelden-en-plannen/): one page links 143 PDFs (every region's regiobeeld and regioplan) | **In use** via `list_links`; part of `documents.py check` |
| [NZa decisions (PUC)](https://puc.overheid.nl/nza/) | Policy rules, formal decisions | Server error on 12 Nov 2026, robots.txt too | Retry. NZa's policy rules are also in the Staatscourant (`search_publications`, creator Nederlandse Zorgautoriteit) and its Woo releases on open.overheid.nl |
| Rijksoverheid.nl documents | Reports, letters, publications of the ministries | An open-data API exists, but the endpoints tried returned "Not found" | Covered: Rijksoverheid.nl documents are on open.overheid.nl (Woo) and pages are readable by URL |

The rest of the [open.overheid.nl/verwijzingen](https://open.overheid.nl/verwijzingen) list is these portals plus wetten.overheid.nl (national law) and data.overheid.nl.

**Sweep of 12 November 2026: reachable with `list_links`, `read_document` and `read_table`, no new code.**
- [Vektis](https://www.vektis.nl/zorgprisma/open-databestanden) *(live)*: open-data CSVs (28 files, Zvw costs per care type per postcode area or municipality, sex and age, one per year; 2024 postcode file is 137,768 rows). Filters `{column: [values]}` provide exact matches (a code like 1101 as a query matched 6,091 rows because it hit amounts; filtered on the diagnosis column with year 2024 it matched 68). Zorgthermometer and factsheet PDFs on vektis.nl, whose links contain spaces (now percent-encoded by the app). Gemeentezorgspiegel and other dashboards are Power BI embeds (not readable). The AGB register is licence-only and its robots.txt blocks AI agents on the search pages.
- [organisaties.overheid.nl/woo](https://organisaties.overheid.nl/woo/Gemeenten/) *(live)*: 369 links, where each municipality publishes its Woo documents.
- [Zorginzicht](https://www.zorginzicht.nl/algemeen/map/openbare-data) *(live)*: one page per sector (verpleeghuiszorg, wijkverpleging, MSZ, GGZ, gehandicaptenzorg, geboortezorg, kraamzorg, MSR, Wlz V&V) with Excel files per reporting year. Each file has one row per indicator per location with OrganisatieNaam, KvkNummer, AGB codes, location, IndicatorNaam, IndicatorWaarde, Teller, Noemer. File links are `/services/file/get?key=...`, and the key changes on every page load (an old key still worked after 20+ minutes), so cite the file but fetch the sector page again for a fresh link. Some later deliveries (naleveringen) are ZIP (readable) or 7-Zip (not readable). Quality-report URLs per KvK were not in the files checked (they link Zorgkaart pages). `robots.txt` allows all.
- [Zorgcijfersdatabank](https://www.zorgcijfersdatabank.nl/) *(live)*: cost tables for the Zvw and the Wlz as server-rendered HTML (`infotype=zvw`, `infotype=wlz`), linking to deeper levels (`item=208`, `20801`); `read_document` keeps each table row on one line, cells separated by tabs. GIP open data (pharmacy and medical aids, CSV) at `https://www.zorgcijfersdatabank.nl/algemeen/open-data-gip`, with the same rotating file keys as Zorginzicht. The dashboards (Wlz waiting lists, length of stay, outpatient medicines ranking) are Tableau Public embeds; Tableau's `<view>.csv` export answers 404 behind a captcha, so they are not readable.
- [VZinfo](https://www.vzinfo.nl/) and RIVM StatLine *(live)*: figures come from RIVM StatLine (`statline.rivm.nl/#/RIVM/nl/dataset/{id}`); all 104 tables (ids 50xxxNED, e.g. 50137NED Kosten van ziekten trend 2003-2019) are in `dataderden.cbs.nl`, read by `search_cbs` and `get_cbs`. `statline.rivm.nl`'s own OData paths are disallowed in `robots.txt` and redirect; dataderden is the route.
- [CBS site search](https://www.cbs.nl/nl-nl/zoeken) *(live)*: server-rendered search; `list_links` lists news, maatwerk and StatLine table pages. Maatwerk pages link `.xlsx` files (`read_table`). `robots.txt` has `Crawl-delay: 1`, honoured.
- [Prognosemodel Zorg en Welzijn](https://prognosemodelzw.nl/) and [Waarstaatjegemeente](https://www.waarstaatjegemeente.nl/) *(live)*: data only through the Swing Open Data Service, OData v4 at `https://prognosemodelzw.nl/ods/odata` (Waarstaatjegemeente at `https://www.waarstaatjegemeente.nl/ods/odata`), header `apikey`. A free key per organisation requested via contact form. The app has a client (`search_swing`, `get_swing` in `datasets.py`), enabled by `PMZW_API_KEY` / `WSJG_API_KEY` in `.env`. No key yet. rijksfinancien.nl remains pages only.
- [NZa Open DIS](https://opendisdata.nza.nl/) *(live)*: `opendisdata.nl` no longer resolves; the same files are at `https://opendisdata.nza.nl/download/csv/{name}` (an R Shiny app at `https://opendisdata.nza.nl/` with a downloads tab). Files: `01_DBC.csv` (DBC care products per year, specialism, diagnosis, with patient counts and average sales price; 37 MB, 436,782 rows), `02_DBC_PROFIEL.csv` (care activities per care product; 757 MB), reference tables `03_REF_ZAT.csv` (activities), `04_REF_DGN.csv` (diagnoses), `05_REF_ZPD.csv` (care products), `06_REF_SPC.csv` (specialisms). CC0, refreshed monthly. The data.overheid.nl dataset "open-dis-data" still links the old host; the app rewrites that host to the new one. Codes keep leading zeros (specialism 0303).

**Datasets, not documents.**
- [data.overheid.nl](https://data.overheid.nl/) is a CKAN catalogue (`/data/api/3/action/package_search`): it points to datasets held elsewhere, mostly CBS, and holds little itself.
- [CBS StatLine](https://opendata.cbs.nl/) has 5,986 tables on the same OData stack as Iv3, so a generic table reader is a small step from `sources.py`. An example is 84119ENG (government debt).
- The EU [High-Value Datasets regulation 2023/138](https://eur-lex.europa.eu/eli/reg_impl/2023/138/oj) has required free API and bulk access to statistics and company-register data since June 2024. That is why KvK now has the [open datasets](https://developers.kvk.nl/documentation/open-dataset-jaarrekeningen-api) described in section 3.

## 3. Benchmarks (aggregate, not per organisation)

| Source | What | Access | Status |
|---|---|---|---|
| CBS StatLine | Youth-care monitor, Wmo, health workforce, financial ratios of care institutions | Free OData API, CC-BY | checked |
| [Vektis open data files (Zvw)](https://www.vektis.nl/zorgprisma/open-databestanden) | Care costs by region and type of care, 2011–2024 | **In use.** Free CSVs (`read_table`); publications as PDF (`read_document`). Dashboards are Power BI embeds (not readable); no provider or insurer level | live |
| [openDISdata (NZa)](https://opendisdata.nza.nl/) | Prices, volumes and care activities per DBC care product (`01_DBC.csv`, `02_DBC_PROFIEL.csv`, reference tables) | **In use.** Free CC0 CSVs from `opendisdata.nza.nl/download/csv/{name}` (`read_table`). The old host `opendisdata.nl` no longer resolves; rewritten by the app | live |
| [KvK open dataset annual accounts](https://developers.kvk.nl/documentation/open-dataset-jaarrekeningen-api) | XBRL accounts, last 3 years | Free, CC-BY. A lookup *by* KvK number (`opendata.kvk.nl/api/v1/hvds/jaarrekeningen/kvknummer/{kvk}`), but the response leaves out name and address, and only BVs and NVs are covered: a care foundation got a 404 (IPD7002). Rate limit hit (429) after two calls. Terms forbid tracing it back to a person | live |
| [WNT dataset](https://data.overheid.nl/dataset/wet-normering-topinkomens--wnt--2013--2014-en-2015) | Executive pay above the norm | Free, but only 2013–2015; DigiMV is the better source | checked |

## 4. Other sectors (same engine, new buyers)

| Sector | Source | Access | Status |
|---|---|---|---|
| Municipalities, provinces, water boards, joint arrangements | [CBS Iv3 open data](https://www.cbs.nl/nl-nl/onze-diensten/open-data/iv3): spending per policy area, budgets and accounts | Free OData, CC-BY, current (2025 data refreshed April 2026). Credit "Data van gemeenten … verzameld door het CBS" | checked |
| Central government | [rijksfinancien.nl](https://www.rijksfinancien.nl/open-data/overzicht-datasets): budget tables, annual reports | Free API | partial |
| Schools | [DUO open education data](https://duo.nl/open_onderwijsdata/onderwijs-algemeen/financiele-overzichten/financiele-verantwoording-uit-xbrl.jsp): annual-account data per school board, 2020–2024 | Free; CC0 for higher education | checked |
| Schools | Education Inspectorate reports | Public | unchecked |
| Housing corporations | dVi accountability data (Autoriteit woningcorporaties) | [Open State copy](https://data.openstate.eu/dataset/corpodata-woningcorporaties) covers only 2014–2015; check the Aw site | partial |
| Childcare | [LRK register](https://data.overheid.nl/dataset/gegevens-kinderopvanglocaties-lrk) and GGD inspection reports | Open data | partial |
| Health insurers | [DNB Nationale Staat Zorg](https://www.dnb.nl/media/eu4l3kfv/nationale-staat-zorg-versie-boekjaar-2026.pdf) | Every insurer files one; publication per insurer not confirmed | partial |
| Charities | ANBI list; CBF register | ANBI free; CBF has no bulk export found | partial |
| Companies | KvK open dataset annual accounts | See section 3 | checked |
| EU tenders | TED | Free API | unchecked |

## 5. Commercial data (paid; partner rather than build)

| Vendor | What | Status |
|---|---|---|
| Company.info, Graydon, Creditsafe | Credit scores, directors, group structures | unchecked |

`read_table` reads CSV/TSV, XLSX and JSON members inside ZIP and 7z archives. It lists the available data files when
`member` is needed; summarize the whole archive by reading each member. Filters, sheets, paging and row citations
work as for direct files, and citations reopen the cached original archive. CSV members are limited to 1 GB
uncompressed, XLSX/JSON to 80 MB (including expanded XLSX contents); a 7z archive's total expanded size is capped
at 1 GB because solid compression can require decoding other members. Extraction writes only the selected member
to a bounded temporary file. Encrypted archives, unsafe paths, links, nested archives and old binary XLS files
are unsupported. A related report supplies background, not evidence of an unread archive's contents.

## 6. Not obtainable

| Source | Why |
|---|---|
| UBO register | Access restricted since the 2022 EU court ruling |
| IKZ fraud data, care-fraud warning register | Closed to the public |
| iWmo / iJw billing messages | Never published |
| Insurers' and municipalities' contract prices | Never published |
| NZa claims data (DIS) per provider | Only via a freedom-of-information request |
| CBS microdata (for example BIG 1995–2020) | Only through CBS remote access for approved researchers |
| Dashboards: Vektis (Power BI), Zorgcijfersdatabank (Tableau Public) | Drawn in the browser; Tableau's CSV export is behind a captcha. Not readable |

## 7. Competitors

| Product | Who | What | Audience |
|---|---|---|---|
| [Zicht op Zorgaanbieders](https://vng.nl/nieuws/dashboard-zicht-op-zorgaanbieders-beschikbaar-voor-gemeenten) | VNG, NZa, IGJ, IKZ | Dashboard from annual accounts, KvK data and some non-public sources | Municipal supervisors, free |
| [WaarStaatJeZorgaanbieder](https://www.consultancy.nl/nieuws/45936/waarstaatjezorgaanbieder-geeft-inzicht-in-zorgaanbieders) | TransitiePartners | Liquidity, solvency, equity, staff costs, sickness absence; flags indicators outside the norm | Municipal contract managers |
| [Zorgaanbiedersmonitor](https://www.binnenlandsbestuur.nl/sociaal/van-dam-datapartners/zorgaanbiedersmonitor) | Van Dam Datapartners | Not checked | Municipalities |

None of them seem to answer questions in plain language with a source for every figure, or read the PDFs themselves. That is the edge. The audience they leave less covered is consultants, accountants and banks.

## 8. Suggested order

Done: LRZa, CBS Iv3 and court rulings (`sources.py`).
Done: Zorginzicht, Open DIS, Zorgcijfersdatabank, Vektis, RIVM StatLine and CBS site search through the generic tools; the Swing client waits for a key.

1. open.overheid.nl and the SRU (gazettes, CVDR): public PDFs about the governments consultants advise, through official APIs. The app's PDF reading and citing applies as it is.
2. Open Raadsinformatie, once reachable: council documents per municipality.
3. Email CIBG for the bulk DigiMV dataset, and IGJ for its inspection reports (export or permission).
4. CIR and TenderNed: bankruptcy alerts and who contracts whom, the basis for monitoring.
5. Request the Prognosemodel Zorg en Welzijn (and Waarstaatjegemeente) API key.

## 9. Legal notes

- Re-using public government data is generally allowed, but read each site's terms and keep to reasonable request rates when scraping.
- Personal data (directors' names, individual practitioners, sole traders) falls under the GDPR. Leave it out or keep it minimal.
- Some licences require a credit: CBS, Vektis, and the KvK open datasets (CC-BY).

## 10. Any company: public financial and legal sources

Probed from here on 12 November 2026. *Reachable* means the current tools (`search_*`, `list_links`, `read_document`, `read_table`) can already get it; *new source* means it needs its own finder.

| Source | What | Access | Status |
|---|---|---|---|
| KvK deposited annual accounts | The accounts every BV/NV/cooperative files | Full PDFs paid per document. The free HVD open dataset (`opendata.kvk.nl/api/v1/hvds/jaarrekeningen/kvknummer/{kvk}`) covers BV/NV only, without name or address, and rate-limits (429) after a few calls | live; partial |
| KvK basic company data (HVD) | Status, legal form, start date, insolvency, SBI and postcode region per KvK, BV/NV only, no name or address | Same open-data API, one request per minute per IP | connected: `get_kvk_basics` |
| [GLEIF LEI](https://api.gleif.org/api/v1/lei-records) | Legal name, address and **parent/child relationships** for 200,896 Dutch entities with an LEI | Free JSON API, CC0 | live; new source |
| [filings.xbrl.org](https://filings.xbrl.org/) | Annual reports of listed companies in ESEF/XBRL, keyed by LEI | Free JSON API | live; new source |
| AFM registers | Substantial holdings, licences, warnings, fines | Public pages; robots.txt allows | live; reachable |
| DNB registers | Licences and enforcement of banks, insurers, pension funds | robots.txt answers 403 | live; check |
| ACM decisions and fines | Cartel and consumer fines, merger decisions | Pages load, but robots.txt disallows all crawling: not read. An old dataset "Overzicht boetes nav kartels" (2020) is on data.overheid.nl | live; ask ACM |
| Autoriteit Persoonsgegevens fines | GDPR fines | robots.txt disallows all | live; blocked |
| Arbeidsinspectie, NVWA | Inspection results, fines | robots.txt allows; NVWA publishes inspection results by law | live; reachable |
| Central insolvency register | Bankruptcies, suspensions, administrators' reports | Website lookup free; the webservice needs a licence (section 2) | live; licence |
| Rechtspraak | Rulings, including the Enterprise Chamber | In use | live |
| Government money to a company | EU tenders and awards (TED, in use), municipal subsidy registers (28 on data.overheid.nl, e.g. Utrecht, Breda), SDE++ and RVO projects database, central-government financial instruments | `search_tenders`, `search_datasets` + `read_table` | live; reachable |
| WNT executive pay | Semi-public sector top incomes | DigiMV for care; older WNT datasets on data.overheid.nl (2013–2018) | live; partial |
| [EU sanctions list](https://webgate.ec.europa.eu/fsd/fsf/) | Sanctioned persons and companies | Free CSV (25 MB) | live; new source |
| [OpenSanctions](https://www.opensanctions.org/) | Sanctions, PEPs and watchlists combined | Free for non-commercial use; a commercial licence otherwise | live; licence |
| Gazettes, Woo, regulations | Permits, enforcement decisions, Woo releases naming a company | In use | live |
| UBO register | Ultimate beneficial owners | Closed to the public since the EU Court ruling of 22 Nov 2022 | unchecked; not obtainable |
| Kadaster | Property ownership | Paid per lookup | unchecked; paid |
