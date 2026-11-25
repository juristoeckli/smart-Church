type CategoryChoice = { category: { id: string; name: string }; depth: number };

export function WikiPageCategoryFilter({ choices, selected, onChange }: {
  choices: CategoryChoice[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return <details className="wiki-page-category-filter">
    <summary>Filter by category{selected.length ? ` (${selected.length})` : ""}</summary>
    <fieldset>
      <legend>Show pages from any selected category</legend>
      {choices.map(({ category, depth }) => {
        const checked = selected.includes(category.id);
        return <label key={category.id} style={{ paddingInlineStart: `${Math.min(depth, 6) * .6}rem` }}>
          <input type="checkbox" checked={checked} disabled={!checked && selected.length >= 50}
            onChange={(event) => onChange(event.target.checked ? [...selected, category.id] : selected.filter((id) => id !== category.id))} />
          {category.name}
        </label>;
      })}
    </fieldset>
    {selected.length > 0 && <button className="button button-quiet" type="button" onClick={() => onChange([])}>Clear category filters</button>}
  </details>;
}
