"""Exportiert die Analyse-Stichproben aus Historical_War_Continent_Analysis.ipynb
für die interaktive Website.

Aufruf aus dem Projektordner (dort, wo Data/ liegt):
    .venv/bin/python Website/build_data.py

Das Skript führt die Aufbereitungs- und Kontextzellen des Notebooks unverändert aus
(Teil A, erweiterte Analyse ohne Grafiken/Regressionen, Kriegs- und Kontinentkontext).
Es schreibt KEINEN Excel-Bericht und verändert keine Originaldaten. Ergebnis:
Website/data/*.js mit kompakten Spalten (Base64 typed arrays), die index.html lädt.
"""
from pathlib import Path
import base64
import contextlib
import io
import json
import math
import os
import sys
import time

import numpy as np

WEBSITE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = WEBSITE_DIR.parent
NOTEBOOK = PROJECT_DIR / 'Historical_War_Continent_Analysis.ipynb'
OUT_DIR = WEBSITE_DIR / 'data'

# Zellen, die ausgeführt werden. Grafiken (38), Regressionen (36), Zusammenfassung (39),
# Gruppen-/Modell-/Excel-Teile (43 ff.) werden für die Website nicht gebraucht.
# Jede Zelle wird über einen eindeutigen Textanker geprüft, damit spätere Änderungen
# am Notebook nicht unbemerkt falsche Zellen ausführen.
CELLS = [
    (1, "PROJECT_DIR = Path.cwd()"),
    (3, "raw = {}"),
    (5, "def require_unique"),
    (7, "COW_TO_ISO = {"),
    (9, "name_candidates = {}"),
    (11, "wars = raw['wars'].copy()"),
    (13, "nmc['military_per_1000']"),
    (15, "base = dyadic_trade.loc"),
    (17, "dyad_year = base["),
    (19, "directed_trade = directed_trade.merge("),
    (21, "audit_rows = []"),
    (23, "assert len(raw)==10"),
    (27, "CONFIG = {"),
    (29, "def r_from_moments"),
    (30, "def leave_groups"),
    (32, "time_rows, country_rows"),
    (34, "trade = datasets['H4'][0].copy()"),
    (41, "WAR_CONFIG = {"),
]


def run_notebook():
    nb = json.loads(NOTEBOOK.read_text(encoding='utf-8'))
    ns = {'__name__': '__notebook__'}
    os.chdir(PROJECT_DIR)
    for index, anchor in CELLS:
        cell = nb['cells'][index]
        source = ''.join(cell['source'])
        if cell['cell_type'] != 'code' or anchor not in source:
            raise RuntimeError(f'Zelle {index} passt nicht mehr zum Anker {anchor!r}. Bitte CELLS anpassen.')
        started = time.time()
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(source, f'<notebook cell {index}>', 'exec'), ns)
        print(f'  Zelle {index:>2} ausgeführt ({time.time() - started:5.1f}s)')
    return ns


def b64(array, dtype):
    arr = np.ascontiguousarray(np.asarray(array).astype(dtype))
    return base64.b64encode(arr.astype(arr.dtype.newbyteorder('<')).tobytes()).decode('ascii')


def column(values, kind):
    dtype = {'f32': '<f4', 'u8': '<u1', 'u16': '<u2'}[kind]
    values = np.asarray(values, dtype=float) if kind == 'f32' else np.asarray(values)
    return {'t': kind, 'b64': b64(values, dtype)}


def num(value):
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def write_js(name, payload):
    OUT_DIR.mkdir(exist_ok=True)
    text = ('window.APPDATA = window.APPDATA || {};\n'
            f'window.APPDATA[{json.dumps(name)}] = {json.dumps(payload, separators=(",", ":"), ensure_ascii=False)};\n')
    path = OUT_DIR / f'{name}.js'
    path.write_text(text, encoding='utf-8')
    print(f'  {path.relative_to(PROJECT_DIR)}  {path.stat().st_size / 1e6:6.2f} MB')


