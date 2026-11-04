# Economy, Trade & Armed Forces 1950–2014

Integrationsseminar, DHBW Mannheim (Prof. Simone Krug), Fall 2026.

Four hypotheses on productivity, trade and armed forces, tested on country-years and country pairs from 1950 to 2014, plus six exploratory side questions.

**Live explorer:** see the GitHub Pages link in the repository's About section. Every number is recomputed in the browser; groups, war status and single countries can be filtered out or looked at alone. The page *Why?* collects explanations for H1–H4 with checked sources.

## Contents

| Path | What it is |
|---|---|
| `Historical_Data_Preparation.ipynb` | Import and cleaning of the ten raw files |
| `Historical_Extended_Analysis.ipynb` | Correlations, outliers, between/within, fixed effects |
| `Historical_War_Continent_Analysis.ipynb` | War status, continents and extreme cases (basis of the website) |
| `Ergebnisse/` | Excel reports exported by the notebooks |
| `Website/` | The interactive explorer (static HTML/JS, works offline from `index.html`) |
| `Website/build_data.py` | Exports the notebook samples to `Website/data/` |

## Data sources

The raw data are not part of this repository. To rerun the notebooks, place these files in `Data/`:

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

Open `Website/index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8765 --directory Website
```
