import jsQR from "jsqr";
import { attendanceCameraMessage, isAttendanceCameraCode } from "./attendance-camera-message";

const video = document.querySelector<HTMLVideoElement>("#preview")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;
const photoInput = document.querySelector<HTMLInputElement>("#photo")!;
const status = document.querySelector<HTMLElement>("#status")!;
const canvas = document.createElement("canvas");
const pixels = canvas.getContext("2d", { willReadFrequently: true });
let stream: MediaStream | null = null;
let timer: number | undefined;
let revision = 0;
let delivered = false;

function stop() {
  revision++;
  window.clearTimeout(timer);
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  video.srcObject = null;
  video.hidden = true;
  stopButton.hidden = true;
  startButton.disabled = delivered || !window.opener || !navigator.mediaDevices?.getUserMedia;
  canvas.width = 0;
  canvas.height = 0;
}

function readCode(source: CanvasImageSource, width: number, height: number) {
  if (!pixels || !width || !height) return null;
  const scale = Math.min(1, 1280 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  pixels.drawImage(source, 0, 0, canvas.width, canvas.height);
  const frame = pixels.getImageData(0, 0, canvas.width, canvas.height);
  const candidate = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" })?.data;
  return isAttendanceCameraCode(candidate) ? candidate : null;
}

function deliver(code: string) {
  if (delivered) return;
  const opener = window.opener as Window | null;
  if (!opener || opener.closed) {
    stop();
    status.textContent = "Open the scanner from an active group meeting in Check-in.";
    return;
  }
  delivered = true;
  photoInput.disabled = true;
  stop();
  opener.postMessage({ type: attendanceCameraMessage, code }, window.location.origin);
  status.textContent = "Code read. Return to Check-in for the attendance result.";
  window.close();
}

async function start() {
  stop();
  if (!window.opener || !navigator.mediaDevices?.getUserMedia || delivered) return;
  const active = revision;
  startButton.disabled = true;
  stopButton.hidden = false;
  status.textContent = "Waiting for camera access…";
  try {
    const requested = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    });
    if (active !== revision) {
      for (const track of requested.getTracks()) track.stop();
      return;
    }
    stream = requested;
    video.srcObject = stream;
    video.hidden = false;
    await video.play();
    if (active !== revision) return;
    status.textContent = "Show one group attendance QR code in the camera preview.";
    const scan = () => {
      if (active !== revision) return;
      try {
        const code = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          ? readCode(video, video.videoWidth, video.videoHeight) : null;
        if (code) { deliver(code); return; }
        timer = window.setTimeout(scan, 180);
      } catch {
        stop();
        status.textContent = "The camera frame could not be read. Take or choose a photo.";
      }
    };
    scan();
  } catch {
    if (active !== revision) return;
    stop();
    status.textContent = "Camera access is unavailable. Take or choose a photo.";
  }
}

async function scanPhoto() {
  const file = photoInput.files?.[0];
  photoInput.value = "";
  if (!file || delivered || !window.opener) return;
  stop();
  const active = revision;
  if (file.size > 20 * 1024 * 1024) {
    status.textContent = "Choose a photo smaller than 20 MB.";
    return;
  }
  status.textContent = "Reading attendance QR code…";
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (active !== revision) return;
    const code = readCode(image, image.naturalWidth, image.naturalHeight);
    if (code) deliver(code);
    else status.textContent = "No group attendance QR code was found. Try another photo.";
  } catch {
    if (active === revision) status.textContent = "This photo could not be read. Try another image.";
  } finally {
    URL.revokeObjectURL(url);
    if (active === revision) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

startButton.addEventListener("click", () => void start());
stopButton.addEventListener("click", () => {
  stop();
  status.textContent = "Camera stopped.";
});
document.querySelector("#close")?.addEventListener("click", () => { stop(); window.close(); });
photoInput.addEventListener("change", () => void scanPhoto());
window.addEventListener("pagehide", stop);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && !stopButton.hidden) {
    stop();
    status.textContent = "Camera stopped. Start it again to resume scanning.";
  }
});
stop();
if (!window.opener) {
  photoInput.disabled = true;
  status.textContent = "Open the scanner from an active group meeting in Check-in.";
} else if (!navigator.mediaDevices?.getUserMedia) {
  status.textContent = "Live camera scanning is unavailable. Take or choose a photo.";
}
