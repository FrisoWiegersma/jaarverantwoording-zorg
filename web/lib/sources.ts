/** What the chat can read, for the welcome screen. Keep in step with the tools in app/api/chat/route.ts. */
export const SOURCES: { name: string; what: string }[] = [
  { name: "DigiMV", what: "Jaarverslagen, jaarrekeningen en de vragenlijst van zorgorganisaties, 2019 tot nu" },
  { name: "Zorgaanbiedersregister (LRZa)", what: "Toelatingsvergunning, Wtza-melding, vestigingen en AGB-codes" },
  { name: "CBS Iv3", what: "Lasten en baten van gemeenten, regio's en provincies per taakveld, 2010 tot nu" },
  { name: "CBS StatLine", what: "Alle CBS-tabellen, zoals Wmo-cliënten en jeugdhulp per gemeente" },
  { name: "Rechtspraak", what: "Gepubliceerde uitspraken, op naam te doorzoeken" },
  { name: "Woo-index", what: "Woo-besluiten, nota's en rapporten van de overheid" },
  { name: "Officiële bekendmakingen", what: "Gemeenteblad, Staatscourant en Kamerstukken" },
  { name: "Lokale regelgeving", what: "Verordeningen en beleidsregels, met wat nu geldt" },
  { name: "Europese aanbestedingen", what: "Aankondigingen en gunningen op TED" },
  { name: "data.overheid.nl", what: "Open datasets, zoals subsidieregisters, als CSV of Excel gelezen" },
  { name: "Elke openbare link", what: "PDF's en webpagina's van verzekeraars, regio's en gemeenten" },
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
    ],
  },
];

/** Every question, the groups interleaved, so the typewriter shows a mix. */
export const EXAMPLES = QUESTIONS[0].questions.flatMap((_, i) => QUESTIONS.map((g) => g.questions[i]));
