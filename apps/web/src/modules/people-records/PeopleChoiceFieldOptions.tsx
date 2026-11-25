import { useState, type FormEvent } from "react";

export type ChoiceOptionChange = { add: string } | { from: number; direction: "up" | "down" } | { remove: number };
type ChoiceRenameRequest = { from: number; rename: string; reviewToken?: string };
type ChoiceRenameCounts = { profiles: number; archivedProfiles: number; savedViews: number };
export type ChoiceRenameResult = ChoiceRenameCounts & ({ reviewToken: string } | { options: string[] });
export type ReviewChoiceRename = (expected: string[], rename: ChoiceRenameRequest) => Promise<ChoiceRenameResult>;

export function PeopleChoiceFieldOptions({ label, options, required, onChange, onReviewRename }: {
  label: string;
  options: string[];
  required: boolean;
  onChange: (expected: string[], change: ChoiceOptionChange) => Promise<void>;
  onReviewRename: ReviewChoiceRename;
}) {
  const [newOption, setNewOption] = useState("");
  const [editing, setEditing] = useState<{ index: number; original: string; text: string } | null>(null);
  const [review, setReview] = useState<(ChoiceRenameCounts & { reviewToken: string }) | null>(null);
  const [removing, setRemoving] = useState<{ index: number; original: string } | null>(null);
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
      if ("remove" in change) setRemoving(null);
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

  const edit = editing && options[editing.index] === editing.original ? editing : null;
  const removal = removing && options[removing.index] === removing.original ? removing : null;
  async function renameOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rename = edit?.text.trim();
    if (!edit || saving || !rename || options.includes(rename)) return;
    setError("");
    setSaving(true);
    try {
      const result = await onReviewRename(options, { from: edit.index, rename, reviewToken: review?.reviewToken });
      if ("reviewToken" in result) setReview(result);
      else { setReview(null); setEditing(null); }
    } catch (cause) {
      setReview(null);
      setError(cause instanceof Error ? cause.message : "Could not rename the choice.");
    } finally { setSaving(false); }
  }
  return <details>
    <summary>Choices for {label}</summary>
    {options.length > 0 ? <ol>
      {options.map((option, index) => <li key={index}>
        {option}{" "}
        {!edit && !removal && <button type="button" disabled={saving}
          aria-label={"Rename " + option + " in " + label}
          onClick={() => { setError(""); setReview(null); setEditing({ index, original: option, text: option }); }}>Rename</button>}
        {edit?.index === index && <form className="module-toolbar" onSubmit={renameOption}>
          <label>New choice name<input maxLength={120} value={edit.text} disabled={saving}
            onChange={(event) => { setReview(null); setEditing({ ...edit, text: event.target.value }); }} /></label>
          <button type="submit" disabled={saving || !edit.text.trim() || options.includes(edit.text.trim())}>{review ? "Apply rename" : "Review rename"}</button>
          <button type="button" disabled={saving} onClick={() => { setEditing(null); setReview(null); setError(""); }}>Cancel</button>
          {review && <p role="status">This will update {review.profiles} profiles ({review.archivedProfiles} archived)
            and {review.savedViews} saved People views.</p>}
        </form>}
        {!edit && !removal && <button type="button" disabled={saving || (required && options.length === 1)}
          aria-label={"Delete " + option + " in " + label}
          onClick={() => { setError(""); setRemoving({ index, original: option }); }}>Delete</button>}
        {removal?.index === index && <div className="module-toolbar" role="group" aria-label={"Confirm deletion of " + option}>
          <p>Delete “{option}” from {label}? This removes it from the list of available choices.</p>
          <button type="button" disabled={saving} onClick={() => void save({ remove: index })}>Delete choice</button>
          <button type="button" disabled={saving} onClick={() => { setRemoving(null); setError(""); }}>Cancel</button>
        </div>}
        {options.length > 1 && <>
          <button type="button" aria-label={"Move " + option + " up in " + label}
            disabled={saving || !!edit || !!removal || index === 0} onClick={() => void save({ from: index, direction: "up" })}>Move up</button>
          <button type="button" aria-label={"Move " + option + " down in " + label}
            disabled={saving || !!edit || !!removal || index === options.length - 1} onClick={() => void save({ from: index, direction: "down" })}>Move down</button>
        </>}
      </li>)}
    </ol> : <p>No choices configured.</p>}
    <form className="module-toolbar" onSubmit={addOption}>
      <label>New choice<input maxLength={120} value={newOption} onChange={(event) => setNewOption(event.target.value)}
        disabled={saving || !!edit || !!removal || options.length >= 100} /></label>
      <button type="submit" disabled={saving || !!edit || !!removal || options.length >= 100 || !newOption.trim() || options.includes(newOption.trim())}>Add choice</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </details>;
}
