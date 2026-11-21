import { useId, useState } from "react";
import { prepareReportChart, reportChartTypes, type ChartReport, type ReportChartType } from "./report-chart-data";

const seriesColors = ["#2563eb", "#b45309", "#047857", "#be185d", "#7c3aed", "#0e7490", "#b91c1c", "#475569"];
const linePatterns = [undefined, "7 3", "3 3", "10 3 2 3", "2 3", "6 2 1 2", "9 4", "4 3 1 3"];

export function ChartTypeOptions() {
  return reportChartTypes.map(({ value, label }) => <option key={value} value={value}>{label}</option>);
}

export function DesignerChart({ report, defaultType }: { report: ChartReport; defaultType: ReportChartType }) {
  const [chartType, setChartType] = useState(defaultType);
  const chartId = useId();

  return <div className="reports-chart-view">
    <label>Result view<select value={chartType} onChange={(event) => setChartType(event.target.value as ReportChartType)}><ChartTypeOptions /></select></label>
    {chartType !== "table" && <ChartPlot report={report} chartType={chartType} chartId={chartId} />}
  </div>;
}

function ChartPlot({ report, chartType, chartId }: { report: ChartReport; chartType: Exclude<ReportChartType, "table">; chartId: string }) {
  const { categories, series, totalSeries, min, max, hasValues, omittedValues } = prepareReportChart(report);
  const limits = [
    report.totalRows > categories.length ? `First ${categories.length} of ${report.totalRows} rows.` : "",
    totalSeries > series.length ? `First ${series.length} of ${totalSeries} series.` : "",
    omittedValues ? "Values outside the supported chart range are omitted." : "",
  ].filter(Boolean).join(" ");
  if (!hasValues) return <p className="reports-description" role="status">No values can be plotted. {limits && `${limits} `}Exact results are in the table.</p>;

  const left = 72;
  const top = 14;
  const bottom = 208;
  const width = 656;
  const step = width / categories.length;
  const x = (index: number) => left + step * (index + 0.5);
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const zero = y(0);
  const tickFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumSignificantDigits: 4 });
  const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4);
  const groupWidth = Math.min(52, step * 0.78);
  const barWidth = groupWidth / series.length;
  return <figure className="reports-chart" aria-labelledby={chartId}>
    <figcaption id={chartId}>{chartType === "column" ? "Column chart." : "Line chart."} {limits && `${limits} `}Exact results are in the table.</figcaption>
    <ul className="reports-chart-legend">{series.map((item, index) => <li key={item.key}>
      <svg viewBox="0 0 20 12" aria-hidden="true" focusable="false">
        {chartType === "line" ? <line x1={0} x2={20} y1={6} y2={6} stroke={seriesColors[index]} strokeWidth={3} strokeDasharray={linePatterns[index]} />
          : <rect x={3} y={1} width={14} height={10} fill={seriesColors[index]} />}
      </svg>{item.label}
    </li>)}</ul>
    <div className="reports-chart-scroll" tabIndex={0} role="region" aria-label="Chart plot">
      <svg viewBox="0 0 740 306" aria-hidden="true" focusable="false">
        {ticks.map((tick, index) => <g key={index}>
          <line className="reports-chart-grid" x1={left} x2={left + width} y1={y(tick)} y2={y(tick)} />
          <text x={left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">{tickFormat.format(tick)}</text>
        </g>)}
        <line className="reports-chart-axis" x1={left} x2={left + width} y1={zero} y2={zero} />
        {categories.map((name, index) => <text key={index} transform={`translate(${x(index)},${bottom + 9}) rotate(-48)`} textAnchor="end">
          <title>{name}</title>{name.length > 18 ? `${name.slice(0, 17)}…` : name}
        </text>)}
        {series.map((item, index) => {
          const color = seriesColors[index];
          if (chartType === "column") return <g key={item.key}>{item.values.map((value, row) => value === null ? null : <rect key={row}
            x={x(row) - groupWidth / 2 + index * barWidth} y={Math.min(zero, y(value))} width={Math.max(1, barWidth - 1)} height={Math.abs(zero - y(value))} fill={color}>
            <title>{`${categories[row]} · ${item.label}: ${value}`}</title>
          </rect>)}</g>;
          const path = item.values.map((value, row) => value === null ? "" : `${row === 0 || item.values[row - 1] === null ? "M" : "L"} ${x(row)} ${y(value)}`).join(" ");
          return <g key={item.key}>
            <path d={path} stroke={color} strokeWidth={2} strokeDasharray={linePatterns[index]} fill="none" />
            {item.values.map((value, row) => value === null ? null : <circle key={row} cx={x(row)} cy={y(value)} r={3} fill={color}>
              <title>{`${categories[row]} · ${item.label}: ${value}`}</title>
            </circle>)}
          </g>;
        })}
      </svg>
    </div>
  </figure>;
}
