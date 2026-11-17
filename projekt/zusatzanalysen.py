"""Explorative Zusatzanalysen für den vollständigen Excel-Bericht (Schritt 4).

Für die Präsentation nicht nötig. Hier stehen alle Sensitivitäten, Einflussdiagnosen,
Gruppenvergleiche und Zusatzmodelle, die der Bericht als Tabellen enthält.
Die Berechnungen sind unverändert aus der bisherigen Analyse übernommen.

    zusatz = zusatzanalysen.berechne(daten)
"""
from collections import defaultdict

import numpy as np
import pandas as pd

from . import einstellungen as E
from .einstellungen import CONFIG, CONTINENTS, HYPOTHESEN, WAR_CONFIG
from .statistik import (complete, corr_metrics, fit_absorbed, leave_groups, moment_matrix,
                        r_from_moments, waehle_stichprobe)

NEW_QUESTION_NAMES = {'E1': 'E1_population_import_concentration', 'E2': 'E2_urbanisation_military',
                      'E3': 'E3_economic_size_absolute_asymmetry', 'E4': 'E4_economic_size_relative_asymmetry',
                      'E5': 'E5_distance_trade'}


def berechne(daten, verbose=True):
    say = print if verbose else (lambda *a: None)
    T = daten.tabellen
    datasets = {name: (d, HYPOTHESEN[name].x, HYPOTHESEN[name].y, HYPOTHESEN[name].erwartet)
                for name, d in T['basis'].items()}
    z = {'report_tables': {}, 'datasets': datasets}
    rt = z['report_tables']
    say('Zusatzanalysen: Korrelationen und Ausreißer …')
    korrelationen(datasets, T, rt)
    ausreisser(datasets, rt, z)
    einfluss_und_bootstrap(datasets, rt)
    say('Zeit, Ebenen, Verzögerungen …')
    zeit_und_ebenen(datasets, T, rt)
    handel_und_nebenfragen(daten, rt)
    say('Regressionen …')
    regressionen(datasets, T, rt)
    geografie_und_extremjahre(datasets, T, rt)
    zusammenfassung(T, rt, z)
    say('Gruppen nach Kontinent und Kriegsstatus …')
    gruppen(daten.stichproben, z)
    say('Modelle mit Kriegsstatus …')
    kontextmodelle(daten.stichproben, z)
    return z


def _specs(stichproben):
    """Hypothese -> Stichprobe mit Kontext und Spaltennamen (wie bisher all_specs)."""
    return {name: {'df': d, 'x': HYPOTHESEN[name].x, 'y': HYPOTHESEN[name].y,
                   'expected': HYPOTHESEN[name].erwartet, 'military': name in ['H1', 'H2', 'H3', 'E2']}
            for name, d in stichproben.items()}


# ---------- Grundkorrelationen ----------
def korrelationen(datasets, T, rt):
    rows = []
    for name, (d, x, y, expected) in datasets.items():
        row = {'hypothesis': name, 'role': 'exploratory' if name == 'H8' else 'original',
               'x': x, 'y': y, 'expected_direction': expected, **corr_metrics(d, x, y)}
        row['minimum_5000_met'] = row['n'] >= 5000
        row['countries'] = d.ccode.nunique() if 'ccode' in d else pd.unique(d[['ccode1', 'ccode2']].to_numpy().ravel()).size
        row['entities'] = d.ccode.nunique() if 'ccode' in d else d.pair_id.nunique()
        row['years'] = d.year.nunique()
        row['observed_direction_matches'] = (row['pearson_r'] < 0) == (expected == 'negative')
        rows.append(row)
    rt['Correlations'] = pd.DataFrame(rows)
    rt['Coverage_correction'] = pd.DataFrame([
        {'hypothesis': k, 'before': T['prepared_n'][k], 'after': len(datasets[k][0]),
         'removed': T['prepared_n'][k] - len(datasets[k][0]), 'rule': 'Both import coverage ratios in [0.90,1.10]'}
        for k in ['H3', 'H4']])


