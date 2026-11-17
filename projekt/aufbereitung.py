"""Schritt 1: Datenaufbereitung.

Liest die zehn Originaldateien, bereinigt sie, führt sie zusammen und erzeugt für jede
Hypothese eine fertige Stichprobe vollständiger Wertepaare. Die Analyse (Schritt 2)
arbeitet nur noch mit diesen Stichproben; die Originaldateien werden nie verändert.

    from projekt import aufbereitung
    daten = aufbereitung.lade()          # führt alle Schritte unten aus
    h1 = daten.stichproben['H1']         # Spalten x, y, Land, Jahr, Kontinent, Kriegsstatus …

Ablauf in erstelle():
    1  Originaldaten einlesen
    2  Messwerte bereinigen
    3  Länder eindeutig zuordnen (COW-Code -> ISO-Code, historische Staaten getrennt)
    4  SIPRI-Militärausgaben ins lange Format und Wachstumsraten
    5  Länderjahre zusammenführen (Personal, Produktivität, Wachstum, Ausgaben)
    6  Importstruktur und Handelsabdeckung
    7  Länderpaare (Handelsanteil, Ausgabenlücke, Wohlstandslücke)
    8  Exportentfernung für H8
    9  Hypothesentabellen mit Ausschlussprotokoll und Qualitätsprüfung
   10  Analysestichproben (Handelsabdeckung beider Länder, Nebenfragen E1–E5)
   11  Kriegs- und Kontinentkontext je Land und Jahr
   12  Kontext an jede Stichprobe anhängen, Spalten x und y setzen
"""
from dataclasses import dataclass
import hashlib
import importlib.util
import re
import unicodedata

import numpy as np
import pandas as pd

from . import einstellungen as E
from .laendercodes import (CEPII_CODE_RENAMES, CONTINENT_MAP, COW_TO_ISO, HISTORICAL_IDS,
                           MODERN_MIN_YEAR, NAME_ALIASES, SOUTH_AMERICA_ISO)
from .statistik import complete


@dataclass
class Daten:
    """Ergebnis von Schritt 1."""
    stichproben: dict   # 'H1' … 'E5' -> fertige Wertepaare mit Kontext und Spalten x, y
    tabellen: dict      # Zwischentabellen und Protokolle für Zusatzanalysen, Bericht und Website


# ====================================================================================
# Laden
# ====================================================================================

_daten = None


def lade(neu=False):
    """Führt Schritt 1 aus (ca. 15 Sekunden). In derselben Sitzung wird das Ergebnis wiederverwendet."""
    global _daten
    if _daten is None or neu:
        _daten = erstelle()
    return _daten


def erstelle(verbose=True):
    """Führt alle Aufbereitungsschritte nacheinander aus."""
    say = print if verbose else (lambda *a: None)
    say('1  Originaldaten einlesen …')
    raw, metadata, source_catalog = lese_rohdaten()
    say('2  Messwerte bereinigen')
    q = bereinige_quellen(raw)
    say('3  Länder zuordnen')
    q = ordne_laender_zu(q)
    say('4  SIPRI-Militärausgaben')
    sipri, sipri_unmapped_rows = bereite_sipri_auf(raw, q)
    say('5  Länderjahre')
    country_year, scope_review = bilde_laenderjahre(q, sipri)
    say('6  Importstruktur')
    directed_trade, country_year = bilde_importstruktur(q, country_year)
    say('7  Länderpaare')
    dyad_year = bilde_laenderpaare(q, country_year)
    say('8  Exportentfernung')
    country_year = bilde_exportentfernung(q, directed_trade, country_year)
    say('9  Hypothesentabellen und Prüfung')
    tables, protokoll = bilde_hypothesentabellen(country_year, dyad_year)
    protokoll['data_dictionary'] = pruefe(raw, tables)
    say('10 Analysestichproben')
    basis, trade, urban, abdeckung = bilde_analysestichproben(tables, country_year, q)
    say('11 Kriegs- und Kontinentkontext')
    krieg = bilde_kriegskontext(raw, country_year, q['geography'])
    say('12 Kontext anhängen')
    stichproben = ergaenze_kontext(basis, trade, urban, krieg)

    tabellen = {'basis': basis, 'trade': trade, 'country_year': country_year,
                'source_catalog': source_catalog, 'sipri_footnotes': metadata['sipri_footnotes'],
                'sipri_unmapped_rows': sipri_unmapped_rows, 'scope_review': scope_review,
                'state_list': q['state_list'], **protokoll, **abdeckung, **krieg}
    return Daten(stichproben, tabellen)


# ====================================================================================
# 1  Originaldaten einlesen
# ====================================================================================

def lese_rohdaten():
    missing_packages = [p for p in ['openpyxl', 'xlrd'] if importlib.util.find_spec(p) is None]
    if missing_packages:
        raise ImportError('Bitte zuerst installieren: ' + ', '.join(missing_packages))
    missing_files = [name for name in E.FILES.values() if not (E.DATA_DIR / name).is_file()]
    if missing_files:
        raise FileNotFoundError(f'Gesucht wird in {E.DATA_DIR}. Fehlende Dateien: {missing_files}')
    path = lambda key: E.DATA_DIR / E.FILES[key]
    raw = {}
    for key in ['nmc', 'national_trade', 'dyadic_trade', 'state_list', 'wars']:
        raw[key] = pd.read_csv(path(key), low_memory=False)
    raw['geography'] = pd.read_excel(path('geography'), engine='xlrd')
    raw['distance'] = pd.read_excel(path('distance'), engine='xlrd')
    raw['pwt'] = pd.read_excel(path('pwt'), sheet_name='Data', engine='openpyxl')
    raw['maddison'] = pd.read_excel(path('maddison'), sheet_name='Full data', engine='openpyxl')
    raw['sipri'] = pd.read_excel(path('sipri'), sheet_name='Constant (2024) US$', header=5, engine='openpyxl')
    metadata = {'sipri_footnotes': pd.read_excel(path('sipri'), sheet_name='Footnotes', header=None)}

    def sha256_file(p):
        h = hashlib.sha256()
        with p.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                h.update(chunk)
        return h.hexdigest()

    source_catalog = pd.DataFrame([
        {'dataset': key, 'filename': filename, 'rows': len(raw[key]),
         'columns': len(raw[key].columns), 'sha256': sha256_file(E.DATA_DIR / filename)}
        for key, filename in E.FILES.items()])
    return raw, metadata, source_catalog


# ====================================================================================
# 2  Messwerte bereinigen
# ====================================================================================

def require_unique(df, keys, label):
    """Bricht ab, wenn ein Schlüssel doppelt vorkommt (statt Duplikate still zu löschen)."""
    duplicates = df.duplicated(keys, keep=False)
    if duplicates.any():
        raise ValueError(f'{label}: {int(duplicates.sum())} doppelte Schlüssel für {keys}.\n'
                         f'{df.loc[duplicates, keys].head(10)}')


