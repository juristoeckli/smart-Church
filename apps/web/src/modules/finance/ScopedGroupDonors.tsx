import { useCallback, useEffect, useState } from "react";

type Center = { id: string; code: string; name: string };
type Donor = { displayName: string; donorType: "individual" | "joint" };
type DonorPage = { page: number; donors: Donor[]; hasMore: boolean };
const path = "/api/modules/finance/group-donors";

export function ScopedGroupDonors({ departmentId }: { departmentId: string }) {
  const [centers, setCenters] = useState<Center[]>();
  const [centerId, setCenterId] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<DonorPage>();
  const [error, setError] = useState("");
  const get = useCallback(async <T,>(relative = "") => {
    const response = await fetch(path + relative, { headers: { "x-department-id": departmentId } });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load group donors.");
    return data;
  }, [departmentId]);
  useEffect(() => {
    let current = true;
    void get<{ centers: Center[] }>().then(data => {
      if (!current) return;
      setCenters(data.centers);
      setCenterId(data.centers[0]?.id ?? "");
    }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "Could not load group donors."); });
    return () => { current = false; };
  }, [get]);
  useEffect(() => {
    setResult(undefined);
    if (!centerId) return;
    setError("");
    let current = true;
    void get<DonorPage>(`/centers/${centerId}?page=${page}`).then(data => { if (current) setResult(data); })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "Could not load group donors."); });
    return () => { current = false; };
  }, [get,centerId,page]);

  return <main className="finance-page">
    <section className="finance-section">
      <h2>Group donors</h2>
      {error && <p role="alert">{error}</p>}
      {centers && (centers.length ? <div className="finance-form-grid">
        <label>Cost center<select value={centerId} onChange={event => { setCenterId(event.target.value); setPage(1); }}>
          {centers.map(center => <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
        </select></label>
      </div> : <p>No donor cost centers are available for your group roles.</p>)}
      {result && <>
        {result.donors.length ? <div className="finance-table-wrap"><table className="finance-table">
          <thead><tr><th>Donor</th><th>Type</th></tr></thead>
          <tbody>{result.donors.map((donor,index) => <tr key={index}>
            <td>{donor.displayName}</td><td>{donor.donorType === "joint" ? "Joint" : "Individual"}</td>
          </tr>)}</tbody>
        </table></div> : <p>No donors are linked to posted gifts for this cost center.</p>}
        {(page > 1 || result.hasMore) && <div className="finance-form-actions">
          <button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page}</span>
          <button type="button" className="button button-secondary" disabled={!result.hasMore} onClick={() => setPage(page + 1)}>Next</button>
        </div>}
      </>}
    </section>
  </main>;
}
