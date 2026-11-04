/* Content and configuration: hypotheses, labels, prepared views and the presentation tour.
 * Edit texts here; numbers on the pages are computed live from data/*.js. */
(function (root) {
  'use strict';

  const CONTINENTS = ['Afrika', 'Asien', 'Europa', 'Nordamerika', 'Südamerika', 'Ozeanien', 'Unbekannt'];
  const CONTINENT_EN = {
    Afrika: 'Africa', Asien: 'Asia', Europa: 'Europe', Nordamerika: 'North America',
    'Südamerika': 'South America', Ozeanien: 'Oceania', Unbekannt: 'Unknown',
  };

  /* value formatters, referenced by name from the hypothesis specs */
  const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const F0 = nf(0), F1 = nf(1), F2 = nf(2), F3 = nf(3);
  const sign = v => (v < 0 ? '−' : '');
  const FORMAT = {
    usd: v => sign(v) + '$' + F0.format(Math.abs(v)),
    usdShort: v => sign(v) + (Math.abs(v) >= 1000 ? '$' + F0.format(Math.abs(v) / 1000) + 'k' : '$' + F0.format(Math.abs(v))),
    num1: v => sign(v) + F1.format(Math.abs(v)),
    num2: v => sign(v) + F2.format(Math.abs(v)),
    num3: v => sign(v) + F3.format(Math.abs(v)),
    pct: v => sign(v) + F2.format(100 * Math.abs(v)) + '%',
    pctShort: v => sign(v) + F1.format(100 * Math.abs(v)) + '%',
    pp: v => sign(v) + F1.format(Math.abs(v)) + ' pp',
    sharePp: v => sign(v) + F2.format(100 * Math.abs(v)) + ' pp',
    km: v => sign(v) + F0.format(Math.abs(v)) + ' km',
    pop: v => sign(v) + (Math.abs(v) >= 1000 ? F1.format(Math.abs(v) / 1000) + ' m' : F0.format(Math.abs(v)) + 'k'),
    lnkm: v => F2.format(v) + ' (' + F0.format(Math.exp(v)) + ' km)',
    lnkmShort: v => F0.format(Math.exp(v)) + ' km',
    growth: v => sign(v) + F2.format(Math.abs(v)) + '%/yr',
  };

  const COUNTRY_WAR = ['No war recorded', 'War recorded', 'Unknown (after 2007)'];
  const PAIR_WAR = ['Neither at war', 'One at war', 'Both at war', 'Unknown (after 2007)'];

  const HYPOTHESES = [
    {
      id: 'H1', token: 'h1', role: 'main', dataset: 'H1', unit: 'country', x: 'x', y: 'y',
      title: 'Productivity and military personnel',
      statement: 'Higher productivity is associated with fewer military personnel per 1,000 inhabitants.',
      expected: 'negative',
      why: 'Productive economies can replace manpower with capital and technology, and every soldier costs more forgone output.',
      xLabel: 'Real GDP per worker', xUnit: '2021 PPP USD', xSource: 'Penn World Table 11.0 · rgdpo / emp',
      yLabel: 'Military personnel per 1,000 inhabitants', yUnit: 'per 1,000', ySource: 'COW NMC 7.0 · milper / tpop',
      fx: 'usd', fxTick: 'usdShort', fy: 'num1', xLog: true, modelLog: true,
      verdict: 'Opposite direction', tone: 'contra',
      finding: 'Across countries the link is positive (r = +0.24). Inside a country, higher productivity goes with fewer soldiers: within-country r = −0.16.',
      groups: ['continent', 'war', 'decade'],
    },
    {
      id: 'H2', token: 'h2', role: 'main', dataset: 'H2', unit: 'country', x: 'x', y: 'y',
      title: 'Import concentration and military personnel',
      statement: 'More concentrated import partners are associated with more military personnel per inhabitant.',
      expected: 'positive',
      why: 'A country that depends on few suppliers is more exposed to supply shocks and could secure itself militarily.',
      xLabel: 'Import concentration (HHI of observed partners)', xUnit: '0–1', xSource: 'COW Trade 4.0 · bilateral imports',
      yLabel: 'Military personnel per 1,000 inhabitants', yUnit: 'per 1,000', ySource: 'COW NMC 7.0 · milper / tpop',
      fx: 'num3', fxTick: 'num2', fy: 'num1', xLog: false,
      verdict: 'Opposite direction', tone: 'contra',
      finding: 'Weakly negative (r = −0.12). The pattern comes from differences between countries; within countries it is close to zero.',
      groups: ['continent', 'war', 'decade'],
    },
    {
      id: 'H3', token: 'h3', role: 'main', dataset: 'H3', unit: 'pair', x: 'x', y: 'y',
      title: 'Trade ties and military spending growth',
      statement: 'More mutual imports go along with more similar changes in real military spending.',
      expected: 'negative',
      why: 'Close trading partners share interests and shocks, so their defence budgets could move together (a smaller growth gap).',
      xLabel: 'Mutual import share', xUnit: 'mean of both directed shares', xSource: 'COW Trade 4.0',
      yLabel: 'Gap in military spending growth', yUnit: 'percentage points', ySource: 'SIPRI Milex, constant 2024 USD',
      fx: 'pct', fxTick: 'pctShort', fy: 'pp', xLog: false,
      verdict: 'Expected direction, negligible', tone: 'weak',
      finding: 'The sign is as expected but linear r is only −0.03 (Spearman −0.18). Single spending shocks such as Angola 1993 weigh on many pairs at once.',
      groups: ['continent', 'combo', 'war', 'warWindow', 'decade'],
    },
    {
      id: 'H4', token: 'h4', role: 'main', dataset: 'TRADE', unit: 'pair', x: 'wealth', y: 'share',
      title: 'Wealth gap and trade ties',
      statement: 'More similar wealth goes along with higher mutual import shares.',
      expected: 'negative',
      why: 'Countries at a similar income level demand similar goods (Linder hypothesis), so a larger wealth gap should mean less trade.',
      xLabel: 'Absolute gap in log GDP per capita', xUnit: 'log points', xSource: 'Penn World Table 11.0 · cgdpe / pop',
      yLabel: 'Mutual import share', yUnit: 'mean of both directed shares', ySource: 'COW Trade 4.0',
      fx: 'num2', fxTick: 'num1', fy: 'pct', fyTick: 'pctShort', xLog: false,
      verdict: 'No relationship globally', tone: 'null',
      finding: 'Globally r = −0.02, practically zero. Regions point in opposite directions, and the USA drives several positive combinations.',
      groups: ['combo', 'continent', 'relation', 'border', 'lang', 'war', 'decade'],
    },
    {
      id: 'H8', token: 'h8', role: 'side', dataset: 'H8', unit: 'country', x: 'x', y: 'y',
      title: 'Export distance and later growth',
      statement: 'A larger export-weighted distance to partners goes with higher GDP-per-capita growth over the next five years.',
      expected: 'positive',
      why: 'Reaching distant markets could signal competitiveness.',
      xLabel: 'Export-weighted partner distance', xUnit: 'km', xSource: 'COW Trade 4.0 + CEPII distw',
      yLabel: 'Annual GDP-per-capita growth, t to t+5', yUnit: '% per year', ySource: 'Maddison Project 2023',
      fx: 'km', fy: 'growth', xLog: false,
      verdict: 'Not supported, below 5,000 pairs', tone: 'null',
      finding: 'r = −0.03 with only 2,987 complete pairs, so H8 stays exploratory.',
      groups: ['continent', 'warNext', 'war', 'decade'],
    },
    {
      id: 'E1', token: 'e1', role: 'side', dataset: 'E1', unit: 'country', x: 'x', y: 'y',
      title: 'Population and import concentration',
      statement: 'More populous countries have less concentrated import partners.',
      expected: 'negative',
      why: 'Large markets trade with more partners. Added to understand H2.',
      xLabel: 'Population', xUnit: 'thousands', xSource: 'COW NMC 7.0 · tpop',
      yLabel: 'Import concentration (HHI)', yUnit: '0–1', ySource: 'COW Trade 4.0',
      fx: 'pop', fy: 'num3', xLog: true,
      verdict: 'Supported, weak', tone: 'pro',
      finding: 'r = −0.14, Spearman −0.31. Large anchor countries (USA, Australia) shape the regional patterns.',
      groups: ['continent', 'war', 'decade'],
    },
    {
      id: 'E2', token: 'e2', role: 'side', dataset: 'E2', unit: 'country', x: 'x', y: 'y',
      title: 'Urbanisation and military personnel',
      statement: 'A higher urban population share goes with fewer military personnel per inhabitant.',
      expected: 'negative',
      why: 'Urban labour markets raise the cost of soldiers. Added to understand H1.',
      xLabel: 'Urban population share', xUnit: 'NMC upop / tpop', xSource: 'COW NMC 7.0',
      yLabel: 'Military personnel per 1,000 inhabitants', yUnit: 'per 1,000', ySource: 'COW NMC 7.0',
      fx: 'pct', fxTick: 'pctShort', fy: 'num1', xLog: false,
      verdict: 'Opposite direction', tone: 'contra',
      finding: 'r = +0.30. Caution: NMC changed its urban definition in 2002 and both ratios share the population denominator.',
      groups: ['continent', 'war', 'decade'],
    },
    {
      id: 'E3', token: 'e3', role: 'side', dataset: 'TRADE', unit: 'pair', x: 'sizeGap', y: 'asymAbs',
      title: 'Economic size gap and absolute trade asymmetry',
      statement: 'Larger differences in total GDP go with more unequal import shares within a pair.',
      expected: 'positive',
      why: 'A small economy depends more on a large partner than the other way round.',
      xLabel: 'Absolute gap in log total GDP', xUnit: 'log points', xSource: 'Penn World Table 11.0 · cgdpe',
      yLabel: 'Absolute difference of import shares', yUnit: 'percentage points', ySource: 'COW Trade 4.0',
      fx: 'num2', fxTick: 'num1', fy: 'sharePp', xLog: false,
      verdict: 'Supported, weak', tone: 'pro',
      finding: 'r = +0.22, stable under trimming. Without the USA pairs r falls to +0.16.',
      groups: ['combo', 'continent', 'relation', 'war', 'decade'],
    },
    {
      id: 'E4', token: 'e4', role: 'side', dataset: 'TRADE', unit: 'pair', x: 'sizeGap', y: 'asymRel',
      title: 'Economic size gap and relative trade asymmetry',
      statement: 'Larger differences in total GDP go with a more unequal relative split of import shares.',
      expected: 'positive',
      why: 'Same idea as E3, measured relative to the size of the relationship.',
      xLabel: 'Absolute gap in log total GDP', xUnit: 'log points', xSource: 'Penn World Table 11.0 · cgdpe',
      yLabel: 'Relative asymmetry |s1 − s2| / (s1 + s2)', yUnit: '0–1', ySource: 'COW Trade 4.0',
      fx: 'num2', fxTick: 'num1', fy: 'num3', fyTick: 'num1', xLog: false,
      verdict: 'Supported, moderate', tone: 'pro',
      finding: 'r = +0.34, the clearest result. 20.6% of pairs sit exactly at 1, and part of the link follows from how the measure is normalised.',
      groups: ['combo', 'continent', 'relation', 'war', 'decade'],
    },
    {
      id: 'E5', token: 'e5', role: 'side', dataset: 'TRADE', unit: 'pair', x: 'logDist', y: 'share',
      title: 'Distance and trade ties',
      statement: 'Countries farther apart have lower mutual import shares.',
      expected: 'negative',
      why: 'Transport costs and weaker ties with distance (gravity model).',
      xLabel: 'Distance (log of population-weighted km)', xUnit: 'ln km', xSource: 'CEPII GeoDist · distw',
      yLabel: 'Mutual import share', yUnit: 'mean of both directed shares', ySource: 'COW Trade 4.0',
      fx: 'lnkm', fxTick: 'lnkmShort', fy: 'pct', fyTick: 'pctShort', xLog: false,
      verdict: 'Supported, weak', tone: 'pro',
      finding: 'r = −0.24 and negative in all six continents. Geography explains trade far better than wealth (compare H4).',
      groups: ['combo', 'continent', 'border', 'lang', 'war', 'decade'],
    },
  ];

  const GROUP_LABELS = {
    continent: 'Continent', combo: 'Continent pair', relation: 'Same or different continent',
    war: 'War status', warWindow: 'War in t−1 or t', warNext: 'War in the next 5 years',
    decade: 'Decade', border: 'Shared border', lang: 'Shared official language',
  };
  const GROUP_NOTES = {
    continent: { country: '', pair: 'Overlapping: a pair counts for each continent of its two countries.' },
    combo: { pair: 'Exclusive: every pair belongs to exactly one combination.' },
    war: { country: 'COW inter-state wars up to 2007. Civil wars are not included.',
      pair: 'Both at war does not mean at war with each other.' },
    warWindow: { pair: 'Growth uses two years, so this counts war in t−1 or t.' },
    warNext: { country: 'Recorded war in any of the years t+1 to t+5.' },
  };

  /* Prepared views. Each token can be opened directly (index.html#h1-within).
   * steps: intermediate views shown in the step path before the view itself. */
  const PRESETS = {
    'h1-outliers': { h: 'H1', tab: 'influence', select: 'ARE' },
    'h1-trimmed': { h: 'H1', outlier: 'trim', tab: 'extremes' },
    'h1-between': { h: 'H1', level: 'between' },
    'h1-within': { h: 'H1', level: 'within', yView: 'central' },
    'h1-continents': { h: 'H1', group: 'continent', colorBy: 'continent', split: true, yView: 'central' },
    'h1-europe-africa': { h: 'H1', group: 'continent', continents: ['Europa', 'Afrika'], steps: [{ continents: ['Europa'] }] },
    'h1-europe': { h: 'H1', group: 'continent', continents: ['Europa'] },
    'h1-northamerica': { h: 'H1', group: 'continent', continents: ['Nordamerika'], select: 'USA', tab: 'influence' },
    'h1-northamerica-without-usa': { h: 'H1', group: 'continent', continents: ['Nordamerika'], countryMode: 'exclude', countries: ['USA'],
      steps: [{ continents: ['Nordamerika'] }] },
    'h1-usa': { h: 'H1', group: 'decade', countryMode: 'only', countries: ['USA'] },
    'h1-war': { h: 'H1', group: 'war', colorBy: 'war' },
    'h1-war-europe': { h: 'H1', group: 'war', continents: ['Europa'], colorBy: 'war' },
    'h1-frequent-wars': { h: 'H1', group: 'war', freq: 'aboveMean' },
    'h2-levels': { h: 'H2', level: 'between' },
    'h3-angola': { h: 'H3', select: 'AGO', tab: 'influence' },
    'h3-without-angola': { h: 'H3', countryMode: 'exclude', countries: ['AGO'], tab: 'influence' },
    'h3-war': { h: 'H3', group: 'war' },
    'h4-combinations': { h: 'H4', group: 'combo' },
    'h4-americas': { h: 'H4', group: 'combo', focus: ['combo', 'Nordamerika / Südamerika'], select: 'USA' },
    'h4-americas-without-usa': { h: 'H4', group: 'combo', focus: ['combo', 'Nordamerika / Südamerika'], countryMode: 'exclude', countries: ['USA'],
      steps: [{ focus: ['combo', 'Nordamerika / Südamerika'] }] },
    'e5-geography': { h: 'E5', group: 'border' },
  };

  /* The prepared talk: about 10 minutes, focus on H1. Captions are short on purpose. */
  const TOUR = [
    { view: 'overview', kicker: 'Introduction', text: 'Seven data sources, 1950–2014, four main hypotheses. Every number on this site is recomputed live in the browser.' },
    { view: 'overview', anchor: 'results', kicker: 'Results at a glance', text: 'n, r and p for all four hypotheses. Two point the opposite way, two are close to zero. H1 is the deep dive.' },
    { view: 'h1', kicker: 'H1 · as tested', text: '7,708 country-years. Expected negative, observed r = +0.24 (weak, positive). Hover the points: the UAE and Iraq sit at the edges.' },
    { view: 'h1-outliers', kicker: 'H1 · influential countries', text: 'The most influential country is the UAE (highlighted): very productive, large army. Without it r falls to +0.16, but stays positive.' },
    { view: 'h1-trimmed', kicker: 'H1 · outliers', text: 'Trimming the outer 1% of both variables gives r = +0.18, winsorising +0.24. The positive sign is not an outlier artefact.' },
    { view: 'h1-between', kicker: 'H1 · between countries', text: 'One point per country (its average): r = +0.40. Rich countries keep more soldiers per capita than poor ones.' },
    { view: 'h1-within', kicker: 'H1 · within countries', text: 'Deviations from each country’s own average: r = −0.16. When a country becomes more productive, its personnel ratio tends to fall.' },
    { view: 'h1-continents', kicker: 'H1 · continents', text: 'One small chart per continent, all on the same axes, each with its own trend line. Europe (−0.43) and Oceania (−0.66, only 3 countries) slope down; Africa and Asia slope up. The global value mixes opposite patterns.' },
    { view: 'h1-northamerica', kicker: 'H1 · North America', text: 'North America: r = +0.14. The USA (highlighted) combines very high productivity with a large army.' },
    { view: 'h1-northamerica-without-usa', kicker: 'H1 · without the USA', text: 'Remove one country and the sign flips: r = −0.11 for the remaining 21 countries.' },
    { view: 'h1-usa', kicker: 'H1 · only the USA', text: 'The USA on its own over 65 years: productivity up, personnel ratio down. A strongly negative within-country path.' },
    { view: 'h1-war', kicker: 'H1 · war status', text: 'Country-years without recorded war: r = +0.29. With war: +0.04 on only 211 rows. Groups differ, but this is no causal war effect.' },
    { view: 'h1-frequent-wars', kicker: 'H1 · frequent-war countries', text: 'Excluding countries with above-average war years (> 2.66%) leaves r = +0.22. The positive sign is not driven by war-prone states.' },
    { view: 'h2-levels', kicker: 'H2 · import concentration', text: 'Expected positive, observed r = −0.12. Between countries −0.17; within countries ≈ 0.' },
    { view: 'h3-angola', kicker: 'H3 · trade and spending growth', text: 'Expected direction, but r = −0.03. Angola’s +1,501% spending jump in 1993 enters 79 pairs in that year alone.' },
    { view: 'h3-without-angola', kicker: 'H3 · without Angola', text: 'Without Angola r almost doubles to −0.06, still negligible. One country’s shock matters more than any single row.' },
    { view: 'h4-americas', kicker: 'H4 · wealth gap and trade', text: 'Globally r = −0.02. North–South America shows +0.34, largely because of the USA.' },
    { view: 'h4-americas-without-usa', kicker: 'H4 · without the USA', text: 'Without the USA the Americas drop to +0.03. One large partner creates the regional pattern.' },
    { view: 'e5-geography', kicker: 'Side question E5', text: 'Distance explains trade far better than wealth: r = −0.24, and pairs with a shared border trade much more.' },
    { view: 'overview', anchor: 'conclusion', kicker: 'Conclusion', text: 'The level of analysis, the region and single countries change the answer. Correlation is not causation; the p-values ignore repeated country-years.' },
  ];

  const SOURCES = [
    { name: 'COW National Material Capabilities 7.0', use: 'Military personnel, population, urban population', unit: 'country-year' },
    { name: 'COW Trade 4.0 (national + dyadic)', use: 'Imports, exports, bilateral flows', unit: 'country-year, pair-year' },
    { name: 'COW Inter-State War Data 4.0', use: 'War participation 1816–2007', unit: 'war participant' },
    { name: 'COW State System Membership 2024', use: 'Which states exist in which year', unit: 'country' },
    { name: 'Penn World Table 11.0', use: 'Real GDP, workers, GDP per capita', unit: 'country-year' },
    { name: 'SIPRI Military Expenditure 2025', use: 'Real military spending (constant 2024 USD)', unit: 'country-year' },
    { name: 'Maddison Project 2023', use: 'Long-run GDP per capita growth', unit: 'country-year' },
    { name: 'CEPII GeoDist', use: 'Distance, borders, language, continent', unit: 'country, pair' },
  ];

  /* ---------- explanations for H1–H4 ----------
   * Text placeholders: {ref:key} becomes a numbered citation, {live:key} a value computed from the data
   * when the page opens. Every reference was checked (journal, volume, pages, DOI or publisher page). */
  const EXPLAIN_TYPES = {
    research: { label: 'Research', note: 'Findings from peer-reviewed studies' },
    geopolitics: { label: 'Geopolitics', note: 'Alliances, threats and power between states' },
    history: { label: 'History', note: 'Events and long-run change' },
    statistics: { label: 'Statistics', note: 'How the measure itself shapes the number' },
  };
  const REFS = {
    robinson: { cite: 'Robinson, W. S. (1950). Ecological correlations and the behavior of individuals. American Sociological Review, 15(3), 351–357.', doi: '10.2307/2087176' },
    asal: { cite: 'Asal, V., Conrad, J., & Toronto, N. (2017). I want you! The determinants of military conscription. Journal of Conflict Resolution, 61(7), 1456–1481.', doi: '10.1177/0022002715606217' },
    cotet: { cite: 'Cotet, A. M., & Tsui, K. K. (2013). Oil and conflict: What does the cross country evidence really show? American Economic Journal: Macroeconomics, 5(1), 49–80.', doi: '10.1257/mac.5.1.49' },
    sechser: { cite: 'Sechser, T. S., & Saunders, E. N. (2010). The army you have: The determinants of military mechanization, 1979–2001. International Studies Quarterly, 54(2), 481–511.', doi: '10.1111/j.1468-2478.2010.00596.x' },
    haltiner: { cite: 'Haltiner, K. W. (1998). The definite end of the mass army in Western Europe? Armed Forces & Society, 25(1), 7–36.', doi: '10.1177/0095327X9802500102' },
    rostker: { cite: 'Rostker, B. (2006). I want you! The evolution of the All-Volunteer Force (MG-265). RAND Corporation.', url: 'https://www.rand.org/pubs/monographs/MG265.html' },
    army: { cite: 'Dixon, A. (2013, July 3). July marks 40th anniversary of all-volunteer Army. U.S. Army, army.mil.', url: 'https://www.army.mil/article/106813' },
    hirschman: { cite: 'Hirschman, A. O. (1945/1980). National power and the structure of foreign trade (expanded ed.). University of California Press.', doi: '10.1525/9780520378179' },
    olson: { cite: 'Olson, M., & Zeckhauser, R. (1966). An economic theory of alliances. Review of Economics and Statistics, 48(3), 266–279.', doi: '10.2307/1927082' },
    gowa: { cite: 'Gowa, J., & Mansfield, E. D. (1993). Power politics and international trade. American Political Science Review, 87(2), 408–420.', doi: '10.2307/2939050' },
    long: { cite: 'Long, A. G. (2003). Defense pacts and international trade. Journal of Peace Research, 40(5), 537–552.', doi: '10.1177/00223433030405003' },
    hmr: { cite: 'Head, K., Mayer, T., & Ries, J. (2010). The erosion of colonial trade linkages after independence. Journal of International Economics, 81(1), 1–14.', doi: '10.1016/j.jinteco.2010.01.002' },
    nordhaus: { cite: 'Nordhaus, W., Oneal, J. R., & Russett, B. (2012). The effects of the international security environment on national military expenditures: A multicountry study. International Organization, 66(3), 491–513.', doi: '10.1017/S0020818312000173' },
    dunne: { cite: 'Dunne, J. P., & Perlo-Freeman, S. (2003). The demand for military spending in developing countries. International Review of Applied Economics, 17(1), 23–48.', doi: '10.1080/713673166' },
    oneal: { cite: 'Oneal, J. R., & Russett, B. (1999). The Kantian peace: The pacific benefits of democracy, interdependence, and international organizations, 1885–1992. World Politics, 52(1), 1–37.', doi: '10.1017/S0043887100020013' },
    barbieri: { cite: 'Barbieri, K. (1996). Economic interdependence: A path to peace or a source of interstate conflict? Journal of Peace Research, 33(1), 29–49.', doi: '10.1177/0022343396033001003' },
    unsc864: { cite: 'United Nations Security Council (1993). Resolution 864 (1993), S/RES/864, adopted 15 September 1993.', url: 'https://digitallibrary.un.org/record/197326' },
    sipri: { cite: 'SIPRI (2025). SIPRI Military Expenditure Database: Sources and methods. Stockholm International Peace Research Institute.', url: 'https://www.sipri.org/databases/milex/sources-and-methods' },
    linder: { cite: 'Linder, S. B. (1961). An essay on trade and transformation. Almqvist & Wiksell (Stockholm) and John Wiley (New York).', url: 'https://research.hhs.se/esploro/outputs/doctoral/An-essay-on-trade-and-transformation/991001480523006056' },
    hallak: { cite: 'Hallak, J. C. (2010). A product-quality view of the Linder hypothesis. Review of Economics and Statistics, 92(3), 453–466.', doi: '10.1162/REST_a_00001' },
    anderson: { cite: 'Anderson, J. E., & van Wincoop, E. (2003). Gravity with gravitas: A solution to the border puzzle. American Economic Review, 93(1), 170–192.', doi: '10.1257/000282803321455214' },
    headmayer: { cite: 'Head, K., & Mayer, T. (2014). Gravity equations: Workhorse, toolkit, and cookbook. In Handbook of International Economics (Vol. 4, pp. 131–195). Elsevier.', doi: '10.1016/B978-0-444-54314-1.00003-3' },
  };
  const EXPLAIN = [
    {
      id: 'H1', token: 'h1',
      expected: 'Higher productivity → fewer soldiers per 1,000 inhabitants (negative)',
      found: [['All rows', 'H1:pooled'], ['Between countries', 'H1:between'], ['Within countries', 'H1:within']],
      answer: 'Rich countries do not keep fewer soldiers: some of the richest face military threats or live on oil, and both go with large forces. The expected effect appears only inside countries: as a country grows more productive, the share of people in uniform falls.',
      figures: ['h1-paths', 'h1-usa'],
      cards: [
        { type: 'statistics', title: 'Two questions, two answers', text: 'The pooled r mixes a comparison between countries with changes inside countries. Correlations of group averages can differ in size and even in sign from correlations inside the groups, the classic “ecological correlation” problem {ref:robinson}.', evidence: 'Between country means r = +0.40, within countries r = −0.17.', link: ['h1-within', 'Show the within view'] },
        { type: 'geopolitics', title: 'Rich, but under threat', text: 'States involved in interstate war or rivalry are more likely to keep conscript armies {ref:asal}. That raises personnel per inhabitant regardless of productivity.', evidence: 'Largest forces among above-median productivity countries: {live:h1rich}. {live:h1war}', link: ['h1-between', 'Show country means'] },
        { type: 'research', title: 'Oil money buys armies', text: 'Oil discoveries raise military spending in non-democracies {ref:cotet}. Oil also inflates GDP per worker, so oil states sit far right in the chart and high up at the same time.', evidence: '{live:h1gulf}', link: ['h1-outliers', 'Show the UAE'] },
        { type: 'research', title: 'Machines instead of soldiers', text: 'Economic endowments are reliably associated with how mechanized a military is, that is, how much equipment each soldier works with {ref:sechser}. This is the mechanism H1 assumed. It shows up as change over time inside countries, not as a difference between them.', evidence: 'Inside single countries, log productivity and personnel move in opposite directions: {live:h1paths}. Fixed-effects β = −1.42, p = 0.11 (not significant).', link: ['h1-usa', 'Show the USA alone'] },
        { type: 'history', title: 'The end of the draft and of the mass army', text: 'The United States let conscription expire in 1973 and moved to an all-volunteer force {ref:army} {ref:rostker}. In Western Europe the conscript mass army was in decline by the late 1990s, mainly for strategic reasons such as the end of the Cold War and NATO membership {ref:haltiner}. Both happened while productivity kept rising, so they push the within-country correlation down even though growth was not their cause.', evidence: '{live:h1usa}', link: ['h1-usa', 'Show the USA alone'] },
      ],
    },
    {
      id: 'H2', token: 'h2',
      expected: 'More concentrated import partners → more soldiers per 1,000 inhabitants (positive)',
      found: [['All rows', 'H2:pooled'], ['Between countries', 'H2:between'], ['Within countries', 'H2:within']],
      answer: 'Countries that buy from few partners are often tied to one much larger partner, through an alliance or a colonial past. They can lean on that relationship instead of building large forces, so dependence goes with fewer soldiers, not more.',
      figures: ['h2-quartiles', 'h2-decades'],
      cards: [
        { type: 'research', title: 'Dependence means alignment, not armament', text: 'Hirschman, who introduced this concentration index, argued that a large trading partner gains influence over states whose trade is concentrated on it {ref:hirschman}. In that view, high concentration marks a close tie to one partner rather than a reason to arm against it.', evidence: 'Most concentrated importers in the data: {live:h2top}.', link: ['h2', 'Open H2'] },
        { type: 'geopolitics', title: 'Under someone else’s umbrella', text: 'Allies trade more with each other {ref:gowa} {ref:long}, and in an alliance the large members carry a disproportionate share of the defence burden {ref:olson}. A country whose imports come largely from one big ally can rely on it for security and keep a smaller army of its own.', evidence: '{live:h2q}', link: ['h2', 'Open H2'] },
        { type: 'history', title: 'Colonial trade ties faded slowly', text: 'After independence, trade with the former colonial power eroded gradually: by about 65% after four decades {ref:hmr}. High concentration therefore partly measures a period and a colonial past, and both also differ in how armies were built.', evidence: '{live:h2dec}', link: ['h2', 'Open H2'] },
        { type: 'statistics', title: 'A difference between countries, not a change within them', text: 'The relation lives between countries. When one country’s import concentration changes over time, its personnel ratio does not follow. Size sits behind both: populous countries trade with more partners (side question E1).', evidence: 'Between r = −0.17, within r = −0.01. E1: population vs. concentration r = −0.14, ρ = −0.31.', link: ['h2-levels', 'Show the levels'] },
      ],
    },
    {
      id: 'H3', token: 'h3',
      expected: 'More mutual imports → smaller gap in military spending growth (negative)',
      found: [['All pairs', 'H3:pooled'], ['Without Angola', 'fixed:-0.060'], ['Ranks (Spearman)', 'H3:rho']],
      answer: 'Trade may make conflict less likely, but defence budgets react to threats, wars and neighbours, not to trading partners. On top of that, single extreme years such as Angola 1993 dominate the linear correlation.',
      figures: ['h3-drivers', 'h3-bars'],
      cards: [
        { type: 'research', title: 'Budgets follow threats', text: 'Across 165 countries from 1950 to 2000, the predicted risk of a fatal militarized dispute is a strong predictor of military spending {ref:nordhaus}. In developing countries, neighbours’ spending and internal or external conflict are the main drivers {ref:dunne}. Trading partners are not on that list, so their budgets need not move together.', evidence: 'Mutual import share explains almost none of the growth gap: r = −0.03, r² < 0.2%.', link: ['h3', 'Open H3'] },
        { type: 'research', title: 'Trade and peace: real, but not uniform', text: 'In the “Kantian peace” research, economic interdependence goes with fewer militarized disputes {ref:oneal}. Other work finds that very high interdependence can raise the risk of disputes {ref:barbieri}. Effects that differ across pairs largely cancel out in one pooled correlation.', evidence: 'Between pair averages r = −0.09, within pairs over time r = 0.00.', link: ['h3', 'Open H3'] },
        { type: 'history', title: 'Angola 1993', text: 'In September 1993 the UN Security Council found that UNITA’s military actions in Angola threatened international peace and imposed an arms and petroleum embargo on UNITA {ref:unsc864}. In the SIPRI data, Angola’s real military spending rose by about 1,500% that year.', evidence: 'One country-year enters 79 pairs. Without Angola, r = −0.060 instead of −0.033.', link: ['h3-without-angola', 'Show without Angola'] },
        { type: 'statistics', title: 'Growth rates from small bases', text: 'Growth rates explode when the previous year’s spending is small, and SIPRI revises its series and notes that older and newer figures are not always comparable {ref:sipri}. Pearson r reacts strongly to such extremes; the rank correlation does not.', evidence: 'Spearman ρ = −0.18: a clearer tendency in the expected direction than r = −0.03.', link: ['h3-angola', 'Show Angola 1993'] },
      ],
    },
    {
      id: 'H4', token: 'h4',
      expected: 'More similar wealth → higher mutual import share (negative)',
      found: [['All pairs', 'H4:pooled'], ['North–South America', 'fixed:0.335'], ['… without the USA', 'fixed:0.033']],
      answer: 'Two classic trade forces pull in opposite directions and cancel out in total trade. Distance and economic size matter far more for who trades with whom. Where the wealth gap does matter, one big partner (the USA) creates the pattern.',
      figures: ['h4-tug', 'h4-bars'],
      cards: [
        { type: 'research', title: 'Linder against endowments', text: 'Linder argued that countries with similar incomes demand similar goods and therefore trade more {ref:linder}. Hallak shows that this holds within sectors, while trade across sectors, driven by differences between countries, hides it in aggregate data {ref:hallak}. H4 uses total imports, so a near-zero r is what this research predicts.', evidence: 'All pairs r = −0.018; between pair averages r = −0.020.', link: ['h4', 'Open H4'] },
        { type: 'research', title: 'Gravity: size and distance', text: 'Trade between two countries rises with their economic size and falls with distance and other trade costs, the “gravity” relation of international trade {ref:anderson} {ref:headmayer}.', evidence: 'Distance vs. mutual import share (side question E5): r = −0.24, more than ten times the wealth-gap value.', link: ['e5-geography', 'Show distance (E5)'] },
        { type: 'geopolitics', title: 'The Americas: one dominant partner', text: 'Between North and South America, a larger wealth gap goes with more trade. Without the USA the effect disappears. A much larger and richer economy dominates the trade of smaller partners, the asymmetric dependence Hirschman described {ref:hirschman}.', evidence: 'North–South America pairs r = +0.335; without the USA r = +0.033.', link: ['h4-americas-without-usa', 'Show without the USA'] },
      ],
    },
  ];

  root.CONTENT = { CONTINENTS, CONTINENT_EN, FORMAT, COUNTRY_WAR, PAIR_WAR, HYPOTHESES, GROUP_LABELS, GROUP_NOTES, PRESETS, TOUR, SOURCES, EXPLAIN, EXPLAIN_TYPES, REFS };
})(typeof window !== 'undefined' ? window : globalThis);