def numeric_measure(df, columns, nonnegative=True):
    """Messwerte als Zahlen; negative Fehlwert-Codes werden zu NaN, echte Nullen bleiben."""
    result = df.copy()
    for col in columns:
        result[col] = pd.to_numeric(result[col], errors='coerce').replace([np.inf, -np.inf], np.nan)
        if nonnegative:
            result.loc[result[col] < 0, col] = np.nan
    return result


def normalize_name(name):
    if pd.isna(name):
        return ''
    name = unicodedata.normalize('NFKD', str(name)).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '', name.lower().replace('&', 'and'))


def bereinige_quellen(raw):
    q = {}
    q['nmc'] = numeric_measure(raw['nmc'], ['milex', 'milper', 'irst', 'pec', 'tpop', 'upop', 'cinc'])
    q['national_trade'] = numeric_measure(raw['national_trade'], ['imports', 'exports', 'alt_imports', 'alt_exports'])
    q['dyadic_trade'] = numeric_measure(raw['dyadic_trade'], ['flow1', 'flow2', 'smoothflow1', 'smoothflow2', 'smoothtotrade',
        'bel_lux_alt_flow1', 'bel_lux_alt_flow2', 'china_alt_flow1', 'china_alt_flow2'])
    q['state_list'] = raw['state_list'].copy()
    pwt = numeric_measure(raw['pwt'], ['rgdpo', 'rgdpe', 'cgdpe', 'pop', 'emp'])
    pwt = pwt.rename(columns={'countrycode': 'iso3', 'country': 'pwt_country'})
    maddison = numeric_measure(raw['maddison'], ['gdppc', 'pop'])
    maddison = maddison.rename(columns={'countrycode': 'iso3', 'country': 'maddison_country',
                                        'pop': 'maddison_population_thousands'})
    geo_locations = raw['geography'].copy()  # mehrere Städte je Land sind absichtlich vorhanden
    distances = numeric_measure(raw['distance'], ['dist', 'distcap', 'distw', 'distwces'])
    distances = distances.rename(columns={'iso_o': 'iso3_origin', 'iso_d': 'iso3_destination'})
    for df in [pwt, maddison, geo_locations]:
        df['iso3'] = df['iso3'].astype('string').str.strip().str.upper()
    for col in ['iso3_origin', 'iso3_destination']:
        distances[col] = distances[col].astype('string').str.strip().str.upper()
    geo_locations['cepii_iso3_original'] = geo_locations['iso3']
    geo_locations['iso3'] = geo_locations['iso3'].replace(CEPII_CODE_RENAMES)
    for col in ['iso3_origin', 'iso3_destination']:
        distances['cepii_' + col + '_original'] = distances[col]
        distances[col] = distances[col].replace(CEPII_CODE_RENAMES)
    q.update(pwt=pwt, maddison=maddison, geo_locations=geo_locations, distances=distances)

    for key, keys, label in [
        ('nmc', ['ccode', 'year'], 'NMC'),
        ('national_trade', ['ccode', 'year'], 'National trade'),
        ('dyadic_trade', ['ccode1', 'ccode2', 'year'], 'Dyadic trade'),
        ('pwt', ['iso3', 'year'], 'PWT'),
        ('maddison', ['iso3', 'year'], 'Maddison'),
        ('distances', ['iso3_origin', 'iso3_destination'], 'CEPII distances')]:
        require_unique(q[key], keys, label)

    # Eine Länderübersicht ohne willkürliche Wahl einer Hauptstadtkoordinate.
    geography = geo_locations[['iso3', 'country', 'area', 'landlocked', 'continent']].drop_duplicates().reset_index(drop=True)
    require_unique(geography, ['iso3'], 'CEPII country attributes')
    q['geography'] = geography
    return q


# ====================================================================================
# 3  Länder eindeutig zuordnen
# ====================================================================================

def add_cow_identity(df, membership):
    """COW-Code -> ISO-Code; Sowjetunion, Jugoslawien usw. bekommen eigene historische Kennungen."""
    df = df.copy()
    df['iso3'] = df['ccode'].map(COW_TO_ISO).astype('string')
    df.loc[(df.ccode == 365) & (df.year.between(1922, 1991)), 'iso3'] = 'SUN'
    df.loc[(df.ccode == 365) & (df.year < 1922), 'iso3'] = 'RUS_HIST'
    df.loc[(df.ccode == 345) & (df.year < 1992), 'iso3'] = 'YUG'
    df.loc[(df.ccode == 345) & (df.year.between(1992, 2006)), 'iso3'] = 'SCG'
    df.loc[(df.ccode == 816) & (df.year < 1977), 'iso3'] = 'VDR'
    df = df.merge(membership, on=['ccode', 'year'], how='left', validate='many_to_one')
    df['in_cow_system'] = df['in_cow_system'].astype('boolean').fillna(False).astype(bool)
    return df


def add_scope_flags(df):
    """Markiert Länderjahre, die nicht quellenübergreifend vergleichbar sind (Gebietswechsel u. a.)."""
    df = df.copy()
    df['scope_review_required'] = df.iso3.isna() | df.iso3.isin(HISTORICAL_IDS | {'RUS_HIST'})
    df['scope_reason'] = np.where(df['scope_review_required'], 'historical_or_unmapped_entity', '')
    for iso, first_year in MODERN_MIN_YEAR.items():
        mask = df.iso3.eq(iso).fillna(False) & df.year.lt(first_year)
        df.loc[mask, 'scope_review_required'] = True
        df.loc[mask, 'scope_reason'] = 'territorial_transition_before_' + str(first_year)
    mask = df.iso3.eq('TZA').fillna(False)
    df.loc[mask, 'scope_review_required'] = True
    df.loc[mask, 'scope_reason'] = 'PWT_mainland_vs_other_sources_review'
    df['trade_scope_review'] = df.iso3.isin(['BEL', 'LUX']) & df.year.lt(1997)
    return df


def ordne_laender_zu(q):
    # Mitgliedschaft im Staatensystem je Jahr.
    membership = pd.concat([
        pd.DataFrame({'ccode': int(r.ccode), 'year': range(int(r.styear), int(r.endyear) + 1)})
        for r in q['state_list'].itertuples()
    ], ignore_index=True).drop_duplicates(['ccode', 'year'])
    membership['in_cow_system'] = True
    q['membership'] = membership
    q['nmc'] = add_scope_flags(add_cow_identity(q['nmc'], membership))
    q['national_trade'] = add_scope_flags(add_cow_identity(q['national_trade'], membership))
    q['pwt'] = add_scope_flags(q['pwt'])
    q['maddison'] = add_scope_flags(q['maddison'])
    return q


# ====================================================================================
# 4  SIPRI-Militärausgaben
# ====================================================================================

