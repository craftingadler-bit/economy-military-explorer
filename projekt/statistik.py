"""Statistik-Werkzeuge.

Oben stehen die kurzen Funktionen, die das Analyse-Notebook benutzt. Sie arbeiten
auf einer fertigen Stichprobe mit den Spalten `x` und `y` (siehe Schritt 1).
Darunter stehen die Rechenkerne, unverändert aus der bisherigen Analyse übernommen.
"""
import warnings

import numpy as np
import pandas as pd
from scipy import stats

from .einstellungen import CONFIG
from .laendercodes import COW_TO_ISO


# ====================================================================================
# Funktionen für das Analyse-Notebook
# ====================================================================================

def staerke(r):
    """Einordnung nach den Kursgrenzen: |r| > 0,5 stark, > 0,3 moderat, > 0,1 schwach."""
    if not np.isfinite(r):
        return 'nicht berechenbar'
    a = abs(r)
    return 'stark' if a > 0.5 else 'moderat' if a > 0.3 else 'schwach' if a > 0.1 else 'nicht interpretierbar'


def korrelation(d):
    """n, Pearson r, p-Wert und Spearman rho für die Spalten x und y einer Stichprobe."""
    m = corr_metrics(d, 'x', 'y')
    return {'n': m['n'], 'r': m['pearson_r'], 'p': m['p_standard'], 'rho': m['spearman_rho'],
            'Stärke': staerke(m['pearson_r'])}


def _einheit(d):
    """Länderjahre werden über das Land (ccode), Länderpaare über das Paar (pair_id) gruppiert."""
    return 'ccode' if 'ccode' in d else 'pair_id'


def zwischen(d):
    """Zwischen den Einheiten: ein Punkt je Land bzw. Paar (sein Durchschnitt über alle Jahre)."""
    mittelwerte = d.groupby(_einheit(d))[['x', 'y']].mean().reset_index()
    return korrelation(mittelwerte) | {'p': np.nan}


def innerhalb(d):
    """Innerhalb der Einheiten: Abweichung jedes Jahres vom eigenen Durchschnitt."""
    abweichungen = d[['x', 'y']] - d.groupby(_einheit(d))[['x', 'y']].transform('mean')
    return korrelation(abweichungen) | {'p': np.nan}


def ausreisser_grenzen(d):
    """1. und 99. Perzentil von x und y in der vollständigen Stichprobe."""
    return {col: tuple(d[col].quantile([CONFIG['trim_lower'], CONFIG['trim_upper']])) for col in ['x', 'y']}


def trimmen(d):
    """Zeilen außerhalb des 1.–99. Perzentils von x oder y entfernen."""
    g = ausreisser_grenzen(d)
    return d.loc[d.x.between(*g['x']) & d.y.between(*g['y'])]


def winsorisieren(d):
    """Werte außerhalb des 1.–99. Perzentils auf die Grenze setzen (keine Zeile fällt weg)."""
    g = ausreisser_grenzen(d)
    return d.assign(x=d.x.clip(*g['x']), y=d.y.clip(*g['y']))


def ohne_jedes_land(d):
    """r, wenn jeweils ein Land (bei Paaren: alle Paare mit diesem Land) weggelassen wird."""
    t = leave_groups(d, 'x', 'y', 'country')
    return t.rename(columns={'country_iso3_default': 'Land', 'removed_n': 'Zeilen weg',
                             'r_without_group': 'r ohne Land', 'delta_r': 'Änderung'})[
        ['Land', 'Zeilen weg', 'r ohne Land', 'Änderung']].reset_index(drop=True)


def nach_gruppen(d, spalte):
    """Korrelation getrennt für jede Gruppe einer Spalte (z. B. Kontinent oder Kriegsstatus)."""
    zeilen = [{spalte: gruppe, **korrelation(teil)} for gruppe, teil in d.groupby(spalte, sort=True)]
    return pd.DataFrame(zeilen)


def fixed_effects(d, x_log=True):
    """Regression von y auf x mit Länder- und Jahreseffekten, Standardfehler nach Land und Jahr geclustert."""
    a = d.copy()
    a['x_model'] = np.log(a.x) if x_log else a.x
    rows, detail = fit_absorbed('FE', a, 'y', ['x_model'], _einheit(a), True)
    r = rows[0]
    return {'beta': r['coefficient'], '95% unten': r['ci_low'], '95% oben': r['ci_high'],
            'p (geclustert)': r['p_cluster_exploratory'], 'n': r['n'],
            'Länder': r['clusters_entity'], 'Jahre': r['clusters_year']}


