#include <WiFi.h>
#include <WebServer.h>

#include "wifi_secrets.h"
constexpr uint8_t LED_PIN = 4;
WebServer server(80);
int brightness = 0;
constexpr uint32_t MIN_FREQUENCY = 200;
constexpr uint32_t MAX_FREQUENCY = 20000;
bool wasConnected = false;
unsigned long lastWifiAttempt = 0;

const char PAGE[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LED control</title>
<style>
body{font:18px system-ui;background:#101827;color:#eef3ff;max-width:440px;margin:70px auto;padding:24px}
section{background:#1e293b;padding:28px;border-radius:18px}
input{width:100%;margin:24px 0;accent-color:#60a5fa}
#status{color:#fbbf24} #status[data-state=online]{color:#4ade80}
#status[data-state=offline]{color:#fb7185}small{color:#b6c3d6}
</style>
<section><h1>LED PWM control</h1>
<p id="status" role="status">Checking connection...</p>
<label for="level">Duty cycle: <output id="value">0%</output></label>
<input id="level" type="range" min="0" max="100" value="0" disabled>
<label for="frequency">Frequency (200–20000 Hz)</label>
<input id="frequency" type="number" min="200" max="20000" step="1" value="5000" disabled>
<button id="apply" disabled>Apply PWM settings</button>
<p id="error" role="alert"></p>
<small id="confirmation">Waiting for ESP32</small></section>
<script>
const slider=document.querySelector('#level'),value=document.querySelector('#value');
const status=document.querySelector('#status'),confirmation=document.querySelector('#confirmation');
const frequency=document.querySelector('#frequency'),apply=document.querySelector('#apply'),error=document.querySelector('#error');
let desired=null,busy=false,editing=false;
function connection(ok){
  status.textContent=ok?'Connected to ESP32':'Disconnected from ESP32';
  status.dataset.state=ok?'online':'offline';slider.disabled=!ok;
  frequency.disabled=!ok;apply.disabled=!ok;
}
async function exchange(){
  if(busy)return;
  busy=true;
  const target=desired;desired=null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),2000);
  try{
    const response=await fetch(target===null?'/api/status':'/api/pwm',{
      method:target===null?'GET':'POST',cache:'no-store',signal:controller.signal,
      ...(target===null?{}:{headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(target).toString()})
    });
    if(!response.ok){connection(true);error.textContent=await response.text();return;}
    const state=await response.json();
    if(!Number.isInteger(state.brightness)||state.brightness<0||state.brightness>100||!Number.isInteger(state.frequency)||state.frequency<=0)throw Error('Invalid reply');
    connection(true);
    confirmation.textContent='Confirmed by ESP32: '+state.brightness+'% duty, '+state.frequency+' Hz';
    if(desired===null&&!editing){slider.value=state.brightness;value.textContent=state.brightness+'%';frequency.value=state.frequency;}
  }catch(error){
    connection(false);desired=null;editing=false;
    confirmation.textContent='No response. Reconnecting automatically...';
  }finally{clearTimeout(timer);busy=false;}
}
slider.addEventListener('input',()=>{
  editing=true;value.textContent=slider.value+'%';
});
frequency.addEventListener('input',()=>editing=true);
apply.addEventListener('click',()=>{
  if(!frequency.reportValidity())return;
  desired={duty:slider.value,frequency:frequency.value};
  editing=false;error.textContent='';exchange();
});
setInterval(()=>{if(desired!==null)exchange();},100);
setInterval(exchange,1000);
window.addEventListener('online',exchange);
window.addEventListener('offline',()=>connection(false));
exchange();
</script></html>)HTML";

void sendStatus() {
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", String("{\"brightness\":") + brightness +
    ",\"frequency\":" + ledcReadFreq(LED_PIN) + "}");
}

bool parseNumber(const String& input, uint32_t minimum, uint32_t maximum, uint32_t& value) {
  if (input.length() == 0 || input.length() > 5) return false;
  for (unsigned int i = 0; i < input.length(); ++i) {
    if (input[i] < '0' || input[i] > '9') return false;
  }
  value = input.toInt();
  return value >= minimum && value <= maximum;
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  Serial.begin(115200);
  if (!ledcAttach(LED_PIN, 5000, 8)) {
    Serial.println("PWM initialization failed");
    while (true) delay(1000);
  }
  ledcWrite(LED_PIN, 0);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttempt = millis();
  Serial.println("Connecting to Wi-Fi...");
  server.on("/", HTTP_GET, []() { server.send_P(200, "text/html", PAGE); });
  server.on("/api/status", HTTP_GET, sendStatus);
  server.on("/api/pwm", HTTP_POST, []() {
    uint32_t requested, frequency;
    if (!parseNumber(server.arg("duty"), 0, 100, requested) ||
        !parseNumber(server.arg("frequency"), MIN_FREQUENCY, MAX_FREQUENCY, frequency)) {
      server.send(400, "text/plain", "Duty must be 0-100%; frequency must be 200-20000 Hz (whole numbers)."); return;
    }
    if (frequency != ledcReadFreq(LED_PIN) && !ledcChangeFrequency(LED_PIN, frequency, 8)) {
      server.send(500, "text/plain", "Frequency update failed. Check confirmed settings."); return;
    }
    if (!ledcWrite(LED_PIN, (requested * 255 + 50) / 100)) {
      server.send(500, "text/plain", "PWM update failed"); return;
    }
    brightness = requested;
    sendStatus();
  });
  server.begin();
}

void loop() {
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !wasConnected) {
    Serial.print("Connected. Open http://"); Serial.println(WiFi.localIP());
  } else if (!connected && wasConnected) {
    Serial.println("Wi-Fi disconnected. Reconnecting...");
    lastWifiAttempt = millis();
  }
  wasConnected = connected;
  if (!connected && millis() - lastWifiAttempt >= 30000) {
    lastWifiAttempt = millis();
    Serial.println("Retrying Wi-Fi connection...");
    WiFi.reconnect();
  }
  if (connected) server.handleClient();
  delay(2);
}