def bereite_sipri_auf(raw, q):
    # Ländernamen über die anderen Quellen und explizite Aliase zuordnen.
    name_candidates = {}
    for frame, iso_col, name_col in [
        (q['pwt'], 'iso3', 'pwt_country'), (q['maddison'], 'iso3', 'maddison_country'),
        (q['geo_locations'], 'iso3', 'country')]:
        for iso, name in frame[[iso_col, name_col]].drop_duplicates().itertuples(index=False, name=None):
            name_candidates.setdefault(normalize_name(name), set()).add(str(iso))
    for row in q['state_list'].itertuples():
        if row.ccode in COW_TO_ISO:
            name_candidates.setdefault(normalize_name(row.statenme), set()).add(COW_TO_ISO[row.ccode])
    aliases = {normalize_name(k): v for k, v in NAME_ALIASES.items()}

    def resolve_name(name):
        key = normalize_name(name)
        if key in aliases:
            return aliases[key]
        candidates = name_candidates.get(key, set())
        return next(iter(candidates)) if len(candidates) == 1 else pd.NA

    sipri_wide = raw['sipri'].copy()
    sipri_wide['iso3'] = sipri_wide['Country'].map(resolve_name).astype('string')
    year_columns = [c for c in sipri_wide.columns if isinstance(c, (int, np.integer)) and 1900 <= c <= 2100]
    value_count = sipri_wide[year_columns].apply(pd.to_numeric, errors='coerce').notna().sum(axis=1)
    sipri_unmapped_rows = sipri_wide.loc[sipri_wide.iso3.isna() & value_count.gt(0) &
                                         ~sipri_wide.Country.eq('European Union'), ['Country', 'Notes']].copy()

    sipri = sipri_wide.loc[sipri_wide.iso3.notna()].melt(
        id_vars=['Country', 'iso3', 'Notes'], value_vars=year_columns,
        var_name='year', value_name='military_spending_raw')
    sipri['year'] = sipri['year'].astype(int)
    sipri['military_spending_real_musd'] = pd.to_numeric(sipri['military_spending_raw'], errors='coerce')
    sipri.loc[sipri.military_spending_real_musd.lt(0), 'military_spending_real_musd'] = np.nan
    sipri = sipri.rename(columns={'Country': 'sipri_country', 'Notes': 'sipri_notes'})
    sipri = add_scope_flags(sipri)
    require_unique(sipri, ['iso3', 'year'], 'SIPRI long')

    # Wachstum gegenüber dem exakten Vorjahr (über die Jahreskennung, nicht die vorige Zeile).
    previous = sipri[['iso3', 'year', 'military_spending_real_musd', 'scope_review_required']].copy()
    previous['year'] += 1
    previous = previous.rename(columns={'military_spending_real_musd': 'spending_previous_year',
                                        'scope_review_required': 'previous_scope_review'})
    sipri = sipri.merge(previous, on=['iso3', 'year'], how='left', validate='one_to_one')
    valid = sipri.military_spending_real_musd.ge(0) & sipri.spending_previous_year.gt(0)
    sipri['military_growth_pct'] = np.nan
    sipri.loc[valid, 'military_growth_pct'] = 100 * (
        sipri.loc[valid, 'military_spending_real_musd'] / sipri.loc[valid, 'spending_previous_year'] - 1)
    sipri['growth_outlier_review'] = sipri.military_growth_pct.abs().gt(100)
    sipri['military_growth_eligible'] = (~sipri.scope_review_required &
        ~sipri.previous_scope_review.astype('boolean').fillna(True))
    return sipri, sipri_unmapped_rows


# ====================================================================================
# 5  Länderjahre zusammenführen
# ====================================================================================

def bilde_laenderjahre(q, sipri):
    nmc, pwt, maddison = q['nmc'], q['pwt'], q['maddison']
    nmc['military_per_1000'] = np.where(nmc.tpop.gt(0), 1000 * nmc.milper / nmc.tpop, np.nan)   # H1, H2
    pwt['productivity'] = np.where(pwt.emp.gt(0) & pwt.rgdpo.gt(0), pwt.rgdpo / pwt.emp, np.nan)  # H1
    pwt['gdp_pc_comparable'] = np.where(pwt['pop'].gt(0) & pwt.cgdpe.gt(0), pwt.cgdpe / pwt['pop'], np.nan)  # H4

    # H8: jährliches BIP-pro-Kopf-Wachstum von t bis t+5 (Maddison), ohne Interpolation.
    future = maddison[['iso3', 'year', 'gdppc']].rename(columns={'gdppc': 'gdppc_t_plus_5'}).copy()
    future['year'] -= 5
    maddison = maddison.merge(future, on=['iso3', 'year'], how='left', validate='one_to_one')
    valid = maddison.gdppc.gt(0) & maddison.gdppc_t_plus_5.gt(0)
    maddison['growth_next_5y_pct'] = np.nan
    maddison.loc[valid, 'growth_next_5y_pct'] = 100 * (
        (maddison.loc[valid, 'gdppc_t_plus_5'] / maddison.loc[valid, 'gdppc']) ** (1/5) - 1)
    q['maddison'] = maddison

    keys = pd.concat([nmc[['ccode', 'year']], q['national_trade'][['ccode', 'year']]], ignore_index=True).drop_duplicates()
    cy = add_scope_flags(add_cow_identity(keys, q['membership']))
    cy = cy.merge(nmc[['ccode', 'year', 'milper', 'tpop', 'military_per_1000']],
                  on=['ccode', 'year'], how='left', validate='one_to_one')
    cy = cy.merge(q['national_trade'][['ccode', 'year', 'imports', 'exports']],
                  on=['ccode', 'year'], how='left', validate='one_to_one')
    cy = cy.merge(pwt[['iso3', 'year', 'pwt_country', 'productivity', 'gdp_pc_comparable']],
                  on=['iso3', 'year'], how='left', validate='many_to_one')
    cy = cy.merge(maddison[['iso3', 'year', 'gdppc', 'gdppc_t_plus_5', 'growth_next_5y_pct']],
                  on=['iso3', 'year'], how='left', validate='many_to_one')
    cy = cy.merge(sipri[['iso3', 'year', 'military_spending_real_musd', 'military_growth_pct',
                         'growth_outlier_review', 'military_growth_eligible', 'sipri_notes']],
                  on=['iso3', 'year'], how='left', validate='many_to_one')
    cy['analysis_period'] = cy.year.between(E.START_YEAR, E.END_YEAR)
    cy['cross_source_eligible'] = (~cy.scope_review_required) & cy.in_cow_system
    require_unique(cy, ['ccode', 'year'], 'Country-year master')
    scope_review = cy.loc[cy.analysis_period & cy.scope_review_required, ['ccode', 'iso3', 'year', 'scope_reason']].copy()
    return cy, scope_review


# ====================================================================================
# 6  Importstruktur und Handelsabdeckung (H2)
# ====================================================================================

