"""Schritt 3: alle Grafiken.

Oben: Diagramme für das Analyse-Notebook (je ein Aufruf, ein Bild).
Unten: die Grafiken des Excel-Berichts, unverändert übernommen; sie werden als PNG gesammelt.
"""
from io import BytesIO
import textwrap

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .einstellungen import CONFIG, CONTINENTS, HYPOTHESEN, LABELS, WAR_CONFIG
from .laendercodes import COW_TO_ISO
from .statistik import complete, korrelation, leave_groups

plt.rcParams.update({'figure.dpi': 110, 'font.size': 10,
                     'axes.spines.top': False, 'axes.spines.right': False})
LABELS = {**LABELS, 'tpop': 'Bevölkerung (Tausend)', 'urban_share': 'Städtischer Bevölkerungsanteil (0-1)',
          'asymmetry_relative': 'Relative Asymmetrie (0-1)', 'log_distance': 'Logarithmierte Entfernung (km)'}
BLAU, ORANGE, ROT = '#365e83', '#d18b35', '#ae563e'


def _achsen(name):
    h = HYPOTHESEN[name]
    return LABELS.get(h.x, h.x), LABELS.get(h.y, h.y)


# ====================================================================================
# Diagramme für das Analyse-Notebook
# ====================================================================================

def ergebnisse(tabelle):
    """Pearson r aller Hypothesen; die Kursgrenze 0,1 ist grau hinterlegt."""
    fig, ax = plt.subplots(figsize=(8, 0.55*len(tabelle) + 1))
    t = tabelle.iloc[::-1]
    ax.axvspan(-0.1, 0.1, color='0.92', zorder=0, label='|r| < 0,1: nicht interpretiert')
    ax.barh(t.index, t.r, color=np.where(t.r < 0, ROT, BLAU))
    for i, r in enumerate(t.r):
        ax.text(r + (0.01 if r >= 0 else -0.01), i, f'{r:+.3f}', va='center', ha='left' if r >= 0 else 'right', fontsize=9)
    ax.axvline(0, color='grey', lw=.7)
    ax.set(xlabel='Pearson r', xlim=(-0.6, 0.6), title='Ergebnisse auf einen Blick')
    ax.legend(loc='lower right', fontsize=8, frameon=False)
    return fig


def streudiagramm(d, name, titel=None):
    """Dichte der Wertepaare (Sechsecke, Farbe = Anzahl, logarithmisch)."""
    fig, ax = plt.subplots(figsize=(7.5, 5))
    xl, yl = _achsen(name)
    r = korrelation(d)['r']
    im = ax.hexbin(d.x, d.y, gridsize=40, mincnt=1, bins='log', cmap='viridis', xscale='log' if name == 'H1' else 'linear')
    ax.set(xlabel=xl + (' (log)' if name == 'H1' else ''), ylabel=yl, title=titel or f'{name}: n = {len(d):,}, r = {r:+.3f}')
    fig.colorbar(im, ax=ax, label='Anzahl Beobachtungen')
    return fig


def zwischen_innerhalb(d, name):
    """Links ein Punkt je Land (Durchschnitt), rechts die Abweichungen vom eigenen Durchschnitt."""
    e = 'ccode' if 'ccode' in d else 'pair_id'
    zwischen = d.groupby(e)[['x', 'y']].mean()
    innerhalb = d[['x', 'y']] - d.groupby(e)[['x', 'y']].transform('mean')
    xl, yl = _achsen(name)
    fig, axs = plt.subplots(1, 2, figsize=(13, 4.8), layout='constrained')
    for ax, data, titel in [(axs[0], zwischen, 'Zwischen Ländern (ein Punkt je Land)'),
                            (axs[1], innerhalb, 'Innerhalb der Länder (Abweichung vom eigenen Mittel)')]:
        ax.scatter(data.x, data.y, s=10 if len(data) < 1000 else 3, alpha=.6, color=BLAU)
        b, a = np.polyfit(data.x, data.y, 1)
        xs = np.linspace(data.x.min(), data.x.max(), 50)
        ax.plot(xs, a + b*xs, color=ROT, lw=2)
        ax.set(title=f'{titel}: r = {korrelation(data)["r"]:+.3f}', xlabel=xl, ylabel=yl)
    return fig