# ---------- Ausreißer und Einfluss einzelner Zeilen ----------
def ausreisser(datasets, rt, z):
    variant_frames, sensitivity_rows, cutoff_rows, top_rows, outlier_summary = {}, [], [], [], []
    baseline = rt['Correlations']
    for name, (d, x, y, _) in datasets.items():
        flags, thresholds = {}, {}
        for method in ['iqr', 'mad', 'percentile']:
            mark = np.zeros(len(d), dtype=bool)
            for col in [x, y]:
                s = d[col]
                if method == 'iqr':
                    q1, q3 = s.quantile([0.25, 0.75]); span = q3 - q1
                    low, high = q1 - CONFIG['iqr_multiplier']*span, q3 + CONFIG['iqr_multiplier']*span
                    active = span > 0
                elif method == 'mad':
                    med = s.median(); mad = (s - med).abs().median()
                    radius = CONFIG['mad_z_limit']*mad/0.6744897501960817
                    low, high, active = med - radius, med + radius, mad > 0
                else:
                    low, high = s.quantile([CONFIG['trim_lower'], CONFIG['trim_upper']]); active = True
                cutoff_rows.append({'hypothesis': name, 'method': method, 'variable': col,
                                    'low': low, 'high': high, 'rule_active': active,
                                    'note': '' if active else 'Zero IQR/MAD: this variable is not flagged by this rule'})
                if active:
                    mark |= ~s.between(low, high).to_numpy()
                if method == 'percentile':
                    thresholds[col] = (low, high)
            flags[method] = mark
        winsor = d.copy()
        for col in [x, y]:
            winsor[col] = winsor[col].clip(*thresholds[col])
        variants = {'full': d, 'iqr_excluded': d.loc[~flags['iqr']],
                    'mad_excluded': d.loc[~flags['mad']],
                    'trim_p01_p99': d.loc[~flags['percentile']], 'winsor_p01_p99': winsor}
        if name == 'H3':
            variants['growth_abs_le_100pct'] = d.loc[d.military_growth_pct1.abs().le(100) & d.military_growth_pct2.abs().le(100)]
        if name == 'H8':
            variants['nonoverlap_start_mod5_0'] = d.loc[d.year.mod(5).eq(0)]
        variant_frames[name] = variants
        base_r = float(baseline.set_index('hypothesis').loc[name, 'pearson_r'])
        for label, v in variants.items():
            m = corr_metrics(v, x, y)
            delta = m['pearson_r'] - base_r
            sensitivity_rows.append({'hypothesis': name, 'variant': label, **m,
                'n_baseline': len(d), 'removed_n': len(d) - len(v),
                'removed_pct': 100*(len(d) - len(v))/len(d),
                'values_modified': label.startswith('winsor'), 'delta_r': delta,
                'sign_flip': np.sign(m['pearson_r']) != np.sign(base_r) if np.isfinite(delta) else False,
                'large_delta_flag': abs(delta) >= CONFIG['sensitivity_delta_r'] if np.isfinite(delta) else False})
        mm = moment_matrix(d, x, y); total = mm.sum(axis=0)
        r_deleted = r_from_moments(total - mm)
        delta_delete = r_deleted - base_r
        xc, yc = mm[:, 1], mm[:, 2]
        b = np.dot(xc, yc)/np.dot(xc, xc)
        e = yc - b*xc; mse = np.dot(e, e)/(len(d) - 2)
        leverage = 1/len(d) + xc*xc/np.dot(xc, xc)
        cooks = (e*e/(2*mse))*leverage/np.maximum(1 - leverage, 1e-12)**2
        ids = [c for c in ['ccode', 'iso3', 'pwt_country', 'ccode1', 'ccode2', 'iso31', 'iso32', 'year',
                           'military_growth_pct1', 'military_growth_pct2', 'sipri_notes'] if c in d]
        diagnostic = d[ids + list(dict.fromkeys([x, y]))].copy()
        diagnostic.insert(0, 'hypothesis', name)
        diagnostic['x_variable'], diagnostic['y_variable'] = x, y
        diagnostic['r_without_row'] = r_deleted
        diagnostic['delta_r_without_row'] = delta_delete
        diagnostic['cooks_d'] = cooks
        diagnostic['cooks_flag_4_over_n'] = cooks > 4/len(d)
        for method, f in flags.items():
            diagnostic['flag_' + method] = f
        diagnostic['abs_delta'] = np.abs(delta_delete)
        idx = diagnostic.nlargest(CONFIG['top_observations'], 'abs_delta').index.union(
              diagnostic.nlargest(CONFIG['top_observations'], 'cooks_d').index)
        top_rows.append(diagnostic.loc[idx].sort_values('abs_delta', ascending=False))
        outlier_summary.append({'hypothesis': name, 'n': len(d),
            'iqr_flagged': int(flags['iqr'].sum()), 'mad_flagged': int(flags['mad'].sum()),
            'percentile_flagged': int(flags['percentile'].sum()),
            'cooks_flagged': int((cooks > 4/len(d)).sum()),
            'max_single_row_abs_delta_r': float(np.nanmax(np.abs(delta_delete)))})
    rt.update(Outlier_sensitivity=pd.DataFrame(sensitivity_rows), Outlier_counts=pd.DataFrame(outlier_summary),
              Outlier_cutoffs=pd.DataFrame(cutoff_rows), Top_observations=pd.concat(top_rows, ignore_index=True))
    z['variant_frames'] = variant_frames
    z['cutoff_rows'] = cutoff_rows


# ---------- Einfluss ganzer Länder und Jahre, Länder-Bootstrap ----------
def einfluss_und_bootstrap(datasets, rt):
    leave_country, leave_year = [], []
    for name, (d, x, y, _) in datasets.items():
        for mode, rows in [('country', leave_country), ('year', leave_year)]:
            a = leave_groups(d, x, y, mode); a.insert(0, 'hypothesis', name); rows.append(a)
    rt['Leave_country'] = pd.concat(leave_country, ignore_index=True)
    rt['Leave_year'] = pd.concat(leave_year, ignore_index=True)
    # Ganze Länderreihen ziehen (nur H1/H2).
    bootstrap_rows = []
    rng = np.random.default_rng(CONFIG['random_seed'])
    for name in ['H1', 'H2']:
        d, x, y, _ = datasets[name]; mm = moment_matrix(d, x, y)
        codes, levels = pd.factorize(d.ccode)
        sums = np.column_stack([np.bincount(codes, weights=mm[:, i], minlength=len(levels)) for i in range(6)])
        draws = rng.integers(0, len(levels), size=(CONFIG['bootstrap_repeats'], len(levels)))
        boot = r_from_moments(sums[draws].sum(axis=1))
        finite = boot[np.isfinite(boot)]
        lo, hi = np.quantile(finite, [0.025, 0.975])
        bootstrap_rows.append({'hypothesis': name, 'resampling_unit': 'whole country time series',
            'countries': len(levels), 'repeats': len(boot), 'valid_repeats': len(finite),
            'pearson_ci_low': lo, 'pearson_ci_high': hi,
            'limitation': 'Preserves within-country serial dependence; common cross-country shocks remain unaddressed'})
    rt['Country_bootstrap'] = pd.DataFrame(bootstrap_rows)


