"""Schritt 4: der vollständige Excel-Bericht (alle Tabellen und Grafiken in einer Datei).

    pfad = bericht.erstelle(daten)       # dauert einige Minuten, schreibt nach Ergebnisse/

Die Gestaltung der Blätter ist unverändert aus der bisherigen Analyse übernommen.
"""
from datetime import datetime
from io import BytesIO
import math
from zoneinfo import ZoneInfo

import numpy as np
import openpyxl
from openpyxl.drawing.image import Image as ExcelImage
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
import pandas as pd

from . import einstellungen as E
from . import grafiken, zusatzanalysen
from .einstellungen import HYPOTHESEN, WAR_CONFIG
from .zusatzanalysen import ANALYSIS_CODE_SHA256

WAR_CODE_SHA256 = '0120536a53a2581adb0ecd7bf03dd1e4d01217f36bfaf9d4719d87b0b0275fbe'


def erstelle(daten, ziel=None, verbose=True):
    """Zusatzanalysen rechnen, Grafiken zeichnen und alles in eine Excel-Datei schreiben."""
    zusatz = zusatzanalysen.berechne(daten, verbose)
    if verbose: print('Grafiken für den Bericht …')
    charts = grafiken.bericht_grafiken(daten, zusatz)
    if verbose: print('Excel schreiben …')
    workbook = schreibe(daten, zusatz, charts)
    output_dir = ziel or E.RESULTS_DIR
    output_dir.mkdir(exist_ok=True)
    stamp = datetime.now(ZoneInfo('Europe/Berlin')).strftime('%Y-%m-%d_%H-%M-%S_%f_%z')
    path = output_dir / f'Analysebericht_Krieg_Kontinente_{stamp}.xlsx'
    with path.open('xb') as stream:
        workbook.save(stream)
    if verbose:
        print('FERTIG:', path)
        print('Einzelne Datei:', len(charts), 'Grafiken;', len(zusatz['group_results']), 'Gruppen;',
              len(zusatz['group_extremes']), 'Extremfallzeilen.')
    return path


def typed_excel(value):
    if value is None or value is pd.NA: return None
    if isinstance(value, np.generic): value = value.item()
    if isinstance(value, float) and not np.isfinite(value): return None
    if isinstance(value, (list, dict, tuple)): return str(value)
    if pd.isna(value): return None
    if isinstance(value, str) and value.startswith(('=', '+', '-', '@')): return "'" + value
    return value


def write_frame(wb, name, df):
    if len(df) > 1_048_575: raise ValueError(name + ': Excel-Zeilenlimit überschritten')
    ws = wb.create_sheet(name[:31]); ws.sheet_view.showGridLines = False
    ws.append(list(df.columns))
    for row in df.itertuples(index=False, name=None): ws.append([typed_excel(v) for v in row])
    ws.freeze_panes = 'B2'; ws.auto_filter.ref = ws.dimensions
    for j, col in enumerate(df.columns, 1):
        c = ws.cell(1, j); c.font = Font(name='Arial', size=10, bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='243952')
        c.alignment = Alignment(wrap_text=True, horizontal='center', vertical='center')
        vals = df[col].dropna().astype(str).head(100)
        width = min(55, max(13, len(str(col)) + 2, max([0] + [len(v) + 2 for v in vals])))
        ws.column_dimensions[get_column_letter(j)].width = width
        for row in ws.iter_rows(min_row=2, min_col=j, max_col=j):
            cell = row[0]; cell.font = Font(name='Arial', size=10, color='182638')
            if isinstance(cell.value, float): cell.number_format = '0.000E+00' if col.startswith('p_') or col.endswith('_p_standard') else '0.0000'
            if isinstance(cell.value, str) and len(cell.value) > width - 2:
                cell.alignment = Alignment(wrap_text=True, vertical='top')
                ws.row_dimensions[cell.row].height = min(409, max(ws.row_dimensions[cell.row].height or 18, 14*math.ceil(len(cell.value)/(max(width - 2, 1)*.85)) + 4))
    ws.row_dimensions[1].height = 42
    return ws


