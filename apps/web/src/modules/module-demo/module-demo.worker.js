const clockTimer = setInterval(() => {
  self.postMessage({ type: "clock", now: new Date().toISOString() });
}, 1000);

self.postMessage({ type: "clock", now: new Date().toISOString() });

self.onmessage = async (event) => {
  const message = event.data;
  if (!message || message.type !== "weather" || typeof message.city !== "string" || typeof message.requestId !== "number") return;

  const requestId = message.requestId;
  try {
    const lookup = new URL("https://geocoding-api.open-meteo.com/v1/search");
    lookup.search = new URLSearchParams({ name: message.city.trim(), count: "1", language: "en", format: "json" }).toString();
    const lookupResponse = await fetch(lookup);
    if (!lookupResponse.ok) throw new Error("The location service could not be reached.");
    const lookupData = await lookupResponse.json();
    const place = lookupData.results?.[0];
    if (!place || typeof place.latitude !== "number" || typeof place.longitude !== "number") throw new Error("No matching city was found. Try a different name.");

    const forecast = new URL("https://api.open-meteo.com/v1/forecast");
    forecast.search = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: "temperature_2m,weather_code",
      timezone: "auto",
      forecast_days: "1",
    }).toString();
    const forecastResponse = await fetch(forecast);
    if (!forecastResponse.ok) throw new Error("Current weather data could not be reached.");
    const forecastData = await forecastResponse.json();
    const current = forecastData.current;
    if (typeof current?.temperature_2m !== "number" || typeof current?.weather_code !== "number") throw new Error("The weather service returned incomplete data.");

    self.postMessage({
      type: "weather-result",
      requestId,
      result: {
        place: String(place.name ?? message.city),
        country: typeof place.country === "string" ? place.country : undefined,
        temperature: current.temperature_2m,
        weatherCode: current.weather_code,
        timeZone: typeof forecastData.timezone === "string" ? forecastData.timezone : "UTC",
      },
    });
  } catch (error) {
    self.postMessage({ type: "weather-error", requestId, error: error instanceof Error ? error.message : "Weather data could not be loaded." });
  }
};

self.addEventListener("close", () => clearInterval(clockTimer));
