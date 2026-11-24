import type { DashboardPayload, RoomSummary } from '@/types';

const CSV_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Échappe une cellule CSV tout en neutralisant les injections de formules Excel/Sheets.
 */
export function escapeCsvCell(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : '';
  }

  let str = String(val);
  if (str.length > 0 && CSV_FORMULA_PREFIXES.some((prefix) => str.startsWith(prefix))) {
    str = `'${str}`;
  }

  if (/[",\n\r;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvLine(cells: Array<string | number | null | undefined>): string {
  return cells.map(escapeCsvCell).join(',');
}

/**
 * Génère un CSV UTF-8 (avec BOM) de la série temporelle énergétique.
 */
export function buildEnergyTimeSeriesCsv(data: DashboardPayload): string {
  const rooms = data.energyByRoom;
  const header = [
    'Bucket',
    'Label',
    'Total_kWh',
    'Total_W',
    'Total_EUR',
    ...rooms.map((r) => `${r.name} (kWh)`),
  ];

  const rows = data.timeSeries.map((pt) => [
    pt.bucket,
    pt.label,
    pt.totalEnergyKwh,
    pt.totalPowerW,
    pt.totalCostEur,
    ...rooms.map((r) => pt.byRoomEnergy[r.id] ?? 0),
  ]);

  return `\uFEFF${[toCsvLine(header), ...rows.map(toCsvLine)].join('\r\n')}`;
}

/**
 * Génère un CSV UTF-8 (avec BOM) des statistiques climatiques par pièce.
 */
export function buildClimateStatsCsv(roomSummaries: RoomSummary[]): string {
  const header = [
    'Room',
    'Current_Temp_C',
    'Min_Temp_C',
    'Max_Temp_C',
    'Avg_Temp_C',
    'Avg_Humidity_Pct',
    'Dew_Point_C',
    'Comfort',
  ];

  const rows = roomSummaries.map((rs) => [
    rs.room.name,
    rs.currentTempC,
    rs.minTempC,
    rs.maxTempC,
    rs.avgTempC,
    rs.avgHumidityPct,
    rs.dewPointC,
    rs.comfort.label,
  ]);

  return `\uFEFF${[toCsvLine(header), ...rows.map(toCsvLine)].join('\r\n')}`;
}

/**
 * Déclenche le téléchargement d'un fichier CSV côté navigateur.
 */
export function triggerCsvDownload(filename: string, csv: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
