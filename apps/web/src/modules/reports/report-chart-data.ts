export const reportChartTypes = [
  { value: "table", label: "Table" },
  { value: "column", label: "Column chart" },
  { value: "line", label: "Line chart" },
] as const;

export type ReportChartType = typeof reportChartTypes[number]["value"];
type ChartCell = string | number | boolean | null | undefined;
export type ChartReport = { columns: Array<{ key: string; label: string }>; rows: Array<Record<string, ChartCell>>; totalRows: number };

export function prepareReportChart({ columns, rows }: ChartReport) {
  const categoryField = columns[0];
  const visibleRows = rows.slice(0, 20);
  const categories = categoryField ? visibleRows.map((row) => String(row[categoryField.key] ?? "") || "(Blank)") : [];
  let min = 0;
  let max = 0;
  let hasValues = false;
  let omittedValues = false;
  const series = columns.slice(1, 9).map((column) => ({
    ...column,
    values: visibleRows.map((row) => {
      const raw = row[column.key];
      if (raw === null || raw === undefined) return null;
      const value = typeof raw === "number" || (typeof raw === "string" && /^-?\d+(?:\.\d+)?$/.test(raw)) ? Number(raw) : NaN;
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
        omittedValues = true;
        return null;
      }
      min = Math.min(min, value);
      max = Math.max(max, value);
      hasValues = true;
      return value;
    }),
  }));
  return { categories, series, min, max: min === max ? 1 : max, hasValues, omittedValues };
}
