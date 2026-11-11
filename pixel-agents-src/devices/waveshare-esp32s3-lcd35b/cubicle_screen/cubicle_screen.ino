/*
 * Cubicle Screen: tus agentes de Cubicle en una Waveshare ESP32-S3-Touch-LCD-3.5B.
 *
 * - Se conecta al Wi-Fi (la primera vez crea la red "Cubicle-Pantalla": conéctate
 *   desde el móvil y elige tu Wi-Fi; la contraseña se queda solo en la placa).
 * - Pide a Cubicle la lista de agentes cada 2 s (GET /device/agents) y los dibuja
 *   con el color de su sala y su estado: Trabajando, Te necesita o Libre.
 * - Al tocar un agente, Cubicle lo abre en el computador (POST /device/open).
 * - Mantener BOOT 3 s borra el Wi-Fi guardado y vuelve a abrir el portal.
 *
 * Servidor, puerto y clave se guardan por el puerto serie (ver README.md):
 *   CFG {"host":"mi-mac.local","port":3101,"key":"..."}
 *
 * Pantalla: controlador AXS15231B por QSPI (320x480) y táctil del mismo chip por I2C
 * (0x3B). El reset de la pantalla va por el expansor TCA9554 (0x20, pin 1).
 */
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Arduino_GFX_Library.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <TCA9554.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <Wire.h>

// ── Pines de la placa ─────────────────────────────────────────────
#define PIN_BL 6
#define PIN_QSPI_CS 12
#define PIN_QSPI_CLK 5
#define PIN_QSPI_D0 1
#define PIN_QSPI_D1 2
#define PIN_QSPI_D2 3
#define PIN_QSPI_D3 4
#define PIN_SDA 8
#define PIN_SCL 7
#define PIN_BOOT 0
#define TOUCH_ADDR 0x3B

// ── Pantalla: 480x320 en horizontal, dibujada en un lienzo en PSRAM ──
static const int W = 480;
static const int H = 320;
TCA9554 tca(0x20);
Arduino_DataBus *bus = new Arduino_ESP32QSPI(PIN_QSPI_CS, PIN_QSPI_CLK, PIN_QSPI_D0, PIN_QSPI_D1, PIN_QSPI_D2, PIN_QSPI_D3);
Arduino_GFX *panel = new Arduino_AXS15231B(bus, -1, 0, false, 320, 480);
Arduino_Canvas *gfx = new Arduino_Canvas(320, 480, panel, 0, 0, 1);

// ── Colores (RGB565) ──────────────────────────────────────────────
static const uint16_t C_BG = 0x0861;      // fondo casi negro azulado
static const uint16_t C_CARD = 0x18E4;    // ficha
static const uint16_t C_TEXT = 0xFFFF;
static const uint16_t C_MUTED = 0x9CF3;
static const uint16_t C_WORK = 0x4D1F;    // azul: trabajando
static const uint16_t C_NEED = 0xFE60;    // amarillo: te necesita
static const uint16_t C_IDLE = 0x7BEF;    // gris: libre
static const uint16_t C_ERR = 0xF9A6;

// ── Configuración guardada ────────────────────────────────────────
Preferences prefs;
WiFiManager wm;
bool portalOpen = false;
bool mdnsReady = false;
String cfgHost;
uint16_t cfgPort = 3101;
String cfgKey;
IPAddress hostIp;

// ── Agentes ───────────────────────────────────────────────────────
struct Agent {
  int id;
  String name;
  String room;
  String pokemon;
  uint16_t color;
  char status;  // 'w' trabajando, 'p' te necesita, 'i' libre
};
static const int MAX_AGENTS = 40;
Agent agents[MAX_AGENTS];
int agentCount = 0;
int page = 0;
String lastPayload;
String errorText;
String toastText;
uint32_t toastUntil = 0;
int pressedIndex = -1;

// Rejilla: 2 columnas x 7 filas por página bajo la cabecera.
static const int HEADER_H = 34;
static const int COLS = 2;
static const int ROWS = 7;
static const int PER_PAGE = COLS * ROWS;
static const int GAP = 4;

