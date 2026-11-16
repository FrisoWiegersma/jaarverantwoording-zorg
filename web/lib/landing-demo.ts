const equity = 48_600_000;
const budget = 14_200_000;
const limitPercent = 25;
const limit = equity * limitPercent / 100;

export const INVESTMENT_CASE = {
  equity, budget, limitPercent, limit, overrun: budget - limit,
};

export const COMPARISON_EXAMPLE = {
  year: 2025,
  organizations: ["Zorggroep Noord", "Zorggroep West"],
  metrics: [
    { id: "omzet", label: "Omzet", values: [156.8, 142.3], prefix: "€ ", suffix: " mln", difference: " mln meer omzet", page: 9 },
    { id: "resultaat", label: "Resultaat / omzet", values: [2.1, 0.8], prefix: "", suffix: "%", difference: " procentpunt hoger resultaat", page: 10 },
    { id: "verzuim", label: "Verzuim", values: [6.2, 7.4], prefix: "", suffix: "%", difference: " procentpunt lager verzuim", page: 14 },
  ],
};