def laendereinfluss(d, name, anzahl=10):
    """Wie stark ändert sich r, wenn ein Land wegfällt? Die einflussreichsten Länder."""
    t = leave_groups(d, 'x', 'y', 'country').head(anzahl).iloc[::-1]
    fig, ax = plt.subplots(figsize=(7.5, 0.4*anzahl + 1.2))
    ax.barh(t.country_iso3_default.fillna(t.excluded_group.astype(str)), t.delta_r, color=np.where(t.delta_r < 0, ROT, BLAU))
    ax.axvline(0, color='grey', lw=.7)
    ax.set(xlabel='Änderung von r ohne dieses Land', title=f'{name}: einflussreichste Länder')
    return fig


def nach_gruppen(tabelle, spalte, titel):
    """r je Gruppe (z. B. Kontinent); schraffiert: weniger als 30 Beobachtungen."""
    t = tabelle.dropna(subset=['r']).sort_values('r')
    fig, ax = plt.subplots(figsize=(7.5, 0.45*len(t) + 1.2))
    bars = ax.barh(t[spalte].astype(str) + '  (n=' + t.n.map('{:,}'.format) + ')', t.r, color=np.where(t.r < 0, ROT, BLAU))
    for bar, n in zip(bars, t.n):
        if n < 30: bar.set_hatch('//'); bar.set_alpha(.5)
    ax.axvline(0, color='grey', lw=.7)
    ax.set(xlabel='Pearson r', title=titel)
    return fig


def zeitverlauf(d, name):
    """Pearson r je Jahr (Jahre mit mindestens 30 Beobachtungen)."""
    jahre = [(j, korrelation(t)['r']) for j, t in d.groupby('year') if len(t) >= 30]
    fig, ax = plt.subplots(figsize=(9, 3.6))
    ax.plot([j for j, _ in jahre], [r for _, r in jahre], color=BLAU)
    ax.axhline(korrelation(d)['r'], color='grey', ls='--', lw=1, label='r aller Jahre')
    ax.axhline(0, color='grey', lw=.7)
    ax.set(xlabel='Jahr', ylabel='Pearson r', title=f'{name}: Korrelation je Jahr'); ax.legend(fontsize=8)
    return fig


def land_im_zeitverlauf(d, iso3, name):
    """x (oben) und y (unten) eines einzelnen Landes über die Jahre."""
    t = d.loc[d.iso3.eq(iso3)].sort_values('year')
    xl, yl = _achsen(name)
    fig, (oben, unten) = plt.subplots(2, 1, figsize=(9, 5), sharex=True, layout='constrained')
    oben.plot(t.year, t.x, color=BLAU); oben.set_title(xl, loc='left', fontsize=9)
    unten.plot(t.year, t.y, color=ROT); unten.set_title(yl, loc='left', fontsize=9); unten.set(xlabel='Jahr')
    fig.suptitle(f'{iso3}: r = {korrelation(t)["r"]:+.3f} über {len(t)} Jahre')
    return fig


# ====================================================================================
# Grafiken des Excel-Berichts (unverändert übernommen)
# ====================================================================================

def density(ax, d, x, y, title):
    v = complete(d, [x, y])
    if len(v) < 3 or v[x].nunique() < 2 or v[y].nunique() < 2:
        ax.text(.5, .5, 'Insufficient variation', ha='center', transform=ax.transAxes); return
    im = ax.hexbin(v[x], v[y], gridsize=40, mincnt=1, bins='log', cmap='viridis', rasterized=True)
    ax.set(xlabel=LABELS.get(x, x), ylabel=LABELS.get(y, y), title=title)
    ax.figure.colorbar(im, ax=ax, label='Observation count', shrink=.8)


def _png(fig, dpi):
    buf = BytesIO(); fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    return buf.getvalue()