def bilde_importstruktur(q, country_year):
    # flow1 = Importe von Land 1 aus Land 2, flow2 = umgekehrt. Kein unbekannter Wert wird zu Null.
    base = q['dyadic_trade'].loc[q['dyadic_trade'].year.between(E.START_YEAR, E.END_YEAR)].copy()
    part_a = base[['ccode1', 'ccode2', 'year', 'flow1']].rename(columns={
        'ccode1': 'importer_ccode', 'ccode2': 'exporter_ccode', 'flow1': 'trade_value_musd'})
    part_b = base[['ccode2', 'ccode1', 'year', 'flow2']].rename(columns={
        'ccode2': 'importer_ccode', 'ccode1': 'exporter_ccode', 'flow2': 'trade_value_musd'})
    directed_trade = pd.concat([part_a, part_b], ignore_index=True)
    directed_trade = directed_trade.loc[directed_trade.importer_ccode.ne(directed_trade.exporter_ccode)].copy()
    require_unique(directed_trade, ['importer_ccode', 'exporter_ccode', 'year'], 'Directed trade')

    identity_cols = ['ccode', 'year', 'iso3', 'scope_review_required', 'trade_scope_review', 'in_cow_system']
    for role in ['importer', 'exporter']:
        identities = country_year[identity_cols].rename(columns={
            'ccode': role + '_ccode', 'iso3': role + '_iso3',
            'scope_review_required': role + '_scope_review', 'trade_scope_review': role + '_trade_review',
            'in_cow_system': role + '_in_cow_system'})
        directed_trade = directed_trade.merge(identities, on=[role + '_ccode', 'year'], how='left', validate='many_to_one')

    trade_totals = q['national_trade'][['ccode', 'year', 'imports', 'exports']]
    directed_trade = directed_trade.merge(
        trade_totals[['ccode', 'year', 'imports']].rename(columns={'ccode': 'importer_ccode', 'imports': 'national_imports_musd'}),
        on=['importer_ccode', 'year'], how='left', validate='many_to_one')
    directed_trade['partner_import_share'] = np.where(
        directed_trade.national_imports_musd.gt(0),
        directed_trade.trade_value_musd / directed_trade.national_imports_musd, np.nan)
    directed_trade.loc[~directed_trade.partner_import_share.between(0, 1), 'partner_import_share'] = np.nan

    import_summary = directed_trade.groupby(['importer_ccode', 'year'], as_index=False).agg(
        observed_imports_musd=('trade_value_musd', lambda x: x.sum(min_count=1)),
        known_partner_flows=('trade_value_musd', 'count'),
        listed_partner_flows=('trade_value_musd', 'size'))
    import_summary = import_summary.rename(columns={'importer_ccode': 'ccode'})
    import_summary = import_summary.merge(trade_totals[['ccode', 'year', 'imports']], on=['ccode', 'year'], validate='one_to_one')
    import_summary['import_coverage_ratio'] = np.where(import_summary.imports.gt(0),
        import_summary.observed_imports_musd / import_summary.imports, np.nan)
    import_summary['import_coverage_ok'] = import_summary.import_coverage_ratio.between(E.COVERAGE_MIN, E.COVERAGE_MAX)

    # H2: Importkonzentration = Summe der quadrierten Partneranteile (Herfindahl-Hirschman-Index).
    weights = directed_trade[['importer_ccode', 'year', 'trade_value_musd']].merge(
        import_summary[['ccode', 'year', 'observed_imports_musd']].rename(columns={'ccode': 'importer_ccode'}),
        on=['importer_ccode', 'year'], validate='many_to_one')
    weights['share_sq'] = np.where(weights.observed_imports_musd.gt(0),
        (weights.trade_value_musd / weights.observed_imports_musd)**2, np.nan)
    hhi = weights.groupby(['importer_ccode', 'year'])['share_sq'].sum(min_count=1).rename('import_hhi_observed').reset_index()
    import_summary = import_summary.merge(hhi.rename(columns={'importer_ccode': 'ccode'}), on=['ccode', 'year'], validate='one_to_one')
    country_year = country_year.merge(import_summary.drop(columns='imports'), on=['ccode', 'year'], how='left', validate='one_to_one')
    q['dyadic_base'] = base
    return directed_trade, country_year


# ====================================================================================
# 7  Länderpaare (H3, H4)
# ====================================================================================

def bilde_laenderpaare(q, country_year):
    dyad_year = q['dyadic_base'][['ccode1', 'ccode2', 'year', 'flow1', 'flow2']].copy()
    assert dyad_year.ccode1.lt(dyad_year.ccode2).all(), 'COW-Paarordnung prüfen.'
    attributes = ['ccode', 'year', 'iso3', 'cross_source_eligible', 'trade_scope_review', 'imports',
                  'gdp_pc_comparable', 'military_growth_pct', 'growth_outlier_review', 'military_growth_eligible']
    for side in ['1', '2']:
        renamed = country_year[attributes].rename(columns={c: c + side for c in attributes if c != 'year'})
        dyad_year = dyad_year.merge(renamed, on=['ccode' + side, 'year'], how='left', validate='many_to_one')
    # Handelsanteil: Mittel der beiden gerichteten Importanteile.
    valid_shares = (dyad_year.imports1.gt(0) & dyad_year.imports2.gt(0) &
                    dyad_year.flow1.ge(0) & dyad_year.flow2.ge(0))
    share1 = dyad_year.flow1 / dyad_year.imports1
    share2 = dyad_year.flow2 / dyad_year.imports2
    valid_shares &= share1.between(0, 1) & share2.between(0, 1)
    dyad_year['mutual_import_share'] = np.where(valid_shares, (share1 + share2) / 2, np.nan)
    # H3: absoluter Unterschied der jährlichen Ausgabenwachstumsraten (Prozentpunkte).
    dyad_year['military_growth_gap_pp'] = (dyad_year.military_growth_pct1 - dyad_year.military_growth_pct2).abs()
    # H4: absolute Differenz der logarithmierten BIP pro Kopf.
    positive_gdp = dyad_year.gdp_pc_comparable1.gt(0) & dyad_year.gdp_pc_comparable2.gt(0)
    dyad_year['wealth_gap_log'] = np.nan
    dyad_year.loc[positive_gdp, 'wealth_gap_log'] = (
        np.log(dyad_year.loc[positive_gdp, 'gdp_pc_comparable1']) -
        np.log(dyad_year.loc[positive_gdp, 'gdp_pc_comparable2'])).abs()
    dyad_year = dyad_year.merge(
        q['distances'][['iso3_origin', 'iso3_destination', E.DISTANCE_COLUMN]].rename(columns={
            'iso3_origin': 'iso31', 'iso3_destination': 'iso32', E.DISTANCE_COLUMN: 'distance_km'}),
        on=['iso31', 'iso32'], how='left', validate='many_to_one')
    dyad_year['pair_eligible'] = (
        dyad_year.cross_source_eligible1.astype('boolean').fillna(False) & dyad_year.cross_source_eligible2.astype('boolean').fillna(False) &
        ~dyad_year.trade_scope_review1.astype('boolean').fillna(True) & ~dyad_year.trade_scope_review2.astype('boolean').fillna(True))
    require_unique(dyad_year, ['ccode1', 'ccode2', 'year'], 'Dyad-year master')
    return dyad_year


# ====================================================================================
# 8  Exportentfernung (H8)
# ====================================================================================