def waehle_stichprobe(d, kontinent=None, krieg=None, ausschluss=None, landerliste=None):
    """Teilstichprobe nach Kontinent, Kriegsstatus, Kriegshäufigkeit oder ausgeschlossenen Ländern.

    kontinent:   z. B. 'Europa' (bei Paaren zählt das Paar, wenn ein Land dort liegt)
    krieg:       'beteiligt', 'nicht_beteiligt' oder bei Paaren 'beide_beteiligt'
    ausschluss:  'above_mean_share', 'above_p90_share' oder 'above_mean_count'
    landerliste: ISO-Codes, die entfernt werden
    """
    d = d.copy()
    if kontinent is not None:
        if 'ccode' in d: keep = d.continent.eq(kontinent)
        else: keep = d.continent_1.eq(kontinent) | d.continent_2.eq(kontinent)
        d = d.loc[keep].copy()
    if krieg is not None:
        d = d.loc[d.war_known.fillna(False)].copy()
        if krieg == 'beteiligt': d = d.loc[d.war_any.eq(1)]
        elif krieg == 'nicht_beteiligt': d = d.loc[d.war_any.eq(0)]
        elif krieg == 'beide_beteiligt' and 'war_both' in d: d = d.loc[d.war_both.eq(1)]
        else: raise ValueError('krieg: beteiligt, nicht_beteiligt oder beide_beteiligt bei Paaren')
    if ausschluss is not None:
        if ausschluss not in ['above_mean_share', 'above_p90_share', 'above_mean_count']:
            raise ValueError('Unbekannte Ausschlussregel')
        d = d.loc[d.war_known.fillna(False)].copy()
        if 'ccode' in d:
            keep = d.frequency_eligible.astype('boolean').fillna(False) & ~d[ausschluss].astype('boolean').fillna(True)
        else:
            keep = (d.frequency_eligible_1.astype('boolean').fillna(False) & d.frequency_eligible_2.astype('boolean').fillna(False) &
                    ~d[ausschluss + '_1'].astype('boolean').fillna(True) & ~d[ausschluss + '_2'].astype('boolean').fillna(True))
        d = d.loc[keep].copy()
    exclude = set(landerliste or [])
    if exclude:
        mask = ~d.iso3.isin(exclude) if 'ccode' in d else ~d.iso31.isin(exclude) & ~d.iso32.isin(exclude)
        d = d.loc[mask].copy()
    return d


# ====================================================================================
# Rechenkerne (unverändert übernommen)
# ====================================================================================

def complete(df, columns):
    """Nur Zeilen, in denen alle genannten Spalten endliche Zahlen enthalten."""
    result = df.copy()
    for col in columns:
        result[col] = pd.to_numeric(result[col], errors='coerce')
    return result.loc[np.isfinite(result[columns].to_numpy(dtype=float)).all(axis=1)].copy()


def corr_metrics(df, x, y, standard_p=True):
    """Pearson r mit zweiseitigem p-Wert und Spearman rho (SciPy)."""
    d = complete(df, [x, y])
    result = {'n': len(d), 'pearson_r': np.nan, 'p_standard': np.nan,
              'spearman_rho': np.nan, 'status': 'too_few_or_constant'}
    if len(d) >= 3 and d[x].nunique() > 1 and d[y].nunique() > 1:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            r, p = stats.pearsonr(d[x], d[y])
            rho, _ = stats.spearmanr(d[x], d[y])
        result.update(pearson_r=float(r), spearman_rho=float(rho),
                      p_standard=float(p) if standard_p else np.nan, status='computed')
    return result


def r_from_moments(a):
    """Pearson r aus Summen [n, Σx, Σy, Σx², Σy², Σxy]; erlaubt schnelles Weglassen von Zeilen oder Gruppen."""
    a = np.asarray(a, dtype=float)
    n, sx, sy, sxx, syy, sxy = np.moveaxis(a, -1, 0)
    with np.errstate(divide='ignore', invalid='ignore'):
        vx, vy = sxx - sx*sx/n, syy - sy*sy/n
        r = (sxy - sx*sy/n) / np.sqrt(vx*vy)
    return np.where((n >= 3) & (vx > 1e-14) & (vy > 1e-14), np.clip(r, -1, 1), np.nan)


def moment_matrix(d, x, y):
    xx = d[x].to_numpy(float); yy = d[y].to_numpy(float)
    xx = xx - xx.mean(); yy = yy - yy.mean()
    return np.column_stack([np.ones(len(d)), xx, yy, xx*xx, yy*yy, xx*yy])


def leave_groups(d, x, y, mode):
    """r ohne je ein Land ('country') oder ein Jahr ('year'); bei Paaren fallen beide Rollen weg."""
    mm = moment_matrix(d, x, y); total = mm.sum(axis=0)
    if mode == 'country' and 'ccode' not in d:
        labels = np.concatenate([d.ccode1.to_numpy(), d.ccode2.to_numpy()])
        moments = np.concatenate([mm, mm])
    else:
        labels = d['ccode' if mode == 'country' else 'year'].to_numpy(); moments = mm
    unique, codes = np.unique(labels, return_inverse=True)
    sums = np.column_stack([np.bincount(codes, weights=moments[:, i], minlength=len(unique)) for i in range(6)])
    rem = total - sums
    out = pd.DataFrame({'excluded_group': unique, 'removed_n': sums[:, 0].astype(int),
                        'n_remaining': rem[:, 0].astype(int), 'r_without_group': r_from_moments(rem)})
    out['delta_r'] = out.r_without_group - float(r_from_moments(total))
    out['abs_delta_r'] = out.delta_r.abs()
    if mode == 'country':
        out['country_iso3_default'] = out.excluded_group.map(COW_TO_ISO)
    return out.sort_values('abs_delta_r', ascending=False)