def bericht_grafiken(daten, zusatz):
    """Alle Berichtsgrafiken als Liste von Einträgen mit PNG-Bildern, geordnet nach Hypothese."""
    chart_items = vertiefende_grafiken(daten, zusatz)
    return gruppengrafiken(zusatz, chart_items)


def vertiefende_grafiken(daten, zusatz):
    T, rt, datasets = daten.tabellen, zusatz['report_tables'], zusatz['datasets']
    trade, country_year = T['trade'], T['country_year']
    items = []
    add = lambda sheet, title, fig: items.append({'sheet': sheet, 'title': title, 'png': _png(fig, 140)})

    sensitivity, baseline = rt['Outlier_sensitivity'], rt['Correlations']
    for name, (d, x, y, _) in datasets.items():
        r = baseline.set_index('hypothesis').loc[name, 'pearson_r']
        fig, axs = plt.subplots(2, 2, figsize=(13, 9), layout='constrained')
        density(axs[0, 0], d, x, y, f'{name}: full sample, n={len(d):,}, r={r:.3f}')
        density(axs[0, 1], zusatz['variant_frames'][name]['trim_p01_p99'], x, y, 'Central percentile view only; full sample retained')
        v = sensitivity.loc[sensitivity.hypothesis.eq(name)]
        pos = np.arange(len(v))
        axs[1, 0].barh(pos - .17, v.pearson_r, height=.32, label='Pearson')
        axs[1, 0].barh(pos + .17, v.spearman_rho, height=.32, label='Spearman', color='#d18b35')
        axs[1, 0].set_yticks(pos, v.variant.str.replace('_', ' '), fontsize=8)
        axs[1, 0].axvline(0, color='grey', lw=.7); axs[1, 0].set(xlabel='Correlation', title='Outlier sensitivity')
        axs[1, 0].legend(fontsize=8)
        t = rt['Time_groups']; t = t.loc[t.hypothesis.eq(name) & t.grouping.eq('year')]
        axs[1, 1].plot(t.group, t.pearson_r, label='Pearson')
        axs[1, 1].plot(t.group, t.spearman_rho, label='Spearman', color='#d18b35')
        axs[1, 1].axhline(0, color='grey', lw=.7); axs[1, 1].set(xlabel='Year', ylabel='Correlation', title='Annual correlations')
        axs[1, 1].legend(fontsize=8)
        add('Charts_' + name, name + ' overview', fig)

    fig, axs = plt.subplots(1, 2, figsize=(13, 4.5), layout='constrained')
    d, x, y, _ = datasets['H1']; m = d.groupby('ccode')[[x, y]].mean().reset_index()
    density(axs[0], m, x, y, 'H1: between country means')
    w = d[[x, y]] - d.groupby('ccode')[[x, y]].transform('mean')
    density(axs[1], w, x, y, 'H1: within country deviations (axes show deviations)')
    add('Charts_differences', 'Between and within country comparison', fig)

    fig, axs = plt.subplots(1, 2, figsize=(13, 4.5), layout='constrained')
    g = rt['Trade_groups']; v = g.loc[g.grouping.eq('wealth_group')]
    axs[0].plot(v.group, 100*v.share_mean, marker='o', label='Mean')
    axs[0].plot(v.group, 100*v.share_median, marker='o', label='Median')
    axs[0].plot(v.group, 100*v.share_p90, marker='o', label='90th percentile')
    axs[0].set(xlabel='Absolute log GDPpc gap', ylabel='Mutual import share (%)', title='Trade distribution by wealth gap'); axs[0].legend()
    density(axs[1], trade, 'total_gdp_gap_log', 'asymmetry_abs', 'Economic size and absolute import dependence gap')
    add('Charts_trade', 'Trade distributions and asymmetry', fig)

    fig, axs = plt.subplots(1, 2, figsize=(13, 4.5), layout='constrained')
    bins = rt['Geographic_bins']
    for i, (col, title) in enumerate([('border_group', 'Shared border'), ('language_group', 'Shared official language')]):
        for group, a in bins.loc[bins.grouping.eq(col)].groupby('group', sort=False):
            a = a.loc[a.n.ge(CONFIG['min_group_n'])]
            axs[i].plot(a.median_distance_km, a.mean_mutual_share_pct, marker='o', label=group)
        axs[i].set(xscale='log', xlabel='Median distance per bin (km, log scale)', ylabel='Mean mutual import share (%)', title=title)
        axs[i].legend(fontsize=8)
    add('Charts_trade', 'Geographic comparison using common log-distance bins', fig)

    extremes = rt['H3_extreme_years']
    top_codes = extremes.ccode.drop_duplicates().head(3).tolist()
    fig, axs = plt.subplots(len(top_codes), 2, figsize=(13, 3*len(top_codes)), squeeze=False, layout='constrained')
    for i, code in enumerate(top_codes):
        v = country_year.loc[country_year.ccode.eq(code) & country_year.analysis_period & country_year.cross_source_eligible].sort_values('year')
        axs[i, 0].plot(v.year, v.military_spending_real_musd); axs[i, 0].set(title=str(COW_TO_ISO.get(code, code)), ylabel='Real spending (million 2024 USD)', xlabel='Year')
        axs[i, 1].plot(v.year, v.military_growth_pct); axs[i, 1].set(ylabel='Annual growth (%)', xlabel='Year')
    add('Charts_influence', 'H3: spending series behind extreme growth rates', fig)

    fig, axs = plt.subplots(1, 2, figsize=(13, 5), layout='constrained')
    for i, name in enumerate(['H1', 'H3']):
        v = rt['Leave_country'].loc[lambda q: q.hypothesis.eq(name)].head(10).iloc[::-1]
        axs[i].barh(v.country_iso3_default.fillna(v.excluded_group.astype(str)), v.delta_r)
        axs[i].axvline(0, color='grey', lw=.7); axs[i].set(title=name + ': exclude each country and all its pairs', xlabel='Change in Pearson r')
    add('Charts_influence', 'Country influence', fig)

    fig, axs = plt.subplots(1, 2, figsize=(13, 5), layout='constrained')
    reg = rt['Regression']
    for ax, prefix, term, title in [(axs[0], 'R1_', 'log_productivity', 'H1: productivity coefficient with country/year FE'),
                                    (axs[1], 'R3_', 'wealth_gap_log', 'Trade: wealth-gap coefficient with year FE')]:
        v = reg.loc[reg.model.str.startswith(prefix) & reg.term.eq(term)].copy()
        pos = np.arange(len(v))
        ax.errorbar(v.coefficient, pos, xerr=np.vstack([v.coefficient - v.ci_low, v.ci_high - v.coefficient]), fmt='o', capsize=4)
        ax.set_yticks(pos, v.model.str.replace('_', ' '), fontsize=8)
        ax.axvline(0, color='grey', lw=.7)
        ax.set(title=title, xlabel='Coefficient and exploratory 95% clustered interval')
    add('Charts_models', 'Regression outlier sensitivity; see inference limitations in Methods', fig)
    return items


