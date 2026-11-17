# Economy, Trade & Armed Forces 1950–2014

Integrationsseminar, DHBW Mannheim (Prof. Simone Krug), Fall 2026.

Four hypotheses on productivity, trade and armed forces, tested on country-years and country pairs from 1950 to 2014, plus six exploratory side questions.

**Live explorer:** see the GitHub Pages link in the repository's About section. Every number is recomputed in the browser; groups, war status and single countries can be filtered out or looked at alone. The page *Why?* collects explanations for H1–H4 with checked sources.

## Structure

The analysis runs in four steps. Only step 2 is a notebook; the other steps are small Python modules it calls.

```
Data/  (10 raw files, not in the repository)
  │
  │  Step 1  projekt/aufbereitung.py   clean, merge, build one finished sample per hypothesis
  ▼
samples with the same columns: x, y, country, year, continent, war status
  │
  ├─ Step 2  Analyse.ipynb             the analysis: results, outliers, levels, groups, single countries
  ├─ Step 3  projekt/grafiken.py       all charts
  ├─ Step 4  projekt/bericht.py        full Excel report with every exploratory table (Ergebnisse/)
  └─         Website/build_data.py     samples for the interactive website (Website/data/)
```

| Path | What it is |
|---|---|
| `Analyse.ipynb` | **Start here.** The analysis notebook, focus on H1 |
| `projekt/einstellungen.py` | Paths, period, thresholds and the list of hypotheses |
| `projekt/aufbereitung.py` | Step 1: data preparation in twelve named steps |
| `projekt/statistik.py` | Statistical tools (correlation, between/within, influence, fixed effects) |
| `projekt/grafiken.py` | Step 3: all charts |
| `projekt/zusatzanalysen.py` | Exploratory tables for the report (sensitivities, groups, extra models) |
| `projekt/bericht.py` | Step 4: Excel report |
| `projekt/laendercodes.py` | Lookup lists (COW → ISO codes, continents) |
| `Ergebnisse/` | Excel reports |
| `Website/` | The interactive explorer (static HTML/JS, works offline from `index.html`) |
| `Archiv/` | The three original notebooks, kept for reference (they expect to sit next to `Data/`) |

The restructuring did not change any result: every table, all 166 report charts and all cells of the Excel report are identical to the original notebooks.

## Data sources

The raw data are not part of this repository. To rerun the analysis, place these files in `Data/`:

- COW National Material Capabilities 7.0 (`NMC-70-abridged.csv`)
- COW Trade 4.0, national and dyadic (`National_COW_4.0.csv`, `Dyadic_COW_4.0.csv`)
- COW Inter-State War Data 4.0 (`Inter-StateWarData_v4.0.csv`)
- COW State System Membership 2024 (`statelist2024.csv`)
- Penn World Table 11.0 (`pwt110.xlsx`)
- SIPRI Military Expenditure Database 1949–2025 (`SIPRI-Milex-data-1949-2025_v1.2.xlsx`)
- Maddison Project Database 2023 (`mpd2023_web.xlsx`)
- CEPII GeoDist (`geo_cepii.xls`, `dist_cepii.xls`)

The website's `data/` folder contains only the prepared analysis samples derived from these sources.

## Run locally

Analysis: open `Analyse.ipynb` in Jupyter or VS Code (packages: pandas, numpy, scipy, matplotlib, openpyxl, xlrd) and run all cells.

Website: open `Website/index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8765 --directory Website
```

Rebuild the website data after changing the preparation:

```bash
.venv/bin/python Website/build_data.py
```