// ── Utilidades ────────────────────────────────────────────────────
uint16_t hexTo565(const char *hex) {
  if (!hex || hex[0] != '#' || strlen(hex) < 7) return C_IDLE;
  long v = strtol(hex + 1, nullptr, 16);
  uint8_t r = (v >> 16) & 0xFF, g = (v >> 8) & 0xFF, b = v & 0xFF;
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

/** La fuente integrada es ASCII: quita tildes y eñes (á→a, ñ→n) y descarta lo demás. */
String ascii(const String &s) {
  String out;
  for (size_t i = 0; i < s.length(); i++) {
    uint8_t c = s[i];
    if (c < 0x80) {
      out += (char)c;
    } else if (c == 0xC3 && i + 1 < s.length()) {
      uint8_t d = s[++i];
      const char *map = "AAAAAAACEEEEIIIIDNOOOOOxOUUUUYPsaaaaaaaceeeeiiiidnooooo/ouuuuypy";
      if (d >= 0x80 && d <= 0xBF) out += map[d - 0x80];
    } else if (c >= 0xC0) {
      while (i + 1 < s.length() && (uint8_t(s[i + 1]) & 0xC0) == 0x80) i++;
    }
  }
  return out;
}

String fit(const String &s, int maxChars) {
  if ((int)s.length() <= maxChars) return s;
  return s.substring(0, maxChars - 1) + ".";
}

uint16_t statusColor(char st) { return st == 'w' ? C_WORK : st == 'p' ? C_NEED : C_IDLE; }
const char *statusLabel(char st) { return st == 'w' ? "Trabajando" : st == 'p' ? "Te necesita" : "Libre"; }

// ── Táctil (AXS15231B por I2C, sondeado) ──────────────────────────
bool readTouch(int &x, int &y) {
  static const uint8_t cmd[11] = {0xb5, 0xab, 0xa5, 0x5a, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00};
  uint8_t d[14] = {0};
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(cmd, sizeof(cmd));
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(TOUCH_ADDR, (uint8_t)14) != 14) return false;
  Wire.readBytes(d, 14);
  if (d[0] == 0xff || d[1] == 0 || d[1] > 2) return false;
  int rx = ((d[2] & 0x0F) << 8) | d[3];
  int ry = ((d[4] & 0x0F) << 8) | d[5];
  if (rx >= 320 || ry >= 480) return false;
  // Panel vertical (320x480) girado a horizontal (rotación 1 del lienzo).
  x = ry;
  y = 319 - rx;
  return true;
}

// ── Dibujo ────────────────────────────────────────────────────────
void cardRect(int slot, int &x, int &y, int &w, int &h) {
  int col = slot % COLS, row = slot / COLS;
  w = (W - GAP * (COLS + 1)) / COLS;
  h = (H - HEADER_H - GAP * (ROWS + 1)) / ROWS;
  x = GAP + col * (w + GAP);
  y = HEADER_H + GAP + row * (h + GAP);
}

int pages() { return max(1, (agentCount + PER_PAGE - 1) / PER_PAGE); }

void drawMessage(const char *title, const String &line1, const String &line2 = "") {
  gfx->fillScreen(C_BG);
  gfx->setTextColor(C_TEXT);
  gfx->setTextSize(3);
  gfx->setCursor(20, 90);
  gfx->print(title);
  gfx->setTextSize(2);
  gfx->setTextColor(C_MUTED);
  gfx->setCursor(20, 150);
  gfx->print(line1);
  gfx->setCursor(20, 180);
  gfx->print(line2);
  gfx->flush();
}

void draw() {
  gfx->fillScreen(C_BG);
  // Cabecera: nombre, recuento y página.
  int working = 0, needs = 0;
  for (int i = 0; i < agentCount; i++) {
    if (agents[i].status == 'w') working++;
    if (agents[i].status == 'p') needs++;
  }
  gfx->setTextSize(2);
  gfx->setTextColor(C_TEXT);
  gfx->setCursor(8, 10);
  gfx->print("Cubicle");
  gfx->setTextColor(C_WORK);
  gfx->setCursor(110, 10);
  gfx->printf("%d trabajando", working);
  if (needs > 0) {
    gfx->setTextColor(C_NEED);
    gfx->setCursor(280, 10);
    gfx->printf("%d te necesita%s", needs, needs > 1 ? "n" : "");
  }
  if (pages() > 1) {
    gfx->setTextColor(C_MUTED);
    gfx->setCursor(W - 60, 10);
    gfx->printf("%d/%d", page + 1, pages());
  }
  if (errorText.length()) {
    gfx->fillRect(0, 0, W, HEADER_H, C_ERR);
    gfx->setTextColor(C_TEXT);
    gfx->setCursor(8, 10);
    gfx->print(fit(errorText, 39));
  }

  // Fichas.
  int start = page * PER_PAGE;
  for (int slot = 0; slot < PER_PAGE && start + slot < agentCount; slot++) {
    const Agent &a = agents[start + slot];
    int x, y, w, h;
    cardRect(slot, x, y, w, h);
    uint16_t sc = statusColor(a.status);
    bool pressed = (start + slot) == pressedIndex;
    gfx->fillRoundRect(x, y, w, h, 4, pressed ? sc : C_CARD);
    gfx->fillRect(x, y, 5, h, a.color);  // color de la sala
    if (a.status != 'i') gfx->drawRoundRect(x, y, w, h, 4, sc);
    // Nombre
    gfx->setTextSize(2);
    gfx->setTextColor(pressed ? C_BG : C_TEXT);
    gfx->setCursor(x + 11, y + 4);
    gfx->print(fit(ascii(a.name), (w - 16) / 12));
    // Estado (punto + texto) y Pokémon o sala debajo
    gfx->fillCircle(x + 15, y + h - 9, 4, sc);
    gfx->setTextSize(1);
    gfx->setTextColor(pressed ? C_BG : sc);
    gfx->setCursor(x + 23, y + h - 12);
    gfx->print(statusLabel(a.status));
    String sub = a.pokemon.length() ? a.pokemon : a.room;
    gfx->setTextColor(pressed ? C_BG : C_MUTED);
    String s = fit(ascii(sub), 16);
    gfx->setCursor(x + w - 6 - s.length() * 6, y + h - 12);
    gfx->print(s);
  }
  if (agentCount == 0 && !errorText.length()) {
    gfx->setTextSize(2);
    gfx->setTextColor(C_MUTED);
    gfx->setCursor(20, 150);
    gfx->print("Sin agentes en la oficina");
  }

  // Aviso temporal (p. ej. "Abriendo X").
  if (millis() < toastUntil) {
    gfx->fillRoundRect(60, H - 52, W - 120, 40, 6, C_TEXT);
    gfx->setTextSize(2);
    gfx->setTextColor(C_BG);
    String t = fit(ascii(toastText), 30);
    gfx->setCursor((W - t.length() * 12) / 2, H - 40);
    gfx->print(t);
  }
  gfx->flush();
}