def gruppengrafiken(zusatz, chart_items):
    all_specs, group_registry, group_order = zusatz['all_specs'], zusatz['group_registry'], zusatz['group_order']
    group_results, group_extremes, context_models = zusatz['group_results'], zusatz['group_extremes'], zusatz['context_models']
    cross_records = zusatz['cross_records']
    context_charts = []

    def context_figure(hyp, section, title, fig, gids, notes=None):
        context_charts.append({'hypothesis': hyp, 'section': section, 'title': title, 'png': _png(fig, WAR_CONFIG['chart_dpi']),
                               'group_ids': gids, 'notes': notes or []})

    def individual_group_chart(gid):
        rec = group_registry[gid]; hyp = rec['hypothesis']; spec = all_specs[hyp]; x, y = spec['x'], spec['y']
        d = rec['sample']; title = rec['label']
        fig, axs = plt.subplots(1, 2, figsize=(12.6, 4.5), layout='constrained')
        density(axs[0], d, x, y, 'Verteilung der vollständigen Wertepaare')
        t = group_extremes.loc[group_extremes.group_id.eq(gid) & group_extremes.dimension.eq('Residuum')]
        if len(t):
            t = t.sort_values(['direction', 'rank']).drop_duplicates(['case_label', 'ranked_value'])
            lab = [textwrap.shorten(str(s), width=40, placeholder='...') for s in t.case_label]
            pos = np.arange(len(t)); colors = np.where(t.ranked_value.ge(0), '#ae563e', '#365e83')
            axs[1].barh(pos, t.ranked_value, color=colors); axs[1].set_yticks(pos, lab, fontsize=8)
            axs[1].axvline(0, color='grey', lw=.7)
            axs[1].set(xlabel='Abweichung von einfacher Regressionsgerade (Y-Einheit)', title='Individuelle Abweichungen nach oben und unten')
        else: axs[1].text(.5, .5, 'Keine Einflussdiagnose verfügbar', ha='center', transform=axs[1].transAxes)
        fig.suptitle(hyp + ' ' + title, fontsize=12)
        context_figure(hyp, rec['kind'], title, fig, [gid])

    detailed = {'Gesamt', 'Vergleichszeitraum', 'Kontinentteilnahme', 'Kriegsstatus', 'Häufigkeitsreferenz', 'Häufigkeitsausschluss',
                'Manueller Ausschluss', 'Krieg im Wachstumsintervall', 'Krieg im Folgefenster'}
    for hyp in all_specs:
        for gid in group_order[hyp]:
            if group_registry[gid]['kind'] in detailed: individual_group_chart(gid)
        if 'ccode' not in all_specs[hyp]['df']:
            ids = [g for g in group_order[hyp] if group_registry[g]['kind'] == 'Kontinentkombination']
            a = group_results.loc[group_results.group_id.isin(ids)]
            mat = np.full((6, 6), np.nan); counts = np.zeros((6, 6), int)
            for row in a.itertuples():
                parts = row.group.split(' / ')
                if len(parts) == 2 and all(p in CONTINENTS for p in parts):
                    i, j = sorted([CONTINENTS.index(p) for p in parts]); mat[i, j] = row.pearson_r; counts[i, j] = row.n
            fig, ax = plt.subplots(figsize=(9.5, 6), layout='constrained')
            im = ax.imshow(np.ma.masked_invalid(mat), vmin=-1, vmax=1, cmap='RdBu_r')
            for i in range(6):
                for j in range(i, 6):
                    ax.text(j, i, f'r={mat[i, j]:.3f}\nn={counts[i, j]:,}' if np.isfinite(mat[i, j]) else f'n={counts[i, j]:,}',
                            ha='center', va='center', fontsize=8, color='white' if np.isfinite(mat[i, j]) and abs(mat[i, j]) > .6 else 'black')
            ax.set_xticks(range(6), CONTINENTS, rotation=25, ha='right'); ax.set_yticks(range(6), CONTINENTS)
            ax.set_title(hyp + ' Exklusive Kontinentkombinationen'); fig.colorbar(im, ax=ax, label='Pearson r', shrink=.75)
            context_figure(hyp, 'Kontinentkombination', 'Alle Kontinentkombinationen', fig, ids,
                ['Jedes Länderpaar steht in genau einer Kombination. Diagonale: gleicher Kontinent.'])
        cross = [c for c in cross_records if c['hypothesis'] == hyp]
        if cross:
            fig, axs = plt.subplots(2, 3, figsize=(13, 7.5), sharey=True, layout='constrained')
            rvals = group_results.set_index('group_id').loc[[c['group_id'] for c in cross], 'pearson_r'].dropna()
            lower = min(0, rvals.min()) if len(rvals) else 0
            upper = max(0, rvals.max()) if len(rvals) else 0
            pad = max(.025, .12*(upper - lower))
            for ax, cont in zip(axs.ravel(), CONTINENTS):
                ids = [c['group_id'] for c in cross if c['continent'] == cont]
                v = group_results.set_index('group_id').loc[ids]
                pos = np.arange(len(v))
                bars = ax.bar(pos, v.pearson_r, color='#365e83')
                labels = [textwrap.fill(s.split(' / ', 1)[1], 15) + '\nn=' + format(int(n), ',') for s, n in zip(v.group, v.n)]
                ax.set_xticks(pos, labels, fontsize=8); ax.set_ylim(lower - pad, upper + pad)
                ax.axhline(0, color='grey', lw=.7); ax.set(title=cont, ylabel='Pearson r')
                for bar, n in zip(bars, v.n):
                    if n < WAR_CONFIG['group_min_n']: bar.set_hatch('//'); bar.set_alpha(.5)
            context_figure(hyp, 'Kontinent und Krieg', 'Kriegsstatus innerhalb der Kontinente', fig,
                [c['group_id'] for c in cross], ['Rohkorrelationen bei gleicher Y-Skala. Schraffiert: kleine Gruppe unter 30; fehlender Balken: keine berechenbare Korrelation. Gruppen können sich in Ländern und Jahren unterscheiden.'])
        if all_specs[hyp]['military'] and len(context_models):
            v = context_models.loc[context_models.hypothesis.eq(hyp) &
                context_models.group.eq('Kriegsstatus mit Interaktion') &
                context_models.term.isin(['x_model', 'war_x', 'both_x'])].copy()
            terms = [t for t in ['x_model', 'war_x', 'both_x'] if t in set(v.term)]
            if terms:
                fig, axs = plt.subplots(1, len(terms), figsize=(4.4*len(terms), 3.4), squeeze=False, layout='constrained')
                titles = {'x_model': 'Steigung ohne Beteiligung', 'war_x': 'Änderung bei mind. einem beteiligten Land',
                          'both_x': 'Zusätzliche Änderung bei zwei beteiligten Ländern'}
                for ax, term in zip(axs.ravel(), terms):
                    part = v.loc[v.term.eq(term)].sort_values('winsorised')
                    yy = np.arange(len(part))
                    ax.scatter(part.coefficient, yy, color='#365e83')
                    for i, (_, r) in enumerate(part.iterrows()):
                        if np.isfinite(r.ci_low) and np.isfinite(r.ci_high):
                            ax.plot([r.ci_low, r.ci_high], [i, i], color='#365e83')
                    ax.set_yticks(yy, ['Winsor 1/99%' if w else 'Vollständige Werte' for w in part.winsorised], fontsize=8)
                    ax.set_ylim(-.75, len(part) - .25)
                    ax.axvline(0, color='grey', lw=.7); ax.set(title=textwrap.fill(titles[term], 32), xlabel='Koeffizient und exploratives 95%-Intervall')
                context_figure(hyp, 'Kriegsmodell mit Länder-/Paar- und Jahreseffekten', 'Kriegsinteraktionen: vollständige Werte und Winsor-Sensitivität', fig, [],
                    ['war_x ist eine Steigungsänderung; bei Paaren kommt both_x zusätzlich hinzu. Keine Kausalaussage. Beide beteiligt bedeutet nicht gegeneinander.',
                     'H1: X logarithmiert. H2: zusätzlich Bevölkerung und Produktivität kontrolliert. Modelle mit unbestimmtem Standardfehler zeigen nur den Punktschätzer.'])
                context_charts[-1]['model_frame'] = v[['term', 'winsorised', 'coefficient', 'ci_low', 'ci_high', 'p_cluster_exploratory', 'n']]

    # Die vertiefenden Grafiken kommen jeweils ans Ende ihrer Hypothese.
    for old in chart_items:
        sheet = old['sheet']
        if sheet.startswith('Charts_H'): hyp = sheet.replace('Charts_', '')
        elif sheet == 'Charts_differences': hyp = 'H1'
        elif sheet == 'Charts_influence': hyp = 'H3'
        else: hyp = 'H4'
        context_charts.append({'hypothesis': hyp, 'section': 'Bisherige vertiefende Analysen', 'title': old['title'],
            'png': old['png'], 'group_ids': [group_order[hyp][0]],
            'notes': ['Weitere Zahlen der Teilabbildungen stehen in den Alt Tabellen, insbesondere Regression und Trade_groups.']})
    return context_charts
