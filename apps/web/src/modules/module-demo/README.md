# Module Demo

An optional module-authoring playground with examples for registration, English-fallback translations in English, German, French, and Italian, saved module state, interactive forms, realtime events, a location-scoped module-owned notes table with permission-checked create/delete routes, a browser Web Worker for the clock and weather lookup, and a separately supervised server worker process. Note changes are published live to other open tabs. The server worker's status, memory, uptime, logs, and restart control are registered through the module SDK and appear in Settings diagnostics. UI, worker processes, styles, migrations, and API handlers live in their respective `module-demo` folders. The weather example uses the public Open-Meteo geocoding and forecast APIs; the entered city name is sent to Open-Meteo only after the user submits it. No API key or Smart-Church configuration is required.

Enable **Module Demo** for a location in Settings → Modules.
