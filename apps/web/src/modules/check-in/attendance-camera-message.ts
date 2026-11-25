export const attendanceCameraMessage = "smart-church:group-attendance-camera";

export function isAttendanceCameraCode(value: unknown): value is string {
  return typeof value === "string" && /^SC-A1-[0-9A-F]{32}$/.test(value);
}