def bilde_exportentfernung(q, directed_trade, country_year):
    directed_trade = directed_trade.merge(
        q['distances'][['iso3_origin', 'iso3_destination', E.DISTANCE_COLUMN]].rename(columns={
            'iso3_origin': 'exporter_iso3', 'iso3_destination': 'importer_iso3', E.DISTANCE_COLUMN: 'distance_km'}),
        on=['exporter_iso3', 'importer_iso3'], how='left', validate='many_to_one')
    # Historische oder zu prüfende Partner werden nicht mit heutiger Geografie gleichgesetzt.
    distance_eligible = (
        directed_trade.distance_km.gt(0) &
        ~directed_trade.exporter_scope_review.astype('boolean').fillna(True) &
        ~directed_trade.importer_scope_review.astype('boolean').fillna(True) &
        ~directed_trade.exporter_trade_review.astype('boolean').fillna(True) &
        ~directed_trade.importer_trade_review.astype('boolean').fillna(True))
    directed_trade['distance_trade_value'] = directed_trade.trade_value_musd.where(distance_eligible)
    directed_trade['weighted_distance_value'] = directed_trade.distance_trade_value * directed_trade.distance_km
    export_summary = directed_trade.groupby(['exporter_ccode', 'year'], as_index=False).agg(
        observed_exports_musd=('trade_value_musd', lambda x: x.sum(min_count=1)),
        exports_with_distance_musd=('distance_trade_value', lambda x: x.sum(min_count=1)),
        weighted_distance_sum=('weighted_distance_value', lambda x: x.sum(min_count=1)))
    export_summary = export_summary.rename(columns={'exporter_ccode': 'ccode'})
    trade_totals = q['national_trade'][['ccode', 'year', 'imports', 'exports']]
    export_summary = export_summary.merge(trade_totals[['ccode', 'year', 'exports']], on=['ccode', 'year'], validate='one_to_one')
    export_summary['export_coverage_ratio'] = np.where(export_summary.exports.gt(0),
        export_summary.observed_exports_musd / export_summary.exports, np.nan)
    export_summary['distance_coverage_ratio'] = np.where(export_summary.observed_exports_musd.gt(0),
        export_summary.exports_with_distance_musd / export_summary.observed_exports_musd, np.nan)
    export_summary['export_distance_observed_km'] = np.where(export_summary.exports_with_distance_musd.gt(0),
        export_summary.weighted_distance_sum / export_summary.exports_with_distance_musd, np.nan)
    export_summary['export_coverage_ok'] = export_summary.export_coverage_ratio.between(E.COVERAGE_MIN, E.COVERAGE_MAX)
    export_summary['distance_coverage_ok'] = export_summary.distance_coverage_ratio.ge(E.DISTANCE_COVERAGE_MIN)
    return country_year.merge(export_summary.drop(columns=['exports', 'weighted_distance_sum']),
                              on=['ccode', 'year'], how='left', validate='one_to_one')


# ====================================================================================
# 9  Hypothesentabellen, Ausschlussprotokoll und Qualitätsprüfung
# ====================================================================================

def bilde_hypothesentabellen(country_year, dyad_year):
    audit_rows = []

    def prepare_pairs(df, hypothesis, x, y, keys, rules):
        """Wendet die Regeln nacheinander an und protokolliert, wie viele Zeilen jede Regel entfernt."""
        current = df.copy()
        audit_rows.append({'hypothesis': hypothesis, 'step': 'start', 'remaining': len(current), 'removed': 0})
        for label, rule in rules:
            mask = rule(current).astype('boolean').fillna(False)
            removed = len(current) - int(mask.sum())
            current = current.loc[mask].copy()
            audit_rows.append({'hypothesis': hypothesis, 'step': label, 'remaining': len(current), 'removed': removed})
        finite = np.isfinite(pd.to_numeric(current[x], errors='coerce')) & np.isfinite(pd.to_numeric(current[y], errors='coerce'))
        removed = len(current) - int(finite.sum())
        current = current.loc[finite].copy()
        audit_rows.append({'hypothesis': hypothesis, 'step': 'finite_complete_pairs', 'remaining': len(current), 'removed': removed})
        require_unique(current, keys, hypothesis)
        current.attrs.update({'hypothesis': hypothesis, 'x': x, 'y': y})
        return current

    country_rules = [
        ('analysis_period', lambda d: d.analysis_period),
        ('country_scope_and_membership', lambda d: d.cross_source_eligible)]
    trade_country_rules = country_rules + [('trade_scope', lambda d: ~d.trade_scope_review)]
    pair_rules = [('pair_scope', lambda d: d.pair_eligible)]
    t = {}
    t['H1'] = prepare_pairs(country_year, 'H1', 'productivity', 'military_per_1000', ['ccode', 'year'], country_rules)
    t['H2'] = prepare_pairs(country_year, 'H2', 'import_hhi_observed', 'military_per_1000', ['ccode', 'year'],
        trade_country_rules + [('import_coverage', lambda d: d.import_coverage_ok)])
    t['H3'] = prepare_pairs(dyad_year, 'H3', 'mutual_import_share', 'military_growth_gap_pp',
        ['ccode1', 'ccode2', 'year'], pair_rules + [
            ('comparable_previous_years', lambda d:
                d.military_growth_eligible1.astype('boolean').fillna(False) &
                d.military_growth_eligible2.astype('boolean').fillna(False))])
    t['H4'] = prepare_pairs(dyad_year, 'H4', 'wealth_gap_log', 'mutual_import_share', ['ccode1', 'ccode2', 'year'], pair_rules)
    t['H8'] = prepare_pairs(country_year, 'H8', 'export_distance_observed_km', 'growth_next_5y_pct', ['ccode', 'year'],
        trade_country_rules + [
            ('export_coverage', lambda d: d.export_coverage_ok),
            ('distance_coverage', lambda d: d.distance_coverage_ok)])

    # H8: wie viele Paare unter strengeren/lockereren Abdeckungsregeln?
    h8_candidate_mask = (country_year.analysis_period & country_year.cross_source_eligible &
        ~country_year.trade_scope_review & country_year.export_distance_observed_km.gt(0) &
        np.isfinite(country_year.growth_next_5y_pct))
    h8_candidates = country_year.loc[h8_candidate_mask].copy()
    h8_coverage_sensitivity = pd.DataFrame([
        {'national_coverage_min': low, 'national_coverage_max': high, 'distance_coverage_min': dist_min,
         'n_complete_pairs': int((h8_candidates.export_coverage_ratio.between(low, high) &
                                  h8_candidates.distance_coverage_ratio.ge(dist_min)).sum())}
        for low, high in [(0.95, 1.05), (E.COVERAGE_MIN, E.COVERAGE_MAX), (0.80, 1.20)]
        for dist_min in [1.0, 0.95, 0.90]])
    sample_summary = pd.DataFrame([
        {'hypothesis': name, 'n_complete_pairs': len(df), 'minimum_5000_met': len(df) >= E.MIN_PAIRS,
         'first_year': df.year.min() if len(df) else pd.NA, 'last_year': df.year.max() if len(df) else pd.NA,
         'unit': 'country-year' if name in ['H1', 'H2', 'H8'] else 'unordered-dyad-year',
         'x': df.attrs['x'], 'y': df.attrs['y']}
        for name, df in t.items()])
    protokoll = {'audit': pd.DataFrame(audit_rows), 'sample_summary': sample_summary,
                 'h8_coverage_sensitivity': h8_coverage_sensitivity}
    return t, protokoll