def schreibe(daten, zusatz, context_charts):
    T = daten.tabellen
    th = T['frequency_thresholds']
    all_specs, group_registry = zusatz['all_specs'], zusatz['group_registry']
    group_results, group_extremes, group_insights = zusatz['group_results'], zusatz['group_extremes'], zusatz['group_insights']
    HYP_TITLES = {k: h.titel for k, h in HYPOTHESEN.items()}

    workbook = openpyxl.Workbook(); workbook.remove(workbook.active)
    start_sheet = workbook.create_sheet('Start'); start_sheet.sheet_view.showGridLines = False
    start_sheet.column_dimensions['A'].width = 3; start_sheet.column_dimensions['B'].width = 50; start_sheet.column_dimensions['C'].width = 100
    start_sheet['B2'] = 'Kriegsstatus und Kontinente'; start_sheet['B2'].font = Font(name='Arial', size=16, bold=True)
    intro = [
     ('Zeitraum', 'Hauptanalysen 1950-2014; Kriegsstatus und Häufigkeitsfilter nur bei bekannter COW-Abdeckung bis 2007.'),
     ('Kriegsbegriff', 'Erfasste Beteiligung an zwischenstaatlichem Krieg. Bürgerkriege fehlen. Keine erfasste Beteiligung bedeutet nicht allgemein Frieden.'),
     ('Häufigkeitsgrenze', f'Kriegsjahresanteil > {th["frequency_mean_share"]:.6f}, Referenzländer gleich gewichtet, mindestens {WAR_CONFIG["minimum_frequency_years"]} beobachtete Jahre.'),
     ('Einzelne Datei', 'Alle alten und neuen Grafiken sowie Kennzahlen sind in dieser Datei. Pro Hypothese zuerst das Blatt Bericht öffnen.'),
     ('Extremfälle', 'Obere/untere Werte von X, Y und Regressionsabweichungen; Rangextreme sind nicht automatisch Datenfehler.'),
     ('Abhängigkeit', 'n zählt Zeilen. Standard-p-Werte nehmen unabhängige Beobachtungen an; hier ist das nicht erfüllt. Gruppenvergleiche und Zusatzmodelle sind explorativ.'),
     ('Kontinentteilnahme', 'Bei Länderpaaren kann eine Beziehung in zwei Kontinentteilnahmen vorkommen. Kontinentkombinationen sind exklusiv.'),
    ]
    for i, (label, text) in enumerate(intro, 4):
        start_sheet.cell(i, 2, label).font = Font(name='Arial', size=10, bold=True)
        start_sheet.cell(i, 3, text).alignment = Alignment(wrap_text=True, vertical='top')
        start_sheet.row_dimensions[i].height = 34
    for i, hyp in enumerate(all_specs, 13):
        c = start_sheet.cell(i, 2, hyp + ' ' + HYP_TITLES[hyp]); c.hyperlink = f"#'{hyp}_Bericht'!B2"; c.font = Font(name='Arial', size=11, color='225980', underline='single')
        c.alignment = Alignment(wrap_text=True, vertical='center'); start_sheet.row_dimensions[i].height = 32
        start_sheet.cell(i, 3, 'Grafiken und kurze Zahlen, anschließend Gruppen, Extremfälle und Insights als filterbare Tabellen.')

    metric_header = ['Gruppe', 'n', 'Länder', 'r', 'rho', 'p Standard', 'r getrimmt', 'r winsor']
    report_index = []

    def style_metric_row(ws, row, values, header=False):
        for j, val in enumerate(values, 2):
            c = ws.cell(row, j, typed_excel(val)); c.font = Font(name='Arial', size=9, bold=header, color='FFFFFF' if header else '17283A')
            if header: c.fill = PatternFill('solid', fgColor='243952')
            c.alignment = Alignment(wrap_text=True, vertical='center')
            if not header and isinstance(val, float): c.number_format = '0.000E+00' if j == 7 else '0.0000'
        ws.row_dimensions[row].height = max(30, 14*math.ceil(len(str(values[0]))/35))

    for hyp in all_specs:
        ws = workbook.create_sheet(hyp + '_Bericht'); ws.sheet_view.showGridLines = False
        ws.sheet_properties.tabColor = '243952'
        ws.column_dimensions['A'].width = 3; ws.column_dimensions['B'].width = 38
        for col in range(3, 13): ws.column_dimensions[get_column_letter(col)].width = 13
        ws['B2'] = hyp + ' ' + HYP_TITLES[hyp]; ws['B2'].font = Font(name='Arial', size=15, bold=True)
        ws['B3'] = 'Grafik, Kennzahlen und individuelle Hinweise je Gruppe. Standard-p-Werte nur eingeschränkt interpretieren.'
        ws.merge_cells('B3:L3'); ws['B3'].alignment = Alignment(wrap_text=True); ws.row_dimensions[3].height = 30
        ws['B4'] = 'Zur Übersicht'; ws['B4'].hyperlink = "#'Start'!B2"
        row = 7; section_seen = None
        for item in [c for c in context_charts if c['hypothesis'] == hyp]:
            if item['section'] != section_seen:
                section_seen = item['section']; ws.cell(row, 2, section_seen).font = Font(name='Arial', size=13, bold=True); row += 2
            header_row = row
            ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=12)
            ws.cell(row, 2, item['title']).font = Font(name='Arial', size=11, bold=True)
            ws.cell(row, 2).alignment = Alignment(wrap_text=True); ws.row_dimensions[row].height = 30; row += 2
            img = ExcelImage(BytesIO(item['png']))
            scale = 1050/img.width; img.width *= scale; img.height *= scale
            ws.add_image(img, f'B{row}')
            image_rows = math.ceil(img.height/20) + 1
            for rr in range(row, row + image_rows): ws.row_dimensions[rr].height = 15
            row += image_rows + 1
            caption_header = ['Term', 'Winsor', 'Koeff.', '95% unten', '95% oben', 'p Cluster', 'n'] if 'model_frame' in item else metric_header
            style_metric_row(ws, row, caption_header, True); row += 1
            for gid in item['group_ids']:
                m = group_registry[gid]['metrics']
                style_metric_row(ws, row, [m['group'], m['n'], m['countries'], m['pearson_r'], m['spearman_rho'], m['p_standard'], m.get('trim_r'), m.get('winsor_r')]); row += 1
                report_index.append({'hypothesis': hyp, 'section': item['section'], 'chart_title': item['title'],
                    'group_id': gid, 'sheet': ws.title, 'chart_heading_row': header_row, 'metrics_row': row - 1})
            if 'model_frame' in item:
                for vals in item['model_frame'].itertuples(index=False, name=None):
                    style_metric_row(ws, row, vals); row += 1
                report_index.append({'hypothesis': hyp, 'section': item['section'], 'chart_title': item['title'],
                    'group_id': '', 'sheet': ws.title, 'chart_heading_row': header_row,
                    'metrics_row': row - len(item['model_frame'])})
            notes = list(item['notes'])
            if len(item['group_ids']) == 1: notes += group_registry[item['group_ids'][0]]['insights']
            elif item['group_ids']: notes += ['Individuelle obere/untere Fälle jeder enthaltenen Gruppe stehen im Blatt ' + hyp + '_Extreme; group_id verbindet Grafik und Tabellen.']
            for text in notes:
                ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=12)
                c = ws.cell(row, 2, text); c.font = Font(name='Arial', size=9); c.alignment = Alignment(wrap_text=True, vertical='top')
                ws.row_dimensions[row].height = max(18, 14*math.ceil(len(text)/140)); row += 1
            row += 3
        ws.freeze_panes = 'C5'; ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_setup.orientation = 'landscape'; ws.page_setup.paperSize = ws.PAPERSIZE_A3
        ws.page_setup.fitToWidth = 1; ws.page_setup.fitToHeight = 0
        ws.print_options.horizontalCentered = True
        write_frame(workbook, hyp + '_Gruppen', group_results.loc[group_results.hypothesis.eq(hyp)])
        write_frame(workbook, hyp + '_Extreme', group_extremes.loc[group_extremes.hypothesis.eq(hyp)])
        write_frame(workbook, hyp + '_Insights', group_insights.loc[group_insights.hypothesis.eq(hyp)])

    write_frame(workbook, 'Grafikindex', pd.DataFrame(report_index))
    write_frame(workbook, 'Kriegsprofile', T['frequency_profile'])
    wcy, wpy = T['war_country_year'], T['war_participation_years']
    write_frame(workbook, 'Kriegsjahre', wcy.loc[wcy.year.between(E.START_YEAR - 1, E.END_YEAR)])
    write_frame(workbook, 'Kriegsbeteiligung_Jahr', wpy.loc[wpy.year.between(E.START_YEAR - 1, E.END_YEAR)])
    write_frame(workbook, 'Kriegsepisoden', T['war_episodes'])
    write_frame(workbook, 'Datumsprobleme', T['war_date_issues'])
    write_frame(workbook, 'Kontinentzuordnung', T['continent_lookup'])
    write_frame(workbook, 'Zusatzmodelle', zusatz['context_models'])
    write_frame(workbook, 'Modelldetails', zusatz['context_model_details'])
    write_frame(workbook, 'Modellstatus', zusatz['context_model_status'])
    write_frame(workbook, 'Methodik_Erweiterung', pd.DataFrame(CONTEXT_METHODS, columns=['topic', 'definition']))
    parameters = pd.DataFrame([{'parameter': k, 'value': str(v)} for k, v in WAR_CONFIG.items()] + [
     {'parameter': 'frequency_mean_share', 'value': str(th['frequency_mean_share'])},
     {'parameter': 'frequency_q90_share', 'value': str(th['frequency_q90_share'])},
     {'parameter': 'frequency_mean_distinct_wars', 'value': str(th['frequency_mean_count'])},
     {'parameter': 'war_extension_code_sha256', 'value': WAR_CODE_SHA256},
     {'parameter': 'old_extension_code_sha256', 'value': ANALYSIS_CODE_SHA256},
     {'parameter': 'source_wars_url', 'value': 'https://correlatesofwar.org/data-sets/COW-war/'},
     {'parameter': 'war_codebook_url', 'value': 'https://correlatesofwar.org/wp-content/uploads/Inter-StateWars_Codebook.pdf'},
    ])
    write_frame(workbook, 'Parameter_Erweiterung', parameters)
    for name, df in zusatz['report_tables'].items(): write_frame(workbook, ('Alt_' + name)[:31], df)
    zusatz['report_index'] = pd.DataFrame(report_index)
    return workbook


