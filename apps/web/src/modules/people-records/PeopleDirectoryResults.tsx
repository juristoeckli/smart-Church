import "./people-directory-layout.css";

export type PeopleDirectoryLayout = "cards" | "table";

type DirectoryRow = {
  id: string;
  name: string;
  values: string[];
};

export function PeopleDirectoryResults({ layout, rows, columns, canManage, selectedIds, onSelect, onOpen }: {
  layout: PeopleDirectoryLayout;
  rows: DirectoryRow[];
  columns: string[];
  canManage: boolean;
  selectedIds: string[];
  onSelect: (id: string, selected: boolean) => void;
  onOpen: (id: string) => void;
}) {
  if (!rows.length) return null;
  const selected = new Set(selectedIds);
  const selection = (row: DirectoryRow) => <input type="checkbox" aria-label={`Select ${row.name}`}
    checked={selected.has(row.id)} onChange={(event) => onSelect(row.id, event.target.checked)} />;
  const open = (row: DirectoryRow) => <button type="button" className="people-directory-open" onClick={() => onOpen(row.id)}>
    {row.name}
  </button>;

  if (layout === "table") return <div className="people-directory-table-scroll" tabIndex={0}
    role="region" aria-label="Scrollable people directory">
    <table className="people-directory-table" aria-label="People directory">
      <thead><tr>
        {canManage && <th scope="col">Select</th>}
        <th scope="col">Person</th>
        {columns.map((column, index) => <th key={index} scope="col">{column}</th>)}
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>
        {canManage && <td>{selection(row)}</td>}
        <th scope="row">{open(row)}</th>
        {row.values.map((value, index) => <td key={index}>{value || "—"}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;

  return <div className="people-directory-cards">{rows.map((row) => <article className="people-directory-card" key={row.id}>
    <div className="people-directory-card-heading">{canManage && selection(row)}{open(row)}</div>
    {columns.length > 0 && <dl>{columns.map((column, index) => <div key={index}>
      <dt>{column}</dt><dd>{row.values[index] || "—"}</dd>
    </div>)}</dl>}
  </article>)}</div>;
}