// ── Red ───────────────────────────────────────────────────────────
bool resolveHost() {
  if (hostIp.fromString(cfgHost)) return true;
  if (cfgHost.endsWith(".local")) {
    IPAddress ip = MDNS.queryHost(cfgHost.substring(0, cfgHost.length() - 6), 2000);
    if (ip != IPAddress(0, 0, 0, 0)) {
      hostIp = ip;
      return true;
    }
    return hostIp != IPAddress(0, 0, 0, 0);  // la última que funcionó
  }
  return WiFi.hostByName(cfgHost.c_str(), hostIp) == 1;
}

String baseUrl() { return "http://" + hostIp.toString() + ":" + String(cfgPort); }

bool fetchAgents() {
  if (WiFi.status() != WL_CONNECTED) {
    errorText = "Sin Wi-Fi";
    return false;
  }
  if (!resolveHost()) {
    errorText = "No encuentro " + cfgHost;
    return false;
  }
  HTTPClient http;
  http.setConnectTimeout(2000);
  http.setTimeout(3000);
  http.begin(baseUrl() + "/device/agents");
  http.addHeader("X-Cubicle-Key", cfgKey);
  int code = http.GET();
  if (code != 200) {
    errorText = code == 401 ? "Clave incorrecta" : code < 0 ? "Cubicle no responde" : "Error " + String(code);
    http.end();
    if (code < 0 && cfgHost.endsWith(".local")) hostIp = IPAddress(0, 0, 0, 0);  // re-resolver
    return false;
  }
  String body = http.getString();
  http.end();
  errorText = "";
  if (body == lastPayload) return false;  // sin cambios: no redibujar
  lastPayload = body;

  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    errorText = "Respuesta no valida";
    return true;
  }
  agentCount = 0;
  for (JsonObject a : doc["agents"].as<JsonArray>()) {
    if (agentCount >= MAX_AGENTS) break;
    Agent &g = agents[agentCount++];
    g.id = a["id"] | -1;
    g.name = (const char *)(a["name"] | "");
    g.room = (const char *)(a["room"] | "");
    g.pokemon = (const char *)(a["pokemon"] | "");
    g.color = hexTo565(a["color"] | "#888888");
    const char *st = a["status"] | "idle";
    g.status = strcmp(st, "working") == 0 ? 'w' : strcmp(st, "permission") == 0 ? 'p' : 'i';
  }
  if (page >= pages()) page = pages() - 1;
  return true;
}

void openAgent(const Agent &a) {
  HTTPClient http;
  http.setConnectTimeout(2000);
  http.setTimeout(3000);
  http.begin(baseUrl() + "/device/open");
  http.addHeader("X-Cubicle-Key", cfgKey);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST("{\"id\":" + String(a.id) + "}");
  http.end();
  toastText = code == 200 ? "Abriendo " + a.name : "No se pudo abrir (" + String(code) + ")";
  toastUntil = millis() + 2000;
}

// ── Configuración por el puerto serie ─────────────────────────────
void loadConfig() {
  prefs.begin("cubicle", true);
  cfgHost = prefs.getString("host", "");
  cfgPort = prefs.getUShort("port", 3101);
  cfgKey = prefs.getString("key", "");
  prefs.end();
}