# ---------- Zeit, Länder, Ebenen, Verzögerungen ----------
def zeit_und_ebenen(datasets, T, rt):
    country_year = T['country_year']
    time_rows, country_rows, decomposition_rows, lag_rows = [], [], [], []
    for name, (d, x, y, _) in datasets.items():
        for grouping in ['year', 'decade']:
            grouped = d.assign(decade=(d.year//10)*10).groupby(grouping, sort=True)
            for group, v in grouped:
                if len(v) >= CONFIG['min_group_n']:
                    time_rows.append({'hypothesis': name, 'grouping': grouping, 'group': int(group), **corr_metrics(v, x, y)})
        entity = 'ccode' if 'ccode' in d else 'pair_id'
        means = d.groupby(entity)[[x, y]].mean().reset_index()
        decomposition_rows.append({'hypothesis': name, 'variant': 'between_entity_means',
            'interpretation': 'Each entity has equal weight; no causal interpretation', **corr_metrics(means, x, y, False)})
        within = d[[x, y]] - d.groupby(entity)[[x, y]].transform('mean')
        decomposition_rows.append({'hypothesis': name, 'variant': 'within_entity_demeaned',
            'interpretation': 'Within-entity deviations; common time effects not removed', **corr_metrics(within, x, y, False)})
        if entity == 'ccode':
            for code, v in d.groupby('ccode'):
                if len(v) >= CONFIG['min_country_years']:
                    country_rows.append({'hypothesis': name, 'ccode': code, 'iso3': v.iso3.iloc[0], **corr_metrics(v, x, y)})
            prev = d[['ccode', 'iso3', 'year', x, y]].copy()
            prev['year'] += 1
            prev = prev.rename(columns={x: x + '_previous', y: y + '_previous'})
            dif = d.merge(prev, on=['ccode', 'iso3', 'year'], how='inner', validate='one_to_one')
            dif['dx'] = dif[x] - dif[x + '_previous']; dif['dy'] = dif[y] - dif[y + '_previous']
            decomposition_rows.append({'hypothesis': name, 'variant': 'exact_annual_first_differences',
                'interpretation': 'Consecutive observed years only; original eligible sample', **corr_metrics(dif, 'dx', 'dy', False)})
    for name in ['H1', 'H2']:
        d, x, y, _ = datasets[name]
        target = country_year.loc[country_year.cross_source_eligible & country_year.analysis_period, ['ccode', 'iso3', 'year', y]].copy()
        for lag in [0, 1, 5]:
            future = target.rename(columns={y: 'future_y'}).copy(); future['year'] -= lag
            zz = complete(d.merge(future, on=['ccode', 'iso3', 'year'], validate='one_to_one'), [x, 'future_y'])
            lag_rows.append({'hypothesis': name, 'lag_years': lag, 'sample': 'available_for_this_lag', **corr_metrics(zz, x, 'future_y')})
        matched = d.copy()
        for lag in [0, 1, 5]:
            future = target.rename(columns={y: 'future_' + str(lag)}).copy(); future['year'] -= lag
            matched = matched.merge(future, on=['ccode', 'iso3', 'year'], how='inner', validate='one_to_one')
        matched = complete(matched, [x, 'future_0', 'future_1', 'future_5'])
        for lag in [0, 1, 5]:
            lag_rows.append({'hypothesis': name, 'lag_years': lag, 'sample': 'same_rows_all_lags', **corr_metrics(matched, x, 'future_' + str(lag))})
    rt.update(Time_groups=pd.DataFrame(time_rows), Country_correlations=pd.DataFrame(country_rows),
              Within_between=pd.DataFrame(decomposition_rows), Lag_analysis=pd.DataFrame(lag_rows))


# ---------- Handelsgruppen, Nebenfragen, Abdeckungsregeln ----------
def handel_und_nebenfragen(daten, rt):
    T = daten.tabellen
    trade, country_year = T['trade'], T['country_year']
    group_rows = []
    for col in ['border_group', 'language_group', 'distance_group', 'wealth_group']:
        for group, v in trade.groupby(col, observed=True):
            group_rows.append({'grouping': col, 'group': str(group),
                'share_mean': v.mutual_import_share.mean(), 'share_median': v.mutual_import_share.median(),
                'share_p90': v.mutual_import_share.quantile(0.9), 'zero_share_pct': 100*v.mutual_import_share.eq(0).mean(),
                'x': 'wealth_gap_log', 'y': 'mutual_import_share', **corr_metrics(v, 'wealth_gap_log', 'mutual_import_share')})
    rt['Trade_groups'] = pd.DataFrame(group_rows)
    cond = []
    for (border, wealth), v in trade.groupby(['border_group', 'wealth_group'], observed=True):
        cond.append({'border': border, 'wealth_group': str(wealth), 'n': len(v),
                     'mean_share': v.mutual_import_share.mean(), 'median_share': v.mutual_import_share.median(),
                     'p90_share': v.mutual_import_share.quantile(.9), 'positive_share_pct': 100*v.mutual_import_share.gt(0).mean()})
    rt['Conditional_trade'] = pd.DataFrame(cond)
    rt['New_questions'] = pd.DataFrame([{'analysis': NEW_QUESTION_NAMES[name], 'role': 'post-hoc exploratory',
        'x': HYPOTHESEN[name].x, 'y': HYPOTHESEN[name].y, 'expected_direction': HYPOTHESEN[name].erwartet,
        **corr_metrics(daten.stichproben[name], HYPOTHESEN[name].x, HYPOTHESEN[name].y)}
        for name in NEW_QUESTION_NAMES])

    h3_all, h4_all = T['h3_all_coverage'], T['h4_all_coverage']
    cov = lambda d, low, high: d.import_coverage_1.between(low, high) & d.import_coverage_2.between(low, high)
    coverage_rows = []
    for low, high in [(.95, 1.05), (.90, 1.10), (.80, 1.20)]:
        c2 = country_year.loc[country_year.analysis_period & country_year.cross_source_eligible & ~country_year.trade_scope_review]
        c2 = c2.loc[c2.import_coverage_ratio.between(low, high)]
        for name, d, x, y in [('H2', c2, 'import_hhi_observed', 'military_per_1000'),
            ('H3', h3_all.loc[cov(h3_all, low, high)], 'mutual_import_share', 'military_growth_gap_pp'),
            ('H4', h4_all.loc[cov(h4_all, low, high)], 'wealth_gap_log', 'mutual_import_share')]:
            coverage_rows.append({'hypothesis': name, 'coverage_min': low, 'coverage_max': high,
                'role': 'baseline' if low == .90 else 'sensitivity_only', **corr_metrics(d, x, y)})
    rt['Coverage_sensitivity'] = pd.DataFrame(coverage_rows)
    rt['H8_coverage'] = T['h8_coverage_sensitivity'].copy()


# ---------- Regressionen mit Länder-/Paar- und Jahreseffekten ----------
def regressionen(datasets, T, rt):
    trade = T['trade']
    model_rows, model_details = [], []
    d1 = datasets['H1'][0].copy(); d1['log_productivity'] = np.log(d1.productivity)
    d2 = datasets['H2'][0].copy(); d2['log_productivity'] = np.log(d2.productivity.where(d2.productivity.gt(0)))
    d2['log_population'] = np.log(d2.tpop.where(d2.tpop.gt(0)))
    tr = trade.copy(); tr['wealth_x_logdistance'] = tr.wealth_gap_log*tr.log_distance
    tr['language_x_logdistance'] = tr.comlang_off*tr.log_distance
    model_specs = [
        ('R1_H1_country_year_FE', d1, 'military_per_1000', ['log_productivity'], 'ccode', True,
         'Country/year clustering; cross-country dependence beyond common year clusters may remain'),
        ('R2_H2_country_year_FE', d2, 'military_per_1000', ['import_hhi_observed', 'log_productivity', 'log_population'], 'ccode', True,
         'Additional complete-case sample; coefficient is conditional, not causal'),
        ('R3_trade_geography_year_FE', tr, 'trade_share_pp',
         ['wealth_gap_log', 'log_distance', 'contig', 'comlang_off', 'mean_log_total_gdp', 'total_gdp_gap_log'],
         'pair_id', False, 'Static CEPII attributes; pair/year clusters do not cover all shared-country dyadic dependence'),
        ('R4_trade_interactions_year_FE', tr, 'trade_share_pp',
         ['wealth_gap_log', 'log_distance', 'contig', 'comlang_off', 'mean_log_total_gdp', 'total_gdp_gap_log',
          'wealth_x_logdistance', 'language_x_logdistance'],
         'pair_id', False, 'Interaction models are post-hoc; pair/year clusters do not cover all dyadic dependence'),
        ('R5_trade_pair_year_FE', tr, 'trade_share_pp',
         ['wealth_gap_log', 'mean_log_total_gdp', 'total_gdp_gap_log'], 'pair_id', True,
         'Within-pair/year associations; shared-country dyadic dependence can remain'),
    ]
    for args in model_specs:
        rows, detail = fit_absorbed(*args); model_rows.extend(rows); model_details.append(detail)
    cutoffs = rt['Outlier_cutoffs']
    bound = lambda hyp, col: cutoffs.loc[(cutoffs.hypothesis == hyp) & (cutoffs.method == 'percentile') & (cutoffs.variable == col)].iloc[0]
    for variant in ['trim_p01_p99', 'winsor_p01_p99']:
        d = datasets['H1'][0].copy()
        for col in ['productivity', 'military_per_1000']:
            b = bound('H1', col)
            if variant.startswith('trim'): d = d.loc[d[col].between(b['low'], b['high'])].copy()
            else: d[col] = d[col].clip(b['low'], b['high'])
        d['log_productivity'] = np.log(d.productivity)
        rows, detail = fit_absorbed('R1_' + variant, d, 'military_per_1000', ['log_productivity'], 'ccode', True,
            'Sensitivity only; full original model remains reference')
        model_rows.extend(rows); model_details.append(detail)
        d = trade.copy()
        for col in ['wealth_gap_log', 'mutual_import_share']:
            b = bound('H4', col)
            if variant.startswith('trim'): d = d.loc[d[col].between(b['low'], b['high'])].copy()
            else: d[col] = d[col].clip(b['low'], b['high'])
        d['trade_share_pp'] = 100*d.mutual_import_share
        rows, detail = fit_absorbed('R3_' + variant, d, 'trade_share_pp',
            ['wealth_gap_log', 'log_distance', 'contig', 'comlang_off', 'mean_log_total_gdp', 'total_gdp_gap_log'],
            'pair_id', False, 'Sensitivity only; pair/year clusters do not capture all shared-country dependence')
        model_rows.extend(rows); model_details.append(detail)
    rt['Regression'] = pd.DataFrame(model_rows)
    rt['Model_details'] = pd.DataFrame(model_details)


# ---------- Entfernungsklassen und extreme Ausgabenjahre (H3) ----------
def geografie_und_extremjahre(datasets, T, rt):
    trade, country_year = T['trade'], T['country_year']
    geography_bin_rows = []
    finite_distance = trade.log_distance.dropna()
    common_distance_bins = np.linspace(finite_distance.min(), finite_distance.max(), 11)
    for col in ['border_group', 'language_group']:
        for group, v in trade.groupby(col):
            if group == 'Unknown': continue
            bins = pd.cut(v.log_distance, common_distance_bins, include_lowest=True)
            a = v.groupby(bins, observed=True).agg(distance=('distance_km', 'median'), mean_share=('trade_share_pp', 'mean'), n=('year', 'size'))
            for interval, row in a.iterrows():
                geography_bin_rows.append({'grouping': col, 'group': group, 'log_distance_bin_low': interval.left,
                    'log_distance_bin_high': interval.right, 'median_distance_km': row['distance'],
                    'mean_mutual_share_pct': row['mean_share'], 'n': int(row['n']),
                    'shown_in_chart': row['n'] >= CONFIG['min_group_n']})
    rt['Geographic_bins'] = pd.DataFrame(geography_bin_rows)
    # Länderjahre mit den größten Ausgabensprüngen in den H3-Paaren.
    extremes = pd.concat([datasets['H3'][0][[f'ccode{s}', f'iso3{s}', 'year', f'military_growth_pct{s}']].rename(
        columns={f'ccode{s}': 'ccode', f'iso3{s}': 'iso3', f'military_growth_pct{s}': 'military_growth_pct'}) for s in [1, 2]])
    extremes = extremes.drop_duplicates(['ccode', 'year']); extremes['abs_growth'] = extremes.military_growth_pct.abs()
    extremes = extremes.sort_values('abs_growth', ascending=False).head(50)
    extremes = extremes.merge(country_year[['ccode', 'year', 'military_spending_real_musd', 'sipri_notes']],
                              on=['ccode', 'year'], how='left', validate='one_to_one')
    previous = country_year[['ccode', 'iso3', 'year', 'military_spending_real_musd']].copy(); previous.year += 1
    previous = previous.rename(columns={'military_spending_real_musd': 'previous_year_spending_musd'})
    rt['H3_extreme_years'] = extremes.merge(previous, on=['ccode', 'iso3', 'year'], how='left', validate='one_to_one')


# ---------- Zusammenfassung, Methoden und Parameter ----------
def zusammenfassung(T, rt, z):
    import platform, scipy, matplotlib, openpyxl
    from datetime import datetime
    from zoneinfo import ZoneInfo
    baseline, sensitivity = rt['Correlations'], rt['Outlier_sensitivity']
    summary_rows = []
    for row in baseline.to_dict('records'):
        name = row['hypothesis']; v = sensitivity.loc[sensitivity.hypothesis.eq(name) & sensitivity.variant.ne('full')]
        lc = rt['Leave_country'].loc[lambda q: q.hypothesis.eq(name)].iloc[0]
        ly = rt['Leave_year'].loc[lambda q: q.hypothesis.eq(name)].iloc[0]
        largest = v.loc[v.delta_r.abs().idxmax()]
        summary_rows.append({'hypothesis': name, 'n': row['n'], 'pearson_r': row['pearson_r'],
            'spearman_rho': row['spearman_rho'], 'p_standard': row['p_standard'],
            'minimum_5000_met': row['minimum_5000_met'],
            'direction_matches_expectation': row['observed_direction_matches'],
            'largest_sensitivity_variant': largest['variant'], 'largest_sensitivity_delta_r': largest['delta_r'],
            'most_influential_country': lc['country_iso3_default'], 'country_exclusion_delta_r': lc['delta_r'],
            'most_influential_year': ly['excluded_group'], 'year_exclusion_delta_r': ly['delta_r'],
            'interpretation': 'Exploratory only; original hypothesis retained; outlier flags are not data errors'})
    tables = {'Summary': pd.DataFrame(summary_rows), **rt}
    tables['Audit'] = T['audit'].copy()
    tables['Variables'] = T['data_dictionary'].copy()
    tables['Additional_variables'] = pd.DataFrame([
        ('asymmetry_abs', 'abs(flow1/imports1-flow2/imports2)', '0-1'),
        ('asymmetry_relative', 'abs(share1-share2)/(share1+share2); undefined if both zero', '0-1'),
        ('total_gdp_gap_log', 'abs(log(PWT cgdpe1)-log(PWT cgdpe2))', 'log units'),
        ('urban_share', 'NMC urban population / total population', '0-1'),
        ('trade_share_pp', '100*mutual_import_share', 'percent'),
        ('delta_r', 'variant r minus complete baseline r', 'correlation difference'),
    ], columns=['variable', 'definition', 'unit'])
    tables['Sources'] = T['source_catalog'].copy()
    foot = T['sipri_footnotes'].dropna(how='all').copy()
    tables['SIPRI_source_notes'] = pd.DataFrame([
        {'original_excel_row': int(i) + 1, 'reference': row.iloc[0],
         'note_text': ' '.join(str(v) for v in row.iloc[1:] if pd.notna(v))}
        for i, row in foot.iterrows()])
    tables['Parameters'] = pd.DataFrame([{'parameter': k, 'value': str(v)} for k, v in CONFIG.items()] + [
        {'parameter': 'start_year', 'value': str(E.START_YEAR)}, {'parameter': 'end_year', 'value': str(E.END_YEAR)},
        {'parameter': 'analysis_code_sha256', 'value': ANALYSIS_CODE_SHA256},
        {'parameter': 'run_started_berlin', 'value': datetime.now(ZoneInfo('Europe/Berlin')).isoformat()},
        {'parameter': 'python', 'value': platform.python_version()}, {'parameter': 'pandas', 'value': pd.__version__},
        {'parameter': 'numpy', 'value': np.__version__}, {'parameter': 'scipy', 'value': scipy.__version__},
        {'parameter': 'matplotlib', 'value': matplotlib.__version__}, {'parameter': 'openpyxl', 'value': openpyxl.__version__},
    ])
    z['report_tables'] = {'Summary': tables.pop('Summary'),
                          'Methods': pd.DataFrame(METHOD_TEXT, columns=['topic', 'explanation']), **tables}


ANALYSIS_CODE_SHA256 = 'c80c9f9efe264c860fe0755b7aa017b0dd798e2277b5c1e7c8385ff79ad253e5'
METHOD_TEXT = [
    ('Scope', 'Original H1-H4; H8 and all extensions are exploratory. No hypothesis is changed to obtain significance.'),
    ('Baseline coverage', 'H3/H4 require import coverage [0.90,1.10] in BOTH countries. This corrects the earlier preparation sample.'),
    ('Rows versus independence', 'n counts complete rows, not independent countries or wars. Minimum 5000 is a course criterion, not an independence test.'),
    ('Pearson p', 'p_standard is the conventional two-sided SciPy Pearson p-value. Serial and shared-country dependence are not accounted for.'),
    ('Many analyses', 'Multiple exploratory comparisons are shown. No automatic significance/confirmation labels; no uncorrected search for small p-values.'),
    ('Zero p-values', 'A stored zero p-value can mean numerical underflow and must not be interpreted as exactly zero probability.'),
    ('Outlier rules', 'IQR=1.5*IQR; robust MAD-z=3.5; trim/winsor=1st/99th percentile of each variable in baseline. Zero IQR/MAD disables that variable rule.'),
    ('Trimming', 'Excludes rows outside either X or Y cutoff. All variants are sensitivities, never replacements for the original full-sample estimate.'),
    ('Winsorising', 'Clips X and Y to cutoffs while retaining rows. Changes values, not the number of observations.'),
    ('Cook distance', 'Simple y~constant+x OLS only, flag 4/n. Descriptive screen, not evidence of a measurement error.'),
    ('Row influence', 'Exact Pearson correlation after removing one observation; exported top cases are a selection, not all flagged observations.'),
    ('Country influence', 'Removes all rows involving that country, including BOTH pair roles. More important than single-row deletion for repeated shocks.'),
    ('Bootstrap', 'H1/H2 only, resample entire country time series. Common cross-country shocks may remain. Not applied to overlapping dyads/H8 windows.'),
    ('Time groups', 'Annual and decade correlations use available complete data, minimum 30 pairs. Composition changes can explain differences.'),
    ('Within/between', 'Demeaned correlations are descriptive; p suppressed. Country means give equal entity weight; within effects retain observation weights.'),
    ('Lags', 'Exact t+1 and t+5 targets; both time points eligible, within 1950-2014 and same ISO identity. Same-rows comparisons are also included.'),
    ('Geography', 'CEPII language/border attributes are static, not historically year-specific. Country-scope exclusions from preparation remain in place.'),
    ('Distance chart bins', 'Ten equal-width bins of log distance using common edges for both comparison groups; plotted only for bins with at least 30 observations.'),
    ('Asymmetry', 'Absolute import-share difference includes genuine bilateral zeros. Relative measure excludes two-zero cases; inspect sample-size difference.'),
    ('H3 extremes', 'Growth can be very large due to a small prior-year denominator. Spending levels and original SIPRI notes require review before exclusion.'),
    ('SIPRI quality', 'Estimate/uncertainty cell colours are not fully converted to flags. Read the original source notes; no automated validity claim.'),
    ('H8', 'Exploratory, below 5000 baseline rows. Modulo-5 sensitivity reduces overlapping windows but does not remove all dependence.'),
    ('Regression', 'OLS estimated on absorbed group/year residuals. Two-way cluster covariance uses entity+year minus intersection, finite-sample correction.'),
    ('Regression inference', 'Dyad/year clustering does not capture every dependence between different dyads sharing a country. All inference is exploratory.'),
    ('Covariance', 'Negative diagonal estimates from the two-way sandwich are reported as missing SEs, never silently forced positive.'),
    ('Interpretation', 'Correlations/regressions describe associations. No causal conclusions, automatic outlier deletion, or hypothesis confirmation.'),
    ('Files', 'One timestamped XLSX with embedded PNGs. All analysis tables are numeric/structured. Sources have SHA256 hashes. The notebook is the executable method.'),
]


# ---------- Gruppen: Kontinente, Kriegsstatus, Kriegshäufigkeit, Extremfälle ----------
def gruppen(stichproben, z):
    all_specs = _specs(stichproben)
    group_metrics, extreme_rows, insight_rows, group_registry, cross_records = [], [], [], {}, []

    def context_label(d):
        if 'ccode' in d:
            return d.country_label.astype(str) + ' (' + d.iso3.astype(str) + ') ' + d.year.astype(str)
        return d.country_label_1.astype(str) + ' / ' + d.country_label_2.astype(str) + ' ' + d.year.astype(str)

    def summarize_group(hyp, kind, label, d, parent_r, overlap=False):
        spec = all_specs[hyp]; x, y = spec['x'], spec['y']
        d = complete(d, [x, y]).reset_index(drop=True)
        gid = f'{hyp}_{len(group_metrics):04d}'
        met = {'group_id': gid, 'hypothesis': hyp, 'grouping': kind, 'group': label,
               'overlapping_group': overlap, **corr_metrics(d[[x, y]], x, y)}
        met.update({'x_variable': x, 'y_variable': y, 'first_year': d.year.min() if len(d) else np.nan,
            'last_year': d.year.max() if len(d) else np.nan, 'enough_30_pairs': len(d) >= WAR_CONFIG['group_min_n'],
            'countries': d.ccode.nunique() if 'ccode' in d else pd.unique(d[['ccode1', 'ccode2']].to_numpy().ravel()).size,
            'entities': d.ccode.nunique() if 'ccode' in d else d.pair_id.nunique(),
            'parent_r': parent_r, 'delta_r_parent': met['pearson_r'] - parent_r,
            'x_median': d[x].median(), 'y_median': d[y].median(),
            'x_min': d[x].min(), 'x_max': d[x].max(), 'y_min': d[y].min(), 'y_max': d[y].max(),
            'y_zero_n': int(d[y].eq(0).sum())})
        if len(d) >= 3 and d[x].nunique() > 1 and d[y].nunique() > 1:
            thresholds = {}
            for col in [x, y]:
                lo, hi = d[col].quantile([.01, .99]); q1, q3 = d[col].quantile([.25, .75]); med = d[col].median(); mad = (d[col] - med).abs().median()
                thresholds[col] = (lo, hi)
                prefix = 'x' if col == x else 'y'
                met.update({prefix + '_p01': lo, prefix + '_p99': hi, prefix + '_q25': q1, prefix + '_q75': q3,
                    prefix + '_mad': mad, prefix + '_low_ties': int(d[col].eq(d[col].min()).sum()),
                    prefix + '_high_ties': int(d[col].eq(d[col].max()).sum())})
            keep = np.ones(len(d), bool); w = d[[x, y]].copy()
            for col in [x, y]:
                lo, hi = thresholds[col]; keep &= d[col].between(lo, hi).to_numpy(); w[col] = w[col].clip(lo, hi)
            trimmed = corr_metrics(d.loc[keep, [x, y]], x, y); winsor = corr_metrics(w, x, y)
            met.update({'trim_n': trimmed['n'], 'trim_r': trimmed['pearson_r'], 'trim_p_standard': trimmed['p_standard'],
                'trim_removed_pct': 100*(1 - keep.mean()), 'winsor_r': winsor['pearson_r'],
                'trim_sign_flip': np.sign(trimmed['pearson_r']) != np.sign(met['pearson_r'])})
            # Standardisierung hält die Momentdiagnose numerisch stabil; Pearson r bleibt unverändert.
            scaled = d[list(dict.fromkeys([x, y, 'year'] + [c for c in ['ccode', 'ccode1', 'ccode2'] if c in d]))].copy()
            for col in [x, y]: scaled[col] = (d[col] - d[col].mean())/d[col].std(ddof=0)
            mat = moment_matrix(scaled, x, y); total = mat.sum(axis=0)
            r_del = r_from_moments(total - mat); delta = r_del - met['pearson_r']
            xx = d[x].to_numpy(float); yy = d[y].to_numpy(float)
            slope = np.dot(xx - xx.mean(), yy - yy.mean())/np.dot(xx - xx.mean(), xx - xx.mean())
            residual = yy - (yy.mean() + slope*(xx - xx.mean()))
            d['_residual'] = residual; d['_label'] = context_label(d)
            d['_delta_r_deleted'] = delta
            finite_delta = np.isfinite(delta)
            met['max_row_abs_delta_r'] = float(np.max(np.abs(delta[finite_delta]))) if finite_delta.any() else np.nan
            lc = leave_groups(scaled, x, y, 'country')
            lc = lc.loc[np.isfinite(lc.delta_r)]
            best = lc.iloc[0] if len(lc) else None
            met.update({'strongest_country': best['country_iso3_default'] if best is not None else None,
                        'country_delta_r': best['delta_r'] if best is not None else np.nan})
            sort_keys = [c for c in ['ccode', 'ccode1', 'ccode2', 'year'] if c in d]
            stable = d.sort_values(sort_keys, kind='stable')
            for dimension, col in [('X', x), ('Y', y), ('Residuum', '_residual')]:
                lower, upper = thresholds.get(col, (np.quantile(residual, .01), np.quantile(residual, .99)))
                q1, q3 = np.quantile(d[col], [.25, .75]); iqr = q3 - q1
                med = d[col].median(); mad = (d[col] - med).abs().median(); ties = d[col].value_counts()
                for direction, ascending in [('unten', True), ('oben', False)]:
                    ix = stable[col].sort_values(ascending=ascending, kind='stable').head(WAR_CONFIG['tail_rows_per_direction']).index
                    cases = d.loc[ix]
                    for rank, (idx, row) in enumerate(cases.iterrows(), 1):
                        val = row[col]
                        target = {'group_id': gid, 'hypothesis': hyp, 'grouping': kind, 'group': label,
                            'dimension': dimension, 'direction': direction, 'rank': rank, 'case_label': row['_label'],
                            'year': row.year, 'x_value': row[x], 'y_value': row[y], 'ranked_value': val,
                            'residual_y_units': row['_residual'], 'r_without_row': r_del[idx],
                            'delta_r_without_row': row['_delta_r_deleted'], 'same_value_n': int(ties.get(val, 0)),
                            'percentile_tail_flag': bool(val < lower or val > upper),
                            'iqr_tail_flag': bool(iqr > 0 and (val < q1 - 1.5*iqr or val > q3 + 1.5*iqr)),
                            'mad_tail_flag': bool(mad > 0 and abs(.67448975*(val - med)/mad) > 3.5),
                            'group_n': len(d)}
                        for c in ['ccode', 'iso3', 'ccode1', 'ccode2', 'iso31', 'iso32', 'continent', 'continent_1', 'continent_2', 'war_group',
                                  'war_names', 'war_names_1', 'war_names_2', 'war_year_share', 'war_year_share_1', 'war_year_share_2',
                                  'military_growth_pct1', 'military_growth_pct2', 'sipri_notes']:
                            if c in d: target[c] = row[c]
                        extreme_rows.append(target)
            high = d.loc[d[y].idxmax()]; low = d.loc[d[y].idxmin()]
            infl = d.iloc[int(np.nanargmax(np.abs(delta)))] if finite_delta.any() else None
            desc = [
                f"Y oben: {high['_label']} mit {high[y]:.5g}; unten: {low['_label']} mit {low[y]:.5g}.",
                f"Nullwerte in Y: {met['y_zero_n']:,}. Bindungen am Minimum: {met['y_low_ties']:,}; am Maximum: {met['y_high_ties']:,}.",
                f"r vollständig {met['pearson_r']:.3f}, getrimmt {met['trim_r']:.3f}, winsorisiert {met['winsor_r']:.3f}; Trimmen entfernt {met['trim_removed_pct']:.1f}%.",
                f"Größter Einfluss einer Zeile: {infl['_label']}, Änderung r beim Weglassen {infl['_delta_r_deleted']:+.4f}." if infl is not None
                    else 'Zeileneinfluss nicht bestimmbar: Nach Entfernen bleiben zu wenige Werte oder keine Variation.',
                f"Größter Ländereinfluss: {best['country_iso3_default']}, Änderung r {best['delta_r']:+.4f}; alle Paarrollen entfernt." if best is not None
                    else 'Ländereinfluss nicht bestimmbar: Nach Entfernen bleiben zu wenige Werte oder keine Variation.',
            ]
        else:
            desc = ['Zu wenige vollständige Beobachtungen oder konstante Variable; keine Korrelations- oder Einflussbewertung.']
            if len(d):
                stable = d.assign(_label=context_label(d)).sort_values(
                    [c for c in ['ccode', 'ccode1', 'ccode2', 'year'] if c in d], kind='stable')
                for dimension, col in [('X', x), ('Y', y)]:
                    lo, hi = d[col].quantile([.01, .99]); q1, q3 = d[col].quantile([.25, .75]); iqr = q3 - q1
                    med = d[col].median(); mad = (d[col] - med).abs().median()
                    for direction, ascending in [('unten', True), ('oben', False)]:
                        cases = stable.sort_values(col, ascending=ascending, kind='stable').head(WAR_CONFIG['tail_rows_per_direction'])
                        for rank, (_, case) in enumerate(cases.iterrows(), 1):
                            value = case[col]
                            extreme_rows.append({'group_id': gid, 'hypothesis': hyp, 'grouping': kind, 'group': label,
                                'dimension': dimension, 'direction': direction, 'rank': rank, 'case_label': case['_label'],
                                'year': case.year, 'x_value': case[x], 'y_value': case[y], 'ranked_value': value,
                                'residual_y_units': np.nan, 'r_without_row': np.nan, 'delta_r_without_row': np.nan,
                                'same_value_n': int(d[col].eq(value).sum()), 'group_n': len(d),
                                'percentile_tail_flag': bool(value < lo or value > hi),
                                'iqr_tail_flag': bool(iqr > 0 and (value < q1 - 1.5*iqr or value > q3 + 1.5*iqr)),
                                'mad_tail_flag': bool(mad > 0 and abs(.67448975*(value - med)/mad) > 3.5)})
        if len(d) < WAR_CONFIG['group_min_n']: desc.append('Kleine Gruppe unter 30 Paaren; Kennzahlen nur beschreibend.')
        group_metrics.append(met)
        for i, t in enumerate(desc, 1): insight_rows.append({'group_id': gid, 'hypothesis': hyp, 'grouping': kind, 'group': label, 'insight_number': i, 'insight': t})
        group_registry[gid] = {'hypothesis': hyp, 'kind': kind, 'label': label, 'row_index': d.index,
            'metrics': met, 'insights': desc, 'sample': d[[x, y, 'year']].copy()}
        return gid

    group_order = defaultdict(list)
    for hyp, spec in all_specs.items():
        d, x, y = spec['df'], spec['x'], spec['y']; full = corr_metrics(d, x, y)['pearson_r']
        group_order[hyp].append(summarize_group(hyp, 'Gesamt', 'Gesamt 1950 bis 2014', d, full))
        common = d.loc[d.war_known.fillna(False)]
        cr = corr_metrics(common, x, y)['pearson_r']
        group_order[hyp].append(summarize_group(hyp, 'Vergleichszeitraum', 'Bekannter Kriegsstatus bis 2007', common, cr))
        for cont in CONTINENTS:
            keep = d.continent.eq(cont) if 'ccode' in d else d.continent_1.eq(cont) | d.continent_2.eq(cont)
            group_order[hyp].append(summarize_group(hyp, 'Kontinentteilnahme', cont, d.loc[keep], full, overlap='ccode' not in d))
        if 'ccode' not in d:
            for group, v in d.groupby('continent_pair', dropna=False):
                group_order[hyp].append(summarize_group(hyp, 'Kontinentkombination', str(group), v, full))
            for group, v in d.groupby('continent_relation', dropna=False):
                group_order[hyp].append(summarize_group(hyp, 'Kontinentrelation', str(group), v, full))
        elif d.continent.eq('Unbekannt').any():
            group_order[hyp].append(summarize_group(hyp, 'Kontinentteilnahme', 'Unbekannt', d.loc[d.continent.eq('Unbekannt')], full))
        for rule, title in [('above_mean_share', 'Ohne überdurchschnittlichen Kriegsjahresanteil'),
                            ('above_p90_share', 'Ohne Anteil oberhalb des 90 Perzentils'),
                            ('above_mean_count', 'Ohne überdurchschnittliche Anzahl Kriege')]:
            sample = waehle_stichprobe(d, ausschluss=rule)
            if 'ccode' in common: reference = common.loc[common.frequency_eligible.astype('boolean').fillna(False)]
            else: reference = common.loc[common.frequency_eligible_1.astype('boolean').fillna(False) & common.frequency_eligible_2.astype('boolean').fillna(False)]
            if rule == 'above_mean_share':
                group_order[hyp].append(summarize_group(hyp, 'Häufigkeitsreferenz',
                    f"Bekannter Status und mindestens {WAR_CONFIG['minimum_frequency_years']} beobachtete Jahre", reference, cr))
            reference_r = corr_metrics(reference, x, y)['pearson_r']
            gid = summarize_group(hyp, 'Häufigkeitsausschluss', title, sample, reference_r)
            group_registry[gid]['exclusion_rule'] = rule; group_order[hyp].append(gid)
        if WAR_CONFIG['manual_exclude_iso3']:
            sample = waehle_stichprobe(d, landerliste=WAR_CONFIG['manual_exclude_iso3'])
            group_order[hyp].append(summarize_group(hyp, 'Manueller Ausschluss', 'Ohne konfigurierte Länderliste', sample, full))
        if spec['military']:
            labels = ['Keine Beteiligung erfasst', 'Beteiligung erfasst'] if 'ccode' in d else ['Keines beteiligt', 'Ein Land beteiligt', 'Beide beteiligt']
            for group in labels + ['Status unbekannt']:
                v = d.loc[d.war_group.eq(group)]
                group_order[hyp].append(summarize_group(hyp, 'Kriegsstatus', group, v, cr if group != 'Status unbekannt' else full))
            if WAR_CONFIG['include_crossed_war_continent']:
                for cont in CONTINENTS:
                    keep = common.continent.eq(cont) if 'ccode' in common else common.continent_1.eq(cont) | common.continent_2.eq(cont)
                    c = common.loc[keep]; parent = corr_metrics(c, x, y)['pearson_r']
                    for group in labels:
                        gid = summarize_group(hyp, 'Kontinent und Krieg', cont + ' / ' + group, c.loc[c.war_group.eq(group)], parent, 'ccode' not in d)
                        group_order[hyp].append(gid)
                        cross_records.append({'hypothesis': hyp, 'continent': cont, 'war_status': group, 'group_id': gid})
        if hyp == 'H3':
            for group, v in d.groupby('war_window_group'):
                group_order[hyp].append(summarize_group(hyp, 'Krieg im Wachstumsintervall', group, v, cr))
        if hyp == 'H8':
            for group, v in d.groupby('future_window_war_group'):
                group_order[hyp].append(summarize_group(hyp, 'Krieg im Folgefenster', group, v, full))

    z.update(all_specs=all_specs, group_registry=group_registry, group_order=group_order, cross_records=cross_records,
             group_results=pd.DataFrame(group_metrics), group_extremes=pd.DataFrame(extreme_rows),
             group_insights=pd.DataFrame(insight_rows))


# ---------- Modelle mit Kriegsstatus und Kontinenten ----------
def kontextmodelle(stichproben, z):
    all_specs = z['all_specs']
    war_model_rows, war_model_details, war_model_status = [], [], []

    def model_sample(hyp, d):
        spec = all_specs[hyp]; x, y = spec['x'], spec['y']; out = d.copy()
        if hyp == 'H1': out['x_model'] = np.log(out[x].where(out[x].gt(0))); unit = 'log real GDP per worker'
        else: out['x_model'] = out[x]; unit = x
        out['y_model'] = out[y]
        return out, unit

    def run_context_model(hyp, label, d, include_war=False, clip=False):
        spec = all_specs[hyp]; x, y = spec['x'], spec['y']
        d = d.copy()
        if clip and len(d):
            for col in [x, y]: d[col] = d[col].clip(*d[col].quantile([.01, .99]))
        d, unit = model_sample(hyp, d)
        xx = ['x_model']
        if include_war:
            d = d.loc[d.war_known.fillna(False)].copy()
            d['x_centered'] = d.x_model - d.x_model.mean()
            d['war_any'] = pd.to_numeric(d.war_any, errors='coerce').astype(float)
            d['war_x'] = d.war_any*d.x_centered
            xx += ['war_any', 'war_x']
            if 'ccode' not in d:
                d['war_both'] = pd.to_numeric(d.war_both, errors='coerce').astype(float)
                d['both_x'] = d.war_both*d.x_centered
                xx += ['war_both', 'both_x']
        if hyp == 'H2':
            d['log_population'] = np.log(d.tpop.where(d.tpop.gt(0)))
            d['log_productivity'] = np.log(d.productivity.where(d.productivity.gt(0)))
            xx += ['log_population', 'log_productivity']
        entity = 'ccode' if 'ccode' in d else 'pair_id'
        name = hyp + ' ' + label + (' winsor' if clip else '')
        complete_n = len(complete(d, ['y_model'] + xx))
        try:
            if complete_n < max(100, len(xx)*20): raise ValueError('Too few complete observations for this model')
            rows, details = fit_absorbed(name, d, 'y_model', xx, entity, True,
                'Exploratory; no causal identification; shared-country dyadic dependence may remain' if entity == 'pair_id'
                else 'Exploratory country/year clustered inference; no causal identification')
            for row in rows: row.update(hypothesis=hyp, group=label, x_model_definition=unit, war_interaction=include_war, winsorised=clip)
            details.update(hypothesis=hyp, group=label, x_model_definition=unit, war_interaction=include_war, winsorised=clip)
            war_model_rows.extend(rows); war_model_details.append(details)
            status = 'computed'; reason = ''
        except (ValueError, np.linalg.LinAlgError, RuntimeError) as exc:
            status = 'skipped'; reason = str(exc)
        war_model_status.append({'hypothesis': hyp, 'model': name, 'n_input': len(d), 'n_complete_candidates': complete_n, 'status': status, 'reason': reason})

    for hyp, spec in all_specs.items():
        if not spec['military']: continue
        d = spec['df']; known = d.loc[d.war_known.fillna(False)].copy()
        run_context_model(hyp, 'Gleicher Kriegszeitraum ohne Kriegsregressoren', known)
        run_context_model(hyp, 'Kriegsstatus mit Interaktion', known, True)
        run_context_model(hyp, 'Kriegsstatus mit Interaktion', known, True, True)
        run_context_model(hyp, 'Ohne überdurchschnittlichen Kriegsjahresanteil', waehle_stichprobe(d, ausschluss='above_mean_share'))
        if 'ccode' in known: reference = known.loc[known.frequency_eligible.astype('boolean').fillna(False)]
        else: reference = known.loc[known.frequency_eligible_1.astype('boolean').fillna(False) & known.frequency_eligible_2.astype('boolean').fillna(False)]
        run_context_model(hyp, 'Häufigkeitsreferenz vor Länderausschluss', reference)
        for cont in CONTINENTS:
            s = waehle_stichprobe(d, kontinent=cont)
            run_context_model(hyp, 'Kontinent ' + cont, s)
            if WAR_CONFIG['include_crossed_war_continent']:
                run_context_model(hyp, 'Kontinent ' + cont + ' mit Kriegsstatus', s.loc[s.war_known.fillna(False)], True)
    z.update(context_models=pd.DataFrame(war_model_rows), context_model_details=pd.DataFrame(war_model_details),
             context_model_status=pd.DataFrame(war_model_status))