def pruefe(raw, t):
    """Strukturelle Kontrollen der fertigen Tabellen und das Datenwörterbuch."""
    assert len(raw) == 10
    assert t['H1'].productivity.gt(0).all()
    assert t['H1'].military_per_1000.ge(0).all()
    assert t['H2'].import_hhi_observed.between(0, 1 + 1e-9).all()
    assert t['H3'].mutual_import_share.between(0, 1).all()
    assert t['H3'].military_growth_gap_pp.ge(0).all()
    assert t['H4'].wealth_gap_log.ge(0).all()
    assert t['H8'].export_distance_observed_km.gt(0).all()
    assert t['H8'].distance_coverage_ratio.ge(E.DISTANCE_COVERAGE_MIN).all()
    assert t['H8'].growth_next_5y_pct.gt(-100).all()
    return pd.DataFrame([
        ('productivity', 'real GDP / persons engaged', '2021 PPP USD per worker', 'PWT rgdpo / emp'),
        ('military_per_1000', 'military personnel / population * 1000', 'persons per 1000 inhabitants', 'NMC milper / tpop'),
        ('import_hhi_observed', 'sum of squared observed import shares', '0 to 1', 'COW bilateral imports'),
        ('mutual_import_share', 'mean of directed import shares', '0 to 1', 'COW bilateral / national imports'),
        ('military_growth_pct', 'real expenditure change from exact previous year', 'percent', 'SIPRI constant 2024 USD'),
        ('military_growth_gap_pp', 'absolute difference of annual growth rates', 'percentage points', 'SIPRI'),
        ('gdp_pc_comparable', 'expenditure-side GDP / population at current PPPs', '2021 PPP USD per person', 'PWT cgdpe / pop'),
        ('wealth_gap_log', 'absolute log GDP-per-capita difference', 'log units', 'PWT'),
        ('export_distance_observed_km', 'export-value-weighted distance among known-distance flows', 'km', 'COW + CEPII distw'),
        ('growth_next_5y_pct', 'compound annual GDP-per-capita growth from t to t+5', 'percent per year', 'Maddison gdppc'),
        ('import_coverage_ratio', 'sum of observed bilateral imports / national imports', 'ratio', 'COW'),
        ('export_coverage_ratio', 'sum of observed bilateral exports / national exports', 'ratio', 'COW'),
        ('distance_coverage_ratio', 'known exports with eligible distance / known exports', 'ratio', 'COW + CEPII'),
    ], columns=['variable', 'definition', 'unit', 'source'])


# ====================================================================================
# 10  Analysestichproben (Handelsabdeckung beider Länder, Nebenfragen)
# ====================================================================================

def bilde_analysestichproben(t, country_year, q):
    # H3/H4: beide Länder eines Paares brauchen eine Importabdeckung von 90–110 %.
    def pair_coverage(df):
        result = df.copy()
        for side in [1, 2]:
            c = country_year[['ccode', 'year', 'import_coverage_ratio']].rename(
                columns={'ccode': f'ccode{side}', 'import_coverage_ratio': f'import_coverage_{side}'})
            result = result.merge(c, on=[f'ccode{side}', 'year'], how='left', validate='many_to_one')
        return result
    h3_all, h4_all = pair_coverage(t['H3']), pair_coverage(t['H4'])
    ok = lambda d: d.import_coverage_1.between(0.90, 1.10) & d.import_coverage_2.between(0.90, 1.10)
    vorlage = {'H1': t['H1'].copy(), 'H2': t['H2'].copy(), 'H3': h3_all.loc[ok(h3_all)].copy(),
               'H4': h4_all.loc[ok(h4_all)].copy(), 'H8': t['H8'].copy()}
    basis = {}
    for name, d in vorlage.items():
        h = E.HYPOTHESEN[name]
        d = complete(d, [h.x, h.y]).reset_index(drop=True)
        keys = ['ccode', 'year'] if 'ccode' in d else ['ccode1', 'ccode2', 'year']
        require_unique(d, keys, name + ' extended sample')
        if 'ccode' not in d:
            d['pair_id'] = d.ccode1.astype(str) + '_' + d.ccode2.astype(str)
        basis[name] = d

    # E3–E5: Handelspaare mit Geografie (CEPII) und Gesamt-BIP (PWT).
    trade = basis['H4'].copy()
    geo_pair = q['distances'][['iso3_origin', 'iso3_destination', 'contig', 'comlang_off', 'comlang_ethno']].rename(
        columns={'iso3_origin': 'iso31', 'iso3_destination': 'iso32'})
    trade = trade.merge(geo_pair, on=['iso31', 'iso32'], how='left', validate='many_to_one')
    for side in [1, 2]:
        pp = q['pwt'][['iso3', 'year', 'pop', 'cgdpe']].rename(columns={'iso3': f'iso3{side}',
            'pop': f'pwt_pop{side}', 'cgdpe': f'pwt_total_gdp{side}'})
        trade = trade.merge(pp, on=[f'iso3{side}', 'year'], how='left', validate='many_to_one')
    trade['log_distance'] = np.log(trade.distance_km.where(trade.distance_km.gt(0)))
    trade['share1'] = trade.flow1 / trade.imports1; trade['share2'] = trade.flow2 / trade.imports2
    trade['asymmetry_abs'] = (trade.share1 - trade.share2).abs()
    trade['asymmetry_relative'] = trade.asymmetry_abs / (trade.share1 + trade.share2).where((trade.share1 + trade.share2).gt(0))
    trade['total_gdp_gap_log'] = (np.log(trade.pwt_total_gdp1.where(trade.pwt_total_gdp1.gt(0))) -
                                  np.log(trade.pwt_total_gdp2.where(trade.pwt_total_gdp2.gt(0)))).abs()
    trade['mean_log_total_gdp'] = (np.log(trade.pwt_total_gdp1.where(trade.pwt_total_gdp1.gt(0))) +
                                   np.log(trade.pwt_total_gdp2.where(trade.pwt_total_gdp2.gt(0)))) / 2
    trade['trade_share_pp'] = 100 * trade.mutual_import_share
    trade['border_group'] = trade.contig.map({0: 'No shared border', 1: 'Shared border'}).fillna('Unknown')
    trade['language_group'] = trade.comlang_off.map({0: 'No shared official language', 1: 'Shared official language'}).fillna('Unknown')
    trade['distance_group'] = pd.cut(trade.distance_km, [0, 1000, 3000, 6000, np.inf],
        labels=['0-1000 km', '1000-3000 km', '3000-6000 km', '6000+ km'], include_lowest=True)
    trade['wealth_group'] = pd.cut(trade.wealth_gap_log, [0, 0.5, 1, 2, np.inf],
        labels=['0-0.5', '0.5-1', '1-2', '2+'], include_lowest=True)

    # E2: Anteil der städtischen Bevölkerung (NMC).
    urban = country_year.merge(q['nmc'][['ccode', 'year', 'upop']], on=['ccode', 'year'], how='left', validate='one_to_one')
    urban = urban.loc[urban.analysis_period & urban.cross_source_eligible].copy()
    urban['urban_share'] = urban.upop / urban.tpop.where(urban.tpop.gt(0))
    urban.loc[~urban.urban_share.between(0, 1), 'urban_share'] = np.nan

    abdeckung = {'h3_all_coverage': h3_all, 'h4_all_coverage': h4_all,
                 'prepared_n': {'H3': len(t['H3']), 'H4': len(t['H4'])}}
    return basis, trade, urban, abdeckung


