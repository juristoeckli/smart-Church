import { useEffect, useState } from "react";

const digestPath = "/api/modules/community-feed/digest-preferences";
const weekdays = [1, 2, 3, 4, 5, 6, 7];

export function DigestPreferences({ departmentId, language, t, sendMutation }: {
  departmentId: string;
  language: string;
  t: (message: string) => string;
  sendMutation: (path: string, method: string, payload: object) => Promise<Record<string, unknown>>;
}) {
  const [weekday, setWeekday] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const weekdayName = new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" });

  useEffect(() => {
    const controller = new AbortController();
    void fetch(digestPath, { headers: { "x-department-id": departmentId }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load digest preferences.");
        const result = await response.json() as { weekday: number | null };
        if (!controller.signal.aborted) { setWeekday(result.weekday); setLoaded(true); }
      })
      .catch(() => { if (!controller.signal.aborted) setFeedback({ text: "Could not load digest preferences.", error: true }); });
    return () => controller.abort();
  }, [departmentId]);

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      await sendMutation(digestPath, "PUT", { weekday });
      setFeedback({ text: "Digest preference saved.", error: false });
    } catch (reason) {
      setFeedback({ text: reason instanceof Error ? reason.message : "Could not save digest preference.", error: true });
    } finally { setSaving(false); }
  }

  return <div className="community-notification-preference-group">
    <strong>{t("Weekly post digest")}</strong>
    <p>{t("Receive a weekly email at 08:00 local time when there are new posts you can access. Email notifications must also be enabled in Notifications for this location.")}</p>
    <div className="community-notification-preference-options">
      <label>{t("Send day")}
        <select value={weekday ?? ""} disabled={!loaded || saving} onChange={(event) => setWeekday(event.target.value ? Number(event.target.value) : null)}>
          <option value="">{t("Off")}</option>
          {weekdays.map((day) => <option key={day} value={day}>{weekdayName.format(Date.UTC(2024, 0, day))}</option>)}
        </select>
      </label>
      <button type="button" className="community-post-details" disabled={!loaded || saving} onClick={() => void save()}>{saving ? t("Saving…") : t("Save digest preference")}</button>
    </div>
    {feedback && <p role={feedback.error ? "alert" : "status"}>{t(feedback.text)}</p>}
  </div>;
}