void handleSerial() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.startsWith("CFG ")) {
    JsonDocument doc;
    if (deserializeJson(doc, line.substring(4))) {
      Serial.println("ERR json");
      return;
    }
    prefs.begin("cubicle", false);
    prefs.putString("host", (const char *)(doc["host"] | ""));
    prefs.putUShort("port", doc["port"] | 3101);
    prefs.putString("key", (const char *)(doc["key"] | ""));
    prefs.end();
    loadConfig();
    hostIp = IPAddress(0, 0, 0, 0);
    lastPayload = "";
    Serial.println("OK");
  } else if (line == "INFO") {
    Serial.printf("host=%s port=%u key=%s wifi=%s ip=%s\n", cfgHost.c_str(), cfgPort, cfgKey.length() ? "(guardada)" : "(vacia)",
                  WiFi.status() == WL_CONNECTED ? WiFi.SSID().c_str() : "-", WiFi.localIP().toString().c_str());
  } else if (line == "WIFI_RESET") {
    wm.resetSettings();
    Serial.println("OK");
    ESP.restart();
  }
}

// ── Arranque ──────────────────────────────────────────────────────
void initDisplay() {
  Wire.begin(PIN_SDA, PIN_SCL);
  tca.begin();
  tca.pinMode1(1, OUTPUT);
  tca.write1(1, 1);
  delay(10);
  tca.write1(1, 0);
  delay(10);
  tca.write1(1, 1);
  delay(200);
  gfx->begin();
  gfx->fillScreen(C_BG);
  gfx->flush();
  pinMode(PIN_BL, OUTPUT);
  digitalWrite(PIN_BL, HIGH);
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(200);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  initDisplay();
  loadConfig();

  drawMessage("Cubicle", "Conectando al Wi-Fi...");
  // Portal NO bloqueante: mientras esperas en el móvil, la placa sigue atendiendo el USB.
  wm.setConfigPortalBlocking(false);
  wm.setConfigPortalTimeout(0);
  wm.setAPCallback([](WiFiManager *) {
    portalOpen = true;
    drawMessage("Configura el Wi-Fi", "Desde el movil, conectate a la", "red \"Cubicle-Pantalla\"");
  });
  wm.autoConnect("Cubicle-Pantalla");
}

void loop() {
  handleSerial();
  wm.process();
  if (WiFi.status() == WL_CONNECTED && !mdnsReady) {
    mdnsReady = MDNS.begin("cubicle-pantalla");
    portalOpen = false;
  }
  if (portalOpen) {
    delay(20);
    return;
  }
  if (cfgHost.isEmpty() || cfgKey.isEmpty()) {
    static bool shown = false;
    if (!shown) drawMessage("Falta configurar", "Conecta la pantalla por USB", "y guarda servidor y clave");
    shown = true;
    delay(50);
    return;
  }

  // BOOT 3 s: olvidar el Wi-Fi.
  static uint32_t bootSince = 0;
  if (digitalRead(PIN_BOOT) == LOW) {
    if (!bootSince) bootSince = millis();
    if (millis() - bootSince > 3000) {
      drawMessage("Wi-Fi olvidado", "Reiniciando...");
      wm.resetSettings();
      delay(500);
      ESP.restart();
    }
  } else {
    bootSince = 0;
  }

  static uint32_t lastFetch = 0;
  static bool dirty = true;
  static bool hadError = false;
  if (millis() - lastFetch > 2000) {
    lastFetch = millis();
    bool changed = fetchAgents();
    bool hasError = errorText.length() > 0;
    if (changed || hasError != hadError) dirty = true;
    hadError = hasError;
  }

  // Toque: al soltar sobre una ficha la abre; en la cabecera pasa de página.
  static bool wasDown = false;
  static int downX = 0, downY = 0;
  int x, y;
  bool down = readTouch(x, y);
  if (down && !wasDown) {
    downX = x;
    downY = y;
    pressedIndex = -1;
    if (y >= HEADER_H) {
      for (int slot = 0; slot < PER_PAGE; slot++) {
        int cx, cy, cw, ch;
        cardRect(slot, cx, cy, cw, ch);
        int idx = page * PER_PAGE + slot;
        if (idx < agentCount && x >= cx && x < cx + cw && y >= cy && y < cy + ch) pressedIndex = idx;
      }
      dirty = pressedIndex >= 0;
    }
  } else if (!down && wasDown) {
    if (downY < HEADER_H && pages() > 1) {
      page = (page + 1) % pages();
      dirty = true;
    } else if (pressedIndex >= 0) {
      openAgent(agents[pressedIndex]);
      pressedIndex = -1;
      dirty = true;
    }
  }
  wasDown = down;

  static bool toastShown = false;
  bool toastNow = millis() < toastUntil;
  if (toastNow != toastShown) dirty = true;
  toastShown = toastNow;

  if (dirty) {
    draw();
    dirty = false;
  }
  delay(20);
}
