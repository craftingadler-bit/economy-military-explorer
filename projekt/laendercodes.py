"""Feste Zuordnungslisten für Länder und Kontinente (nur Nachschlagetabellen, keine Logik)."""

# COW-Ländernummer -> ISO-3-Code. COW-Nummern sind keine ISO-Nummern.
COW_TO_ISO = {
 2:'USA',20:'CAN',31:'BHS',40:'CUB',41:'HTI',42:'DOM',51:'JAM',52:'TTO',53:'BRB',54:'DMA',55:'GRD',
 56:'LCA',57:'VCT',58:'ATG',60:'KNA',70:'MEX',80:'BLZ',90:'GTM',91:'HND',92:'SLV',93:'NIC',94:'CRI',95:'PAN',
 100:'COL',101:'VEN',110:'GUY',115:'SUR',130:'ECU',135:'PER',140:'BRA',145:'BOL',150:'PRY',155:'CHL',160:'ARG',165:'URY',
 200:'GBR',205:'IRL',210:'NLD',211:'BEL',212:'LUX',220:'FRA',221:'MCO',223:'LIE',225:'CHE',230:'ESP',232:'AND',235:'PRT',
 255:'DEU',260:'FRG',265:'DDR',290:'POL',300:'AUT_HUN',305:'AUT',310:'HUN',315:'CSK',316:'CZE',317:'SVK',325:'ITA',
 331:'SMR',338:'MLT',339:'ALB',341:'MNE',343:'MKD',344:'HRV',345:'SRB',346:'BIH',347:'XKX',349:'SVN',350:'GRC',
 352:'CYP',355:'BGR',359:'MDA',360:'ROU',365:'RUS',366:'EST',367:'LVA',368:'LTU',369:'UKR',370:'BLR',371:'ARM',
 372:'GEO',373:'AZE',375:'FIN',380:'SWE',385:'NOR',390:'DNK',395:'ISL',402:'CPV',403:'STP',404:'GNB',411:'GNQ',
 420:'GMB',432:'MLI',433:'SEN',434:'BEN',435:'MRT',436:'NER',437:'CIV',438:'GIN',439:'BFA',450:'LBR',451:'SLE',452:'GHA',
 461:'TGO',471:'CMR',475:'NGA',481:'GAB',482:'CAF',483:'TCD',484:'COG',490:'COD',500:'UGA',501:'KEN',510:'TZA',
 511:'ZAN',516:'BDI',517:'RWA',520:'SOM',522:'DJI',530:'ETH',531:'ERI',540:'AGO',541:'MOZ',551:'ZMB',552:'ZWE',
 553:'MWI',560:'ZAF',565:'NAM',570:'LSO',571:'BWA',572:'SWZ',580:'MDG',581:'COM',590:'MUS',591:'SYC',600:'MAR',
 615:'DZA',616:'TUN',620:'LBY',625:'SDN',626:'SSD',630:'IRN',640:'TUR',645:'IRQ',651:'EGY',652:'SYR',660:'LBN',
 663:'JOR',666:'ISR',670:'SAU',678:'YAR',679:'YEM',680:'YPR',690:'KWT',692:'BHR',694:'QAT',696:'ARE',698:'OMN',
 700:'AFG',701:'TKM',702:'TJK',703:'KGZ',704:'UZB',705:'KAZ',710:'CHN',712:'MNG',713:'TWN',730:'KOREA_HIST',
 731:'PRK',732:'KOR',740:'JPN',750:'IND',760:'BTN',770:'PAK',771:'BGD',775:'MMR',780:'LKA',781:'MDV',790:'NPL',
 800:'THA',811:'KHM',812:'LAO',816:'VNM',817:'VNS',820:'MYS',830:'SGP',835:'BRN',840:'PHL',850:'IDN',860:'TLS',
 900:'AUS',910:'PNG',920:'NZL',935:'VUT',940:'SLB',946:'KIR',947:'TUV',950:'FJI',955:'TON',970:'NRU',983:'MHL',
 986:'PLW',987:'FSM',990:'WSM'
}

# Historische Einheiten bekommen eigene Kennungen und werden nicht mit Nachfolgestaaten verbunden.
HISTORICAL_IDS = {'SUN','DDR','FRG','CSK','YUG','SCG','YAR','YPR','VNS','VDR','ZAN','AUT_HUN','KOREA_HIST'}

# Ab diesem Jahr gilt der heutige Gebietsstand; davor werden Länderjahre zur Prüfung markiert.
MODERN_MIN_YEAR = {
    'RUS':1992, 'DEU':1991, 'SRB':2007, 'VNM':1977, 'YEM':1991,
    'CZE':1993, 'SVK':1993, 'PAK':1972, 'ETH':1994, 'SDN':2012, 'MYS':1966,
    'EST':1992, 'LVA':1992, 'LTU':1992, 'UKR':1992, 'BLR':1992, 'ARM':1992,
    'GEO':1992, 'AZE':1992, 'KAZ':1992, 'KGZ':1992, 'TJK':1992, 'TKM':1992,
    'UZB':1992, 'SVN':1993, 'HRV':1993, 'BIH':1993, 'MNE':2007, 'SSD':2012
}

# Echte Umbenennungen desselben Landes in CEPII (keine Nachfolgestaaten).
CEPII_CODE_RENAMES = {'ROM':'ROU','TMP':'TLS','ZAR':'COD'}

# SIPRI-Ländernamen, die sich nicht automatisch zuordnen lassen.
NAME_ALIASES = {
 'Congo, DR':'COD', 'Congo, Republic':'COG', "Cote d'Ivoire":'CIV', 'Gambia, The':'GMB',
 'Korea, North':'PRK', 'Korea, South':'KOR', 'Timor Leste':'TLS', 'Kyrgyz Republic':'KGZ',
 'Viet Nam':'VNM', 'Czechia':'CZE', 'North Macedonia':'MKD', 'Eswatini':'SWZ', 'Türkiye':'TUR',
 'USSR':'SUN', 'Yugoslavia':'YUG', 'Czechoslovakia':'CSK', 'German Democratic Republic':'DDR',
 'Yemen, North':'YAR', 'Germany':'DEU', 'Serbia':'SRB', 'Russia':'RUS', 'Belgium':'BEL',
 'United States of America':'USA', 'Cape Verde':'CPV', 'Taiwan':'TWN', 'Laos':'LAO', 'Kosovo':'XKX',
 'Romania':'ROU'
}

# Kontinente: CEPII-Einteilung, Amerika aufgeteilt in Nord- (inkl. Mittelamerika/Karibik) und Südamerika.
CONTINENT_MAP = {'Africa':'Afrika','Asia':'Asien','Europe':'Europa','Pacific':'Ozeanien'}
SOUTH_AMERICA_ISO = {'ARG','BOL','BRA','CHL','COL','ECU','GUY','PRY','PER','SUR','URY','VEN','GUF','FLK'}