CONTEXT_METHODS = [
 ('Kriegsabdeckung', 'COW Inter-State War v4.0 covers 1816-2007. The last positive episode year is not the end of source coverage. Years 2008+ are unknown, never peace.'),
 ('Definition', 'Any participation in a recorded interstate war during the calendar year. It may be fought abroad. Civil, extra-state and non-state wars are not covered.'),
 ('Episoden', 'Both separate participation episodes are expanded independently to years; gaps are not bridged. Multiple wars in one year count as one war-year but several distinct wars.'),
 ('Datumscodes', '-8: no second episode; -7: ongoing to end of source coverage; unknown year bounds produce unknown possible country-years, not zero.'),
 ('Länderpaare', 'No/one/both countries participating in ANY recorded interstate war. Both participating does not imply enemies, allies, same war, or direct fighting against each other.'),
 ('Kriegsfreie Gruppe', 'No recorded interstate war participation within source coverage; not general peace. Angola civil-war uncertainty is not removed by this filter.'),
 ('Historische Identität', 'War flags join on COW country code and exact year. Frequency profiles use eligible ISO identities, preserving predecessor/successor exclusions from preparation.'),
 ('Vergleichszeitraum', 'Current-war comparisons use only known status to 2007. Frequency-exclusion variants additionally require at least 10 observed years for every country, and compare with a separate same-period frequency-eligible reference.'),
 ('Häufigkeitsanteil', 'Unique years with participation / eligible observed member-years, 1950-2007. Reference mean gives each country equal weight and includes zero-war countries with at least 10 observed years.'),
 ('Häufigkeitsfilter', 'Primary: above mean war-year share. Additional: strictly above 90th percentile share; above mean distinct-war count. Short histories have unknown eligibility and are excluded from filtered variants.'),
 ('Rückblick', 'Frequency profiles use the full observation period retrospectively; these are descriptive selection comparisons, not forecasts or causal effects.'),
 ('H3 Intervall', 'Additional status for t-1 or t because the spending growth rate uses both years. Current-year classification is retained separately.'),
 ('H8 Fenster', 'Additional future-window status requires all t+1 to t+5 years known; otherwise unknown. Overlapping growth windows still create dependence.'),
 ('Kontinente', 'CEPII static continent assignment; America split into North America including Central America/Caribbean and explicit South America ISO list; Pacific renamed Oceania. Antarctica has no eligible sovereign-country observations.'),
 ('Transkontinental', 'Each country gets one CEPII-based continent. Different classifications are a possible sensitivity, not silently duplicated assignments.'),
 ('Paarkontinente', 'Unordered continent pairs partition known data. Participation in a continent includes either role and overlaps for cross-continent pairs. Do not sum these rows as independent samples.'),
 ('Extremfälle', 'Top/bottom three ranks for X, Y and simple-OLS residuals per group. Ties are explicitly counted; returned rows are a deterministic selection. Extreme rank is not proof of error.'),
 ('Ausreißersensitivität', 'Within each group: 1st/99th percentile trim and winsor, with dropped counts; 1.5 IQR and MAD z>3.5 flags on selected cases. True zeros retained.'),
 ('Einfluss', 'Exact Pearson r after deleting a row; country deletion removes every row involving that country. These are diagnostics, not permission to delete observations.'),
 ('Kleine Gruppen', 'Correlations require at least three pairs and variable variation. Groups below 30 are marked; no automatic acceptance/rejection. The course 5000-pair rule applies to main hypotheses, not each additional split.'),
 ('p Werte', 'Conventional two-sided Pearson p-values ignore panel/dyad dependence. Many post-hoc subgroup comparisons are exploratory. Zero p-values can be numerical underflow.'),
 ('Modelle', 'Absorbed entity/year effects; interactions with any/both participation. H1 uses log productivity. H2 additionally controls log population/productivity. Cluster covariance: entity+year minus intersection.'),
 ('Modellgrenzen', 'No causal interpretation. Pair/year clustering misses some dependence between pairs sharing a country. Skipped models and reasons are retained. Raw slope differences may reflect composition.'),
 ('Bericht', 'One timestamped static XLSX. Re-run notebook to refresh. Charts are stored within hypothesis report sheets with numeric tables directly below. Full case and insight tables link via group_id.'),
]