def residualize(matrix, grouping_arrays, tolerance=1e-10, max_iter=1000):
    """Gruppeneffekte durch wiederholtes Zentrieren entfernen (absorbierte Fixed Effects)."""
    z = np.asarray(matrix, float).copy()
    scale = np.std(z, axis=0); scale[scale == 0] = 1
    z /= scale
    codes = [pd.factorize(v)[0] for v in grouping_arrays]
    for iteration in range(max_iter):
        old = z.copy()
        for c in codes:
            count = np.bincount(c)
            for j in range(z.shape[1]):
                means = np.bincount(c, weights=z[:, j])/count
                z[:, j] -= means[c]
        if np.max(np.abs(z - old)) < tolerance:
            return z*scale, iteration + 1
    raise RuntimeError('Fixed-effect demeaning did not converge; no model silently exported.')


def fit_absorbed(name, d, y, xcols, entity_col, entity_fe=False, limitation=''):
    """OLS mit absorbierten Länder-/Paar- und Jahreseffekten, zweifach geclusterte Standardfehler."""
    a = complete(d, [y] + xcols).dropna(subset=[entity_col, 'year']).reset_index(drop=True)
    entities = a[entity_col].nunique(); years = a.year.nunique()
    groups = [a[entity_col].to_numpy(), a.year.to_numpy()] if entity_fe else [a.year.to_numpy()]
    z, iterations = residualize(a[[y] + xcols].to_numpy(), groups)
    yy = z[:, 0]; xx = z[:, 1:]; n, p = xx.shape
    if n <= p + entities + years or entities < 3 or years < 3:
        raise ValueError(name + ': insufficient rows or clusters')
    if np.linalg.matrix_rank(xx) < p:
        raise ValueError(name + ': collinear regressors after fixed effects')
    beta = np.linalg.lstsq(xx, yy, rcond=None)[0]; residual = yy - xx @ beta
    bread = np.linalg.inv(xx.T @ xx); scores = xx*residual[:, None]
    # Rang der absorbierten Effekte: G_entity + G_year - Anzahl zusammenhängender Komponenten.
    if entity_fe:
        ec = pd.factorize(a[entity_col])[0]; yc = pd.factorize(a.year)[0]
        parent = np.arange(entities + years)
        def root(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]; i = parent[i]
            return i
        for e, t in zip(ec, yc):
            re, rt = root(int(e)), root(entities + int(t))
            if re != rt: parent[rt] = re
        components = len({root(i) for i in range(len(parent))})
        fe_rank = entities + years - components
    else:
        fe_rank = years; components = 1
    k = p + fe_rank
    def cluster_cov(labels):
        code, level = pd.factorize(labels)
        g = len(level)
        sums = np.column_stack([np.bincount(code, weights=scores[:, j], minlength=g) for j in range(p)])
        return (bread @ (sums.T @ sums) @ bread)*(g/(g - 1))*((n - 1)/(n - k))
    joint = pd.MultiIndex.from_frame(a[[entity_col, 'year']])
    covariance = cluster_cov(a[entity_col]) + cluster_cov(a.year) - cluster_cov(joint)
    variances = np.diag(covariance)
    se = np.where(variances >= 0, np.sqrt(np.maximum(variances, 0)), np.nan)
    tvalues = np.divide(beta, se, out=np.full(p, np.nan), where=se > 0)
    dof = min(entities, years) - 1
    pvalues = 2*stats.t.sf(np.abs(tvalues), dof)
    critical = stats.t.ppf(.975, dof)
    rows = []
    for i, col in enumerate(xcols):
        rows.append({'model': name, 'term': col, 'coefficient': beta[i], 'se_cluster_2way': se[i],
                     'ci_low': beta[i] - critical*se[i], 'ci_high': beta[i] + critical*se[i],
                     'p_cluster_exploratory': pvalues[i], 'n': n, 'clusters_entity': entities, 'clusters_year': years,
                     'entity_fixed_effects': entity_fe, 'year_fixed_effects': True, 'limitation': limitation})
    detail = {'model': name, 'outcome': y, 'n_input': len(d), 'n_used': n, 'removed_incomplete': len(d) - n,
              'within_r_squared': 1 - np.dot(residual, residual)/np.dot(yy, yy),
              'absorbed_effect_rank': fe_rank, 'connected_components': components, 'demeaning_iterations': iterations,
              't_reference_df': dof, 'negative_covariance_diagonal_count': int((variances < 0).sum()),
              'se_method': 'entity + year cluster sandwich, inclusion-exclusion, finite-sample correction',
              'interpretation': 'Associations conditional on included covariates/effects; no causality'}
    return rows, detail
