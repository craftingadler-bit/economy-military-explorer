"""Alle Einstellungen an einer Stelle: Pfade, Zeitraum, Schwellen und die Hypothesen.

Wer eine Annahme ändern will (z. B. die Handelsabdeckung), ändert sie nur hier.
"""
from dataclasses import dataclass
from pathlib import Path

# ---------- Ordner und Dateien ----------
PROJECT_DIR = Path(__file__).resolve().parent.parent   # Projektordner, in dem Data/ liegt
DATA_DIR = PROJECT_DIR / 'Data'                         # Originaldaten, werden nie verändert
RESULTS_DIR = PROJECT_DIR / 'Ergebnisse'                # Excel-Bericht aus Schritt 4

FILES = {
    'nmc': 'NMC-70-abridged.csv',
    'national_trade': 'National_COW_4.0.csv',
    'dyadic_trade': 'Dyadic_COW_4.0.csv',
    'state_list': 'statelist2024.csv',
    'geography': 'geo_cepii.xls',
    'distance': 'dist_cepii.xls',
    'maddison': 'mpd2023_web.xlsx',
    'sipri': 'SIPRI-Milex-data-1949-2025_v1.2.xlsx',
    'pwt': 'pwt110.xlsx',
    'wars': 'Inter-StateWarData_v4.0.csv',
}

# ---------- Zeitraum und Qualitätsregeln der Aufbereitung ----------
START_YEAR, END_YEAR = 1950, 2014
DISTANCE_COLUMN = 'distw'            # bevölkerungsgewichtete Entfernung in km (CEPII)
COVERAGE_MIN, COVERAGE_MAX = 0.90, 1.10   # bilaterale Importe müssen 90–110 % der nationalen Importe abdecken
DISTANCE_COVERAGE_MIN = 0.95         # H8: mindestens 95 % der Exporte mit bekannter Entfernung
MIN_PAIRS = 5000                     # Kursvorgabe je Hypothese

# ---------- Kriegsdaten (COW Inter-State War) ----------
WAR_CONFIG = {
    'war_coverage_start': 1816, 'war_coverage_end': 2007,
    'minimum_frequency_years': 10,
    'group_min_n': 30, 'tail_rows_per_direction': 3,
    'chart_dpi': 105,
    'include_crossed_war_continent': True,
    'manual_exclude_iso3': [],
}
CONTINENTS = ['Afrika', 'Asien', 'Europa', 'Nordamerika', 'Südamerika', 'Ozeanien']

# ---------- Parameter der Zusatzanalysen ----------
CONFIG = {
    'trim_lower': 0.01, 'trim_upper': 0.99,
    'iqr_multiplier': 1.5, 'mad_z_limit': 3.5,
    'min_group_n': 30, 'min_country_years': 10,
    'top_observations': 25, 'bootstrap_repeats': 2000,
    'random_seed': 42, 'coverage_low': 0.90, 'coverage_high': 1.10,
    'sensitivity_delta_r': 0.10,
}


# ---------- Die Hypothesen ----------
@dataclass(frozen=True)
class Hypothese:
    titel: str
    x: str              # Spaltenname der unabhängigen Variable
    y: str              # Spaltenname der abhängigen Variable
    erwartet: str       # 'positive' oder 'negative'
    einheit: str        # 'Länderjahr' oder 'Länderpaar-Jahr'
    rolle: str          # 'Haupthypothese', 'explorativ' oder 'Nebenfrage'


HYPOTHESEN = {
    'H1': Hypothese('Produktivität und Militärpersonal', 'productivity', 'military_per_1000', 'negative', 'Länderjahr', 'Haupthypothese'),
    'H2': Hypothese('Importkonzentration und Militärpersonal', 'import_hhi_observed', 'military_per_1000', 'positive', 'Länderjahr', 'Haupthypothese'),
    'H3': Hypothese('Handelsverflechtung und Militärausgabenwachstum', 'mutual_import_share', 'military_growth_gap_pp', 'negative', 'Länderpaar-Jahr', 'Haupthypothese'),
    'H4': Hypothese('Wohlstandsunterschied und Handel', 'wealth_gap_log', 'mutual_import_share', 'negative', 'Länderpaar-Jahr', 'Haupthypothese'),
    'H8': Hypothese('Exportdistanz und späteres Wachstum', 'export_distance_observed_km', 'growth_next_5y_pct', 'positive', 'Länderjahr', 'explorativ'),
    'E1': Hypothese('Bevölkerung und Importkonzentration', 'tpop', 'import_hhi_observed', 'negative', 'Länderjahr', 'Nebenfrage'),
    'E2': Hypothese('Urbanisierung und Militärpersonal', 'urban_share', 'military_per_1000', 'negative', 'Länderjahr', 'Nebenfrage'),
    'E3': Hypothese('Wirtschaftsgröße und absolute Asymmetrie', 'total_gdp_gap_log', 'asymmetry_abs', 'positive', 'Länderpaar-Jahr', 'Nebenfrage'),
    'E4': Hypothese('Wirtschaftsgröße und relative Asymmetrie', 'total_gdp_gap_log', 'asymmetry_relative', 'positive', 'Länderpaar-Jahr', 'Nebenfrage'),
    'E5': Hypothese('Entfernung und Handel', 'log_distance', 'mutual_import_share', 'negative', 'Länderpaar-Jahr', 'Nebenfrage'),
}
MAIN = ['H1', 'H2', 'H3', 'H4']

# Achsentitel der Grafiken
LABELS = {
    'productivity': 'Real GDP per worker (2021 PPP USD)',
    'military_per_1000': 'Military personnel per 1,000 inhabitants',
    'import_hhi_observed': 'Observed import concentration (HHI)',
    'mutual_import_share': 'Mutual import share (0-1)',
    'military_growth_gap_pp': 'Military expenditure growth gap (pp)',
    'wealth_gap_log': 'Absolute log GDP-per-capita gap',
    'export_distance_observed_km': 'Export-weighted partner distance (km)',
    'growth_next_5y_pct': 'Subsequent 5-year annual GDPpc growth (%)',
    'total_gdp_gap_log': 'Absolute log total GDP gap',
    'asymmetry_abs': 'Absolute difference in import shares (0-1)',
}