# ====================================================================================
# 11  Kriegs- und Kontinentkontext je Land und Jahr
# ====================================================================================

def bilde_kriegskontext(raw, country_year, geography):
    W = E.WAR_CONFIG
    # Kontinente nach CEPII; Amerika aufgeteilt in Nord- (inkl. Mittelamerika/Karibik) und Südamerika.
    lookup = geography[['iso3', 'country', 'continent']].copy().rename(columns={'continent': 'cepii_continent'})
    lookup['continent'] = lookup.cepii_continent.map(CONTINENT_MAP)
    american = lookup.cepii_continent.eq('America')
    lookup.loc[american, 'continent'] = 'Nordamerika'
    lookup.loc[american & lookup.iso3.isin(SOUTH_AMERICA_ISO), 'continent'] = 'Südamerika'
    lookup['continent'] = lookup.continent.fillna('Unbekannt')
    lookup['classification_note'] = np.where(american,
        'CEPII America split using explicit South America ISO list; remainder North America including Central America/Caribbean',
        'CEPII classification; Pacific renamed Oceania; transcontinental states assigned once')
    require_unique(lookup, ['iso3'], 'Continent mapping')

    # Kriegsbeteiligungen (bis zu zwei Episoden je Zeile) in einzelne Jahre zerlegen.
    episodes, issues = [], []
    for source_row, row in raw['wars'].iterrows():
        for episode in [1, 2]:
            fields = [f'{part}{episode}' for part in ['StartMonth', 'StartDay', 'StartYear', 'EndMonth', 'EndDay', 'EndYear']]
            vals = pd.to_numeric(row[fields], errors='coerce')
            if episode == 2 and vals.eq(-8).all(): continue   # -8: keine zweite Episode
            sy, ey = vals.iloc[2], vals.iloc[5]
            ongoing = ey == -7                                 # -7: läuft bis zum Quellenende
            if ongoing: ey = W['war_coverage_end']
            valid = pd.notna(sy) and pd.notna(ey) and sy > 0 and ey > 0 and ey >= sy
            record = {'source_row': int(source_row) + 2, 'war_id': int(row.WarNum), 'war_name': row.WarName,
                'ccode': int(row.ccode), 'state_name_raw': row.StateName, 'side_raw': int(row.Side),
                'episode': episode, 'start_year': int(sy) if pd.notna(sy) and sy > 0 else np.nan,
                'end_year': int(ey) if pd.notna(ey) and ey > 0 else np.nan,
                'ongoing_at_source_end': bool(ongoing), 'valid_year_bounds': bool(valid)}
            if valid: episodes.append(record)
            else: issues.append({**record, 'reason': 'unknown_or_invalid_episode_year_bounds'})
    cols = ['source_row', 'war_id', 'war_name', 'ccode', 'state_name_raw', 'side_raw', 'episode',
            'start_year', 'end_year', 'ongoing_at_source_end', 'valid_year_bounds']
    war_episodes = pd.DataFrame(episodes, columns=cols)
    war_date_issues = pd.DataFrame(issues, columns=cols + ['reason'])

    annual = []
    for row in war_episodes.itertuples(index=False):
        for year in range(max(int(row.start_year), W['war_coverage_start']), min(int(row.end_year), W['war_coverage_end']) + 1):
            annual.append({'ccode': row.ccode, 'year': year, 'war_id': row.war_id, 'war_name': row.war_name})
    war_participation_years = pd.DataFrame(annual).drop_duplicates(['ccode', 'year', 'war_id'])
    annual_wars = war_participation_years.groupby(['ccode', 'year'], as_index=False).agg(
        interstate_wars_n=('war_id', 'nunique'),
        war_ids=('war_id', lambda s: ','.join(str(v) for v in sorted(set(s)))),
        war_names=('war_name', lambda s: '; '.join(sorted(set(s)))))

    # Kriegsstatus je Land und Jahr; nach 2007 und bei unklaren Daten "unbekannt", nie "Frieden".
    wcy = country_year[['ccode', 'iso3', 'year', 'in_cow_system', 'cross_source_eligible']].copy()
    wcy = wcy.merge(annual_wars, on=['ccode', 'year'], how='left', validate='one_to_one')
    wcy['war_known'] = wcy.year.between(W['war_coverage_start'], W['war_coverage_end']) & wcy.in_cow_system
    for row in war_date_issues.itertuples(index=False):
        low = int(row.start_year) if pd.notna(row.start_year) else W['war_coverage_start']
        high = int(row.end_year) if pd.notna(row.end_year) else W['war_coverage_end']
        wcy.loc[wcy.ccode.eq(row.ccode) & wcy.year.between(low, high), 'war_known'] = False
    wcy['interstate_wars_n'] = wcy.interstate_wars_n.fillna(0).where(wcy.war_known)
    wcy['at_interstate_war'] = wcy.interstate_wars_n.gt(0).astype('boolean').where(wcy.war_known, pd.NA)
    for col in ['war_ids', 'war_names']:
        wcy[col] = wcy[col].fillna('').where(wcy.war_known, 'Unbekannter Status')
    wcy = wcy.merge(lookup[['iso3', 'continent', 'country']], on='iso3', how='left', validate='many_to_one')
    wcy['continent'] = wcy.continent.fillna('Unbekannt')
    wcy['country_label'] = wcy.country.fillna(wcy.iso3).fillna(wcy.ccode.astype(str))
    require_unique(wcy, ['ccode', 'year'], 'War country-year')

    # Kriegshäufigkeit je Land 1950–2007: Anteil der Jahre mit Kriegsbeteiligung.
    freq_base = wcy.loc[wcy.year.between(E.START_YEAR, min(E.END_YEAR, W['war_coverage_end'])) &
                        wcy.cross_source_eligible & wcy.war_known].copy()
    fp = freq_base.groupby('iso3', as_index=False).agg(
        country=('country_label', 'first'), continent=('continent', 'first'),
        observed_years=('year', 'nunique'), war_years=('at_interstate_war', 'sum'),
        first_observed_year=('year', 'min'), last_observed_year=('year', 'max'))
    distinct = freq_base[['ccode', 'iso3', 'year']].merge(war_participation_years, on=['ccode', 'year'], how='left', validate='one_to_many')
    distinct = distinct.groupby('iso3').war_id.nunique().rename('distinct_interstate_wars')
    fp = fp.merge(distinct, on='iso3', how='left', validate='one_to_one')
    fp['war_year_share'] = fp.war_years.astype(float) / fp.observed_years
    fp['wars_per_10_observed_years'] = 10 * fp.distinct_interstate_wars / fp.observed_years
    fp['frequency_eligible'] = fp.observed_years.ge(W['minimum_frequency_years'])
    ref = fp.loc[fp.frequency_eligible]
    mean_share, q90_share, mean_count = ref.war_year_share.mean(), ref.war_year_share.quantile(.9), ref.distinct_interstate_wars.mean()
    for name, mask in {'above_mean_share': fp.war_year_share.gt(mean_share),
                       'above_p90_share': fp.war_year_share.gt(q90_share),
                       'above_mean_count': fp.distinct_interstate_wars.gt(mean_count)}.items():
        fp[name] = mask.astype('boolean').where(fp.frequency_eligible, pd.NA)
    fp = fp.sort_values(['war_year_share', 'distinct_interstate_wars'], ascending=False).reset_index(drop=True)
    wcy = wcy.merge(fp[['iso3', 'observed_years', 'war_year_share', 'distinct_interstate_wars',
        'frequency_eligible', 'above_mean_share', 'above_p90_share', 'above_mean_count']], on='iso3', how='left', validate='many_to_one')
    return {'continent_lookup': lookup, 'war_episodes': war_episodes, 'war_date_issues': war_date_issues,
            'war_participation_years': war_participation_years, 'war_country_year': wcy, 'frequency_profile': fp,
            'frequency_thresholds': {'frequency_mean_share': mean_share, 'frequency_q90_share': q90_share,
                                     'frequency_mean_count': mean_count}}


