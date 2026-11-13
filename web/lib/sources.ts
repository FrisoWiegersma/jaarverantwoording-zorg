export type SourceGroup = "zorg" | "cijfers" | "recht" | "open";

/** What the chat can read, for the welcome screen. Keep in step with the tools in app/api/chat/route.ts. */
export const SOURCES: { name: string; what: string; group: SourceGroup }[] = [
  { name: "DigiMV", what: "Jaarverslagen, jaarrekeningen en de vragenlijst van zorgorganisaties, 2019 tot nu", group: "zorg" },
  { name: "Zorgaanbiedersregister (LRZa)", what: "Toelatingsvergunning, Wtza-melding, vestigingen en AGB-codes", group: "zorg" },
  { name: "CBS Iv3", what: "Lasten en baten van gemeenten, regio's en provincies per taakveld, 2010 tot nu", group: "cijfers" },
  { name: "CBS StatLine", what: "Alle CBS-tabellen, zoals Wmo-cliënten en jeugdhulp per gemeente", group: "cijfers" },
  { name: "RIVM StatLine en VZinfo", what: "Volksgezondheid en zorg, zoals kosten van ziekten", group: "cijfers" },
  { name: "Zorginzicht", what: "Kwaliteitsindicatoren per zorgaanbieder en locatie, op KvK-nummer", group: "zorg" },
  { name: "NZa Open DIS", what: "DBC-zorgproducten, patiëntaantallen en gemiddelde verkoopprijzen", group: "zorg" },
  { name: "Vektis", what: "Zorgkosten per gemeente en postcode, Zorgthermometer en factsheets", group: "zorg" },
  { name: "Zorgcijfersdatabank", what: "Kosten van de Zvw en de Wlz per zorgsoort, en GIP-data", group: "zorg" },
  { name: "Prognosemodel Zorg en Welzijn", what: "Arbeidsmarktprognoses voor zorg en welzijn (met API-sleutel)", group: "cijfers" },
  { name: "KVK Handelsregister", what: "Status, rechtsvorm, startdatum en SBI-code van BV's en NV's, op KvK-nummer", group: "recht" },
  { name: "Rechtspraak", what: "Gepubliceerde uitspraken, op naam te doorzoeken", group: "recht" },
  { name: "Woo-index", what: "Woo-besluiten, nota's en rapporten van de overheid", group: "recht" },
  { name: "Officiële bekendmakingen", what: "Gemeenteblad, Staatscourant en Kamerstukken", group: "recht" },
  { name: "Lokale regelgeving", what: "Verordeningen en beleidsregels, met wat nu geldt", group: "recht" },
  { name: "Europese aanbestedingen", what: "Aankondigingen en gunningen op TED", group: "open" },
  { name: "data.overheid.nl", what: "Open datasets, zoals subsidieregisters, als CSV of Excel gelezen", group: "open" },
  { name: "Elke openbare link", what: "PDF's en webpagina's van verzekeraars, regio's en gemeenten", group: "open" },
];

/** Real questions, shown one per group on the welcome screen and typed into the empty prompt. */
export const QUESTIONS: { group: string; questions: string[] }[] = [
  {
    group: "Zorgaanbieders",
    questions: [
      "Wat was de omzet van het LUMC in 2025?",
      "Hoe groot was het resultaat van Stichting Basalt in 2025, vergeleken met het jaar ervoor?",
      "Hoeveel fte heeft elk UMC in 2025?",
      "Heeft Stichting Basalt een toelatingsvergunning, en welke vestigingen en AGB-codes staan in het register?",
      "Zijn er rechtszaken waarin Stichting Basalt wordt genoemd, en waar gingen ze over?",
      "Welke kwaliteitsindicatoren leverde Stichting Basalt over 2024 aan bij Zorginzicht?",
    ],
  },
  {
    group: "Gemeenten en regio's",
    questions: [
      "Wat gaf Leiden in 2025 uit aan Wmo-begeleiding?",
      "Hoeveel Wmo-cliënten met een maatwerkvoorziening had Leiden in 2024 volgens het CBS?",
      "Hoeveel jeugdhulp liep in 2025 via de regio Holland Rijnland, en hoeveel boekte Leiden zelf?",
      "Welke Wmo-verordening en beleidsregels heeft Leiden nu in werking, en wat staat er over het pgb-tarief?",
      "Welke jeugdzorgopdrachten zijn sinds 2024 Europees aanbesteed in Zuid-Holland, en wie won ze?",
      "Hoeveel Zvw-zorgkosten per verzekerde had Leiden in 2024 volgens Vektis, en hoeveel daarvan was wijkverpleging?",
    ],
  },
  {
    group: "Documenten",
    questions: [
      "Wat staat er in het zorginkoopbeleid wijkverpleging 2027 van Menzis over tarieven?",
      "Wat zegt het IZA-regioplan van Zuid-Holland Noord over wijkverpleging en personeelstekort?",
      "Wat schreef de minister in Kamerbrieven over reële tarieven in de jeugdzorg?",
      "Welke Woo-besluiten publiceerde de NZa over wijkverpleging?",
      "Welke organisaties kregen in 2025 de grootste subsidies van de gemeente Utrecht?",
      "Hoeveel kostte de Wlz-gehandicaptenzorg in 2025 volgens de Zorgcijfersdatabank?",
    ],
  },
];

/** Every question, the groups interleaved, so the typewriter shows a mix. */
export const EXAMPLES = QUESTIONS[0].questions.flatMap((_, i) => QUESTIONS.map((g) => g.questions[i]));
