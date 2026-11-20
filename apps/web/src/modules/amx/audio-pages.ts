import { amxAudioPages } from "../../../../api/src/modules/amx/audio-mappings";
export type AmxControlAction = { id: string; name: string; channel: number; port?: number };
export type AmxControl = { id: string; name: string; actions?: AmxControlAction[]; readonly?: string; unavailable?: boolean };
export type AmxAudioPage = { id: string; room: string; page: string; controls: AmxControl[] };

// Shared with the API allowlist so page buttons and server-side mappings stay in sync.
export const audioPages: AmxAudioPage[] = amxAudioPages;
export const optionalAudioActions = audioPages.flatMap((page) => page.controls.map((item) => ({ ...item, command: "" })));
