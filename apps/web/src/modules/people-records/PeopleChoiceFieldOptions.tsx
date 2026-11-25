import { useState, type FormEvent } from "react";

export type ChoiceOptionChange = { add: string } | { from: number; direction: "up" | "down" };

export function PeopleChoiceFieldOptions({ label, options, onChange }: {
  label: string;
  options: string[];
  onChange: (expected: string[], change: ChoiceOptionChange) => Promise<void>;
}) {
  const [newOption, setNewOption] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!Array.isArray(options) || options.length > 100 || options.some((option) => typeof option !== "string")) return null;

  async function save(change: ChoiceOptionChange) {
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      await onChange(options, change);
      if ("add" in change) setNewOption("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the choice options.");
    } finally {
      setSaving(false);
    }
  }

  function addOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const add = newOption.trim();
    if (add && !options.includes(add)) void save({ add });
  }

  return <details>
    <summary>Choices for {label}</summary>
    {options.length > 0 ? <ol>
      {options.map((option, index) => <li key={index}>
        {option}{" "}
        {options.length > 1 && <>
          <button type="button" aria-label={"Move " + option + " up in " + label}
            disabled={saving || index === 0} onClick={() => void save({ from: index, direction: "up" })}>Move up</button>
          <button type="button" aria-label={"Move " + option + " down in " + label}
            disabled={saving || index === options.length - 1} onClick={() => void save({ from: index, direction: "down" })}>Move down</button>
        </>}
      </li>)}
    </ol> : <p>No choices configured.</p>}
    <form className="module-toolbar" onSubmit={addOption}>
      <label>New choice<input maxLength={120} value={newOption} onChange={(event) => setNewOption(event.target.value)}
        disabled={saving || options.length >= 100} /></label>
      <button type="submit" disabled={saving || options.length >= 100 || !newOption.trim() || options.includes(newOption.trim())}>Add choice</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </details>;
}