def main():
    print('Notebook-Zellen ausführen …')
    ns = run_notebook()
    pd = ns['pd']
    all_specs, war_country_year = ns['all_specs'], ns['war_country_year']
    state_list, frequency_profile = ns['state_list'], ns['frequency_profile']

    # ---------- Länder (Entitäten = COW-Code wie in leave_groups/Within-Between) ----------
    used = set()
    for spec in all_specs.values():
        d = spec['df']
        if 'ccode' in d:
            used.update(d.ccode.astype(int))
        else:
            used.update(d.ccode1.astype(int)); used.update(d.ccode2.astype(int))
    used = sorted(used)
    rows = war_country_year.loc[war_country_year.ccode.isin(used) & war_country_year.cross_source_eligible
                                & war_country_year.year.between(1950, 2014)]
    cow_names = state_list.drop_duplicates('ccode', keep='last').set_index('ccode').statenme
    entities = []
    for code in used:
        r = rows.loc[rows.ccode.eq(code)]
        iso = r.iso3.dropna().unique().tolist()
        if len(iso) != 1:
            raise RuntimeError(f'COW {code}: keine eindeutige ISO-Kennung in der Analyse ({iso}).')
        first = r.iloc[0]
        name = str(first.country) if pd.notna(first.country) else str(cow_names.get(code, iso[0]))
        fp = frequency_profile.loc[frequency_profile.iso3.eq(iso[0])]
        freq = None
        if len(fp):
            f = fp.iloc[0]
            def flag(v):
                return None if pd.isna(v) else bool(v)
            freq = {'years': int(f.observed_years), 'warYears': int(f.war_years),
                    'share': num(f.war_year_share), 'wars': int(f.distinct_interstate_wars)
                    if pd.notna(f.distinct_interstate_wars) else 0,
                    'eligible': bool(f.frequency_eligible), 'aboveMean': flag(f.above_mean_share),
                    'aboveP90': flag(f.above_p90_share), 'aboveCount': flag(f.above_mean_count)}
        entities.append({'ccode': int(code), 'iso3': iso[0], 'name': name,
                         'cow': str(cow_names.get(code, name)), 'continent': str(first.continent), 'freq': freq})
    index_of = {e['ccode']: i for i, e in enumerate(entities)}

    # Kriegsnamen je Land und Jahr (nur Jahre mit erfasster Beteiligung).
    war_names = {}
    w = war_country_year.loc[war_country_year.ccode.isin(used) & war_country_year.at_interstate_war.fillna(False).astype(bool)
                             & war_country_year.year.between(1950, 2014)]
    for row in w.itertuples(index=False):
        war_names[f'{index_of[int(row.ccode)]}-{int(row.year)}'] = row.war_names

    write_js('meta', {
        'entities': entities, 'warNames': war_names,
        'frequency': {'meanShare': num(ns['frequency_mean_share']), 'p90Share': num(ns['frequency_q90_share']),
                      'meanCount': num(ns['frequency_mean_count']),
                      'minYears': int(ns['WAR_CONFIG']['minimum_frequency_years'])},
        'built': pd.Timestamp.now(tz='Europe/Berlin').isoformat(timespec='seconds'),
    })

    # ---------- Länderjahre ----------
    cy_codes = {'Keine Beteiligung erfasst': 0, 'Beteiligung erfasst': 1, 'Status unbekannt': 2}
    h8_codes = {'Keine Beteiligung im Folgefenster': 0, 'Beteiligung im Folgefenster': 1, 'Folgefenster unbekannt': 2}

    def country_year_payload(key, extra=None):
        spec = all_specs[key]
        d = ns['complete'](spec['df'], [spec['x'], spec['y']]).reset_index(drop=True)
        cols = {
            'e': column(d.ccode.astype(int).map(index_of), 'u16'),
            'year': column(d.year.astype(int), 'u16'),
            'x': column(d[spec['x']], 'f32'),
            'y': column(d[spec['y']], 'f32'),
            'war': column(d.war_group.map(cy_codes), 'u8'),
        }
        for name, (col, kind, mapping) in (extra or {}).items():
            values = d[col].map(mapping) if mapping else d[col]
            cols[name] = column(values, kind)
        return {'n': len(d), 'unit': 'country', 'cols': cols}

    payloads = {
        'H1': country_year_payload('H1'),
        'H2': country_year_payload('H2'),
        'E1': country_year_payload('E1'),
        'E2': country_year_payload('E2'),
        'H8': country_year_payload('H8', {'warNext': ('future_window_war_group', 'u8', h8_codes)}),
    }
    for key, payload in payloads.items():
        write_js(key, payload)

    # ---------- Länderpaare ----------
    pair_codes = {'Keines beteiligt': 0, 'Ein Land beteiligt': 1, 'Beide beteiligt': 2, 'Status unbekannt': 3}
    window_codes = {'Keines in t-1 oder t': 0, 'Ein Land in t-1 oder t': 1, 'Beide in t-1 oder t': 2, 'Status unbekannt': 3}

    def pair_base(d):
        return {
            'e1': column(d.ccode1.astype(int).map(index_of), 'u16'),
            'e2': column(d.ccode2.astype(int).map(index_of), 'u16'),
            'year': column(d.year.astype(int), 'u16'),
            'war': column(d.war_group.map(pair_codes), 'u8'),
        }

    h3 = all_specs['H3']
    d3 = ns['complete'](h3['df'], [h3['x'], h3['y']]).reset_index(drop=True)
    cols = pair_base(d3)
    cols.update({'x': column(d3[h3['x']], 'f32'), 'y': column(d3[h3['y']], 'f32'),
                 'g1': column(d3.military_growth_pct1, 'f32'), 'g2': column(d3.military_growth_pct2, 'f32'),
                 'warWindow': column(d3.war_window_group.map(window_codes), 'u8')})
    write_js('H3', {'n': len(d3), 'unit': 'pair', 'cols': cols})

    # H4, E3, E4, E5 teilen dieselbe qualitätsgeprüfte Handelsstichprobe.
    trade = all_specs['H4']['df'].reset_index(drop=True)
    extras = ns['trade'].reset_index(drop=True)
    if len(trade) != len(extras) or not (trade[['ccode1', 'ccode2', 'year']].to_numpy() ==
                                         extras[['ccode1', 'ccode2', 'year']].to_numpy()).all():
        raise RuntimeError('Handelsstichprobe und Zusatzvariablen sind nicht zeilengleich.')
    cols = pair_base(trade)
    for name, col in [('wealth', 'wealth_gap_log'), ('share', 'mutual_import_share'),
                      ('sizeGap', 'total_gdp_gap_log'), ('asymAbs', 'asymmetry_abs'),
                      ('asymRel', 'asymmetry_relative'), ('logDist', 'log_distance')]:
        cols[name] = column(extras[col], 'f32')
    cols['contig'] = column(extras.contig.fillna(2).astype(int), 'u8')
    cols['lang'] = column(extras.comlang_off.fillna(2).astype(int), 'u8')
    write_js('TRADE', {'n': len(trade), 'unit': 'pair', 'cols': cols})

    # ---------- Referenzwerte aus dem Notebook (zur Kontrolle und Anzeige) ----------
    rt = ns['report_tables']
    reference = {'baseline': {}, 'withinBetween': {}, 'bootstrap': {}}
    for row in rt['Correlations'].to_dict('records'):
        reference['baseline'][row['hypothesis']] = {k: num(row[k]) for k in ['n', 'pearson_r', 'spearman_rho', 'p_standard']}
    for row in rt['New_questions'].to_dict('records'):
        reference['baseline'][row['analysis'].split('_')[0]] = {k: num(row[k]) for k in ['n', 'pearson_r', 'spearman_rho', 'p_standard']}
    for row in rt['Within_between'].to_dict('records'):
        reference['withinBetween'].setdefault(row['hypothesis'], {})[row['variant']] = {
            'n': num(row['n']), 'r': num(row['pearson_r']), 'rho': num(row['spearman_rho'])}
    for row in rt['Country_bootstrap'].to_dict('records'):
        reference['bootstrap'][row['hypothesis']] = [num(row['pearson_ci_low']), num(row['pearson_ci_high'])]
    write_js('reference', reference)

    print('\nKontrolle (Notebook-Referenz):')
    for key, ref in reference['baseline'].items():
        print(f"  {key}: n={ref['n']:,.0f}  r={ref['pearson_r']:+.4f}  rho={ref['spearman_rho']:+.4f}")


if __name__ == '__main__':
    sys.exit(main())