# ====================================================================================
# 12  Kontext an jede Stichprobe anhängen
# ====================================================================================

def attach_context(df, war_country_year):
    """Ergänzt Kontinent, Kriegsstatus und Kriegshäufigkeit (bei Paaren für beide Länder)."""
    result = df.copy()
    fields = ['ccode', 'year', 'at_interstate_war', 'war_known', 'war_names', 'continent', 'country_label',
              'observed_years', 'war_year_share', 'distinct_interstate_wars', 'frequency_eligible',
              'above_mean_share', 'above_p90_share', 'above_mean_count']
    if 'ccode' in result:
        result = result.merge(war_country_year[fields], on=['ccode', 'year'], how='left', validate='one_to_one')
        result['war_group'] = np.where(result.war_known.fillna(False),
            np.where(result.at_interstate_war.fillna(False), 'Beteiligung erfasst', 'Keine Beteiligung erfasst'), 'Status unbekannt')
        result['war_any'] = result.at_interstate_war.astype('Float64')
    else:
        for side in [1, 2]:
            ctx = war_country_year[fields].rename(columns={c: f'{c}_{side}' for c in fields if c != 'year'})
            ctx = ctx.rename(columns={f'ccode_{side}': f'ccode{side}'})
            result = result.merge(ctx, on=[f'ccode{side}', 'year'], how='left', validate='many_to_one')
        known = result.war_known_1.fillna(False) & result.war_known_2.fillna(False)
        count = result.at_interstate_war_1.astype('Float64') + result.at_interstate_war_2.astype('Float64')
        result['war_countries_n'] = count.where(known)
        result['war_known'] = known
        result['war_group'] = count.map({0: 'Keines beteiligt', 1: 'Ein Land beteiligt', 2: 'Beide beteiligt'}).fillna('Status unbekannt')
        result['war_any'] = count.gt(0).astype('Float64').where(known)
        result['war_both'] = count.eq(2).astype('Float64').where(known)
        a = result.continent_1.fillna('Unbekannt'); b = result.continent_2.fillna('Unbekannt')
        result['continent_pair'] = np.where(a.le(b), a + ' / ' + b, b + ' / ' + a)
        result['continent_relation'] = np.where(result.continent_1.eq('Unbekannt') | result.continent_2.eq('Unbekannt'), 'Unbekannt',
            np.where(result.continent_1.eq(result.continent_2), 'Gleicher Kontinent', 'Verschiedene Kontinente'))
    return result


def ergaenze_kontext(basis, trade, urban, krieg):
    wcy = krieg['war_country_year']
    quellen = {**basis, 'E1': basis['H2'], 'E2': urban, 'E3': trade, 'E4': trade, 'E5': trade}
    stichproben = {}
    for name, h in E.HYPOTHESEN.items():
        d = quellen[name]
        if name.startswith('E'):
            d = complete(d, [h.x, h.y]).reset_index(drop=True)
            if 'ccode' not in d and 'pair_id' not in d:
                d['pair_id'] = d.ccode1.astype(str) + '_' + d.ccode2.astype(str)
        stichproben[name] = attach_context(d, wcy)

    # H3: Kriegsstatus in t-1 oder t, weil die Ausgabenänderung beide Jahre verwendet.
    h3 = stichproben['H3']
    for side in [1, 2]:
        previous = wcy[['ccode', 'year', 'at_interstate_war', 'war_known']].copy(); previous.year += 1
        previous = previous.rename(columns={'ccode': f'ccode{side}', 'at_interstate_war': f'war_previous_{side}',
                                            'war_known': f'previous_known_{side}'})
        h3 = h3.merge(previous, on=[f'ccode{side}', 'year'], how='left', validate='many_to_one')
    window_known = h3.war_known & h3.previous_known_1.fillna(False) & h3.previous_known_2.fillna(False)
    window_count = sum((h3[f'at_interstate_war_{s}'].fillna(False) | h3[f'war_previous_{s}'].fillna(False)).astype(int) for s in [1, 2])
    h3['war_window_group'] = window_count.where(window_known).map(
        {0: 'Keines in t-1 oder t', 1: 'Ein Land in t-1 oder t', 2: 'Beide in t-1 oder t'}).fillna('Status unbekannt')
    stichproben['H3'] = h3

    # H8: Kriegsbeteiligung im späteren Wachstumsfenster t+1 bis t+5.
    hh = stichproben['H8']
    for lag in range(1, 6):
        future = wcy[['ccode', 'year', 'at_interstate_war', 'war_known']].copy(); future.year -= lag
        future = future.rename(columns={'at_interstate_war': f'future_war_{lag}', 'war_known': f'future_known_{lag}'})
        hh = hh.merge(future, on=['ccode', 'year'], how='left', validate='one_to_one')
    fk = hh[[f'future_known_{i}' for i in range(1, 6)]].fillna(False).all(axis=1)
    fw = hh[[f'future_war_{i}' for i in range(1, 6)]].fillna(False).any(axis=1)
    hh['future_window_war_group'] = np.where(fk, np.where(fw, 'Beteiligung im Folgefenster', 'Keine Beteiligung im Folgefenster'), 'Folgefenster unbekannt')
    stichproben['H8'] = hh

    # Einheitliche Spalten x und y: die Analyse funktioniert für jede Hypothese gleich.
    for name, h in E.HYPOTHESEN.items():
        stichproben[name]['x'] = stichproben[name][h.x]
        stichproben[name]['y'] = stichproben[name][h.y]
    return stichproben
