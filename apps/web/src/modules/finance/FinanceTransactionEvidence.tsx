import { useEffect, useState, type FormEvent } from "react";

type Receipt = { id: string; fileName: string; fileSize: number; uploadedAt: string; uploadedBy: string | null };
const maxBytes = 10 * 1024 * 1024;
const uploadType = "application/vnd.smart-church.finance-evidence";

export function FinanceTransactionEvidence({ transactionId,departmentId,csrfToken,canManage }: {
  transactionId: string; departmentId: string; csrfToken: string; canManage: boolean;
}) {
  const path = `/api/modules/finance/transactions/${transactionId}/evidence`;
  const [open,setOpen] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const [receipts,setReceipts] = useState<Receipt[] | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [feedback,setFeedback] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(path,{headers:{"x-department-id":departmentId},cache:"no-store",signal:controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error("Could not load supporting receipts.");
        const rows = await response.json() as Receipt[];
        if (!controller.signal.aborted) setReceipts(rows);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load supporting receipts."); });
    return () => controller.abort();
  },[path,departmentId,open,refresh]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canManage) return;
    const form = event.currentTarget;
    const files = new FormData(form).getAll("receipts").filter((entry): entry is File => entry instanceof File && entry.size>0);
    setError("");
    setFeedback("");
    if (!files.length || files.length>10 || files.some(file => file.size>maxBytes)) {
      setError("Choose up to 10 PDF, PNG or JPEG receipts, each 10 MiB or smaller.");
      return;
    }
    setBusy(true);
    let completed = 0;
    try {
      for (const file of files) {
        const response = await fetch(path+"?"+new URLSearchParams({filename:file.name}),{
          method:"POST",headers:{"x-department-id":departmentId,"x-csrf-token":csrfToken,"content-type":uploadType},body:file,
        });
        if (!response.ok) {
          const reason = await response.json().catch(() => null) as { error?:string } | null;
          throw new Error(reason?.error ?? "Could not save the selected receipt.");
        }
        completed++;
      }
      form.reset();
      setFeedback(completed===1 ? "Receipt saved." : `${completed} receipts saved.`);
    } catch (reason) {
      if (completed) setFeedback(`${completed} receipts processed before the upload stopped.`);
      setError(reason instanceof Error ? reason.message : "Could not save receipts.");
    } finally {
      if (completed) setRefresh(current => current+1);
      setBusy(false);
    }
  }

  async function download(receipt: Receipt) {
    setError("");
    try {
      const response = await fetch(path+"/"+encodeURIComponent(receipt.id),{
        headers:{"x-department-id":departmentId},cache:"no-store",
      });
      if (!response.ok) throw new Error("Could not download this receipt.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = receipt.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch(reason) {
      setError(reason instanceof Error ? reason.message : "Could not download this receipt.");
    }
  }

  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Supporting receipts</summary>
    {open && <>
      {canManage && <form onSubmit={event => void upload(event)}>
        <label>Add supporting receipts <input aria-label="Supporting receipt files" type="file" name="receipts"
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" multiple required disabled={busy} /></label>
        <button type="submit" className="button button-secondary" disabled={busy}>Upload receipts</button>
        <p>PDF, PNG or JPEG. Up to 10 MiB per receipt and 10 receipts per transaction.</p>
      </form>}
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {!receipts && !error && <p role="status">Loading supporting receipts…</p>}
      {receipts?.length === 0 && <p>No supporting receipts uploaded.</p>}
      {!!receipts?.length && <ul>{receipts.map(receipt => <li key={receipt.id}>
        <button type="button" className="finance-text-button" onClick={() => void download(receipt)}>{receipt.fileName}</button>
        {" · "}{Math.ceil(receipt.fileSize/1024)} KiB{" · "}{new Date(receipt.uploadedAt).toLocaleDateString()}
        {receipt.uploadedBy && ` · ${receipt.uploadedBy}`}
      </li>)}</ul>}
    </>}
  </details>;
}
