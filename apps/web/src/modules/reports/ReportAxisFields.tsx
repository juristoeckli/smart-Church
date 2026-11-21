import { ArrowUp } from "lucide-react";

type Axis = "row" | "column";

export function ReportAxisFields({ axis, keys, fields, blockedKeys, onChange }: {
  axis: Axis;
  keys: string[];
  fields: Array<{ key: string; label: string }>;
  blockedKeys: string[];
  onChange: (keys: string[]) => void;
}) {
  const options = fields.filter(({ key }) => !blockedKeys.includes(key));
  const unused = options.find(({ key }) => !keys.includes(key));
  const axisLabel = axis === "row" ? "Row" : "Pivot column";

  function moveUp(index: number) {
    const ordered = [...keys];
    [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
    onChange(ordered);
  }

  return <fieldset className="reports-axis-fields">
    <legend>{axisLabel} fields</legend>
    {(keys.length ? keys : [""]).map((key, index) => <div className="reports-axis-field" key={index}>
      <label>{axisLabel} field {index + 1}<select value={key} onChange={(event) => {
        const value = event.target.value;
        const next = keys.length ? keys.map((current, position) => position === index ? value : current) : [value];
        onChange(next.filter(Boolean));
      }}><option value="">{key ? "Remove field" : axis === "row" ? "No grouping" : "No pivot columns"}</option>
        {options.filter((option) => option.key === key || !keys.includes(option.key)).map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}
      </select></label>
      {index > 0 && <button type="button" className="button button-secondary" aria-label={`Move ${axisLabel.toLowerCase()} field ${index + 1} up`} onClick={() => moveUp(index)}><ArrowUp size={15} /></button>}
    </div>)}
    {keys.length > 0 && keys.length < 3 && unused && <button type="button" className="button button-secondary" onClick={() => onChange([...keys, unused.key])}>Add {axisLabel.toLowerCase()} field</button>}
  </fieldset>;
}
