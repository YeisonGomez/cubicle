/*
 * Cubicle Screen: tus agentes de Cubicle en una Waveshare ESP32-S3-Touch-LCD-3.5B.
 *
 * - Se conecta al Wi-Fi (la primera vez crea la red "Cubicle-Pantalla": conéctate
 *   desde el móvil y elige tu Wi-Fi; la contraseña se queda solo en la placa).
 * - Pide a Cubicle la lista de agentes cada 2 s (GET /device/agents) y los muestra en
 *   una cuadrícula de 4x2 por diapositiva: el Pokémon animado (GET /device/sprite/:id,
 *   ya en RGB565), el nombre, el color de su sala y su estado.
 * - Deslizar a los lados cambia de diapositiva; tocar un agente lo abre en el
 *   computador (POST /device/open).
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
#include <U8g2lib.h>
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
static const uint16_t C_BG = 0x0861;
static const uint16_t C_CARD = 0x18E4;
static const uint16_t C_CARD_HI = 0x2967;
static const uint16_t C_TEXT = 0xFFFF;
static const uint16_t C_MUTED = 0x9CF3;
static const uint16_t C_WORK = 0x4D1F;  // azul: trabajando
static const uint16_t C_NEED = 0xFE60;  // amarillo: te necesita
static const uint16_t C_IDLE = 0x7BEF;  // gris: libre
static const uint16_t C_ERR = 0xF9A6;
static const uint16_t SPRITE_KEY = 0xF81F;  // transparente en los sprites

// Fuentes (U8g2, con tildes y eñes).
#define F_TITLE u8g2_font_helvB12_tf
#define F_NAME u8g2_font_helvB10_tf
#define F_SMALL u8g2_font_helvR08_tf

// ── Configuración guardada ────────────────────────────────────────
Preferences prefs;
WiFiManager wm;
bool portalOpen = false;
bool mdnsReady = false;
String cfgHost;
uint16_t cfgPort = 3101;
String cfgKey;
IPAddress hostIp;

// ── Agentes y sprites ─────────────────────────────────────────────
struct Agent {
  int id;
  String name;
  String room;
  String pokemon;
  int sprite;  // id del Pokémon, -1 si no hay
  uint16_t color;
  char status;  // 'w' trabajando, 'p' te necesita, 'i' libre
};
static const int MAX_AGENTS = 48;
Agent agents[MAX_AGENTS];
int agentCount = 0;

struct Sprite {
  int id = -1;
  uint8_t w = 0, h = 0, n = 0;
  uint16_t delay[16];
  uint32_t total = 0;
  uint16_t *px = nullptr;  // n frames de w*h en PSRAM
  bool failed = false;
};
static const int MAX_SPRITES = 48;
Sprite sprites[MAX_SPRITES];

int page = 0;
String lastPayload;
String errorText;
String toastText;
uint32_t toastUntil = 0;
int pressedIndex = -1;

// Rejilla: 4 columnas x 2 filas por diapositiva.
static const int HEADER_H = 30;
static const int COLS = 4;
static const int ROWS = 2;
static const int PER_PAGE = COLS * ROWS;
static const int GAP = 6;
static const int SCALE = 3;  // sprites de 32 px → 96 px
static const int SWIPE_PX = 50;

// ── Utilidades ────────────────────────────────────────────────────
uint16_t hexTo565(const char *hex) {
  if (!hex || hex[0] != '#' || strlen(hex) < 7) return C_IDLE;
  long v = strtol(hex + 1, nullptr, 16);
  uint8_t r = (v >> 16) & 0xFF, g = (v >> 8) & 0xFF, b = v & 0xFF;
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

uint16_t statusColor(char st) { return st == 'w' ? C_WORK : st == 'p' ? C_NEED : C_IDLE; }
const char *statusLabel(char st) { return st == 'w' ? "Trabajando" : st == 'p' ? "Te necesita" : "Libre"; }
int pages() { return max(1, (agentCount + PER_PAGE - 1) / PER_PAGE); }

int textWidth(const String &s) {
  int16_t x1, y1;
  uint16_t w, h;
  gfx->getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return w;
}

/** Recorta con "…" para que quepa en maxW píxeles (respeta los caracteres UTF-8). */
String fitText(const String &s, int maxW) {
  if (textWidth(s) <= maxW) return s;
  String t = s;
  while (t.length() > 1) {
    int cut = t.length() - 1;
    while (cut > 0 && (uint8_t(t[cut]) & 0xC0) == 0x80) cut--;
    t = t.substring(0, cut);
    t.trim();
    if (textWidth(t + "...") <= maxW) return t + "...";
  }
  return t;
}

void printCentered(const String &s, int cx, int baseline) {
  gfx->setCursor(cx - textWidth(s) / 2, baseline);
  gfx->print(s);
}

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

// ── Red ───────────────────────────────────────────────────────────
bool resolveHost() {
  if (hostIp.fromString(cfgHost)) return true;
  if (hostIp != IPAddress(0, 0, 0, 0)) return true;  // la última que funcionó
  if (cfgHost.endsWith(".local")) {
    IPAddress ip = MDNS.queryHost(cfgHost.substring(0, cfgHost.length() - 6), 2000);
    if (ip == IPAddress(0, 0, 0, 0)) return false;
    hostIp = ip;
    return true;
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
    if (code < 0) hostIp = IPAddress(0, 0, 0, 0);  // volver a resolver (la IP del Mac puede cambiar)
    return false;
  }
  String body = http.getString();
  http.end();
  errorText = "";
  if (body == lastPayload) return false;  // sin cambios
  lastPayload = body;

  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    errorText = "Respuesta no válida";
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
    g.sprite = a["sprite"] | -1;
    g.color = hexTo565(a["color"] | "#888888");
    const char *st = a["status"] | "idle";
    g.status = strcmp(st, "working") == 0 ? 'w' : strcmp(st, "permission") == 0 ? 'p' : 'i';
  }
  if (page >= pages()) page = pages() - 1;
  return true;
}

Sprite *findSprite(int id) {
  for (auto &s : sprites)
    if (s.id == id) return &s;
  return nullptr;
}

/** Descarga un sprite que falte (uno por llamada, para no frenar el táctil). Devuelve si cargó alguno. */
bool loadMissingSprite() {
  // Primero los de la diapositiva visible.
  int order[MAX_AGENTS];
  int k = 0;
  for (int i = page * PER_PAGE; i < min(agentCount, (page + 1) * PER_PAGE); i++) order[k++] = i;
  for (int i = 0; i < agentCount; i++)
    if (i < page * PER_PAGE || i >= (page + 1) * PER_PAGE) order[k++] = i;
  for (int j = 0; j < k; j++) {
    int id = agents[order[j]].sprite;
    if (id < 0 || findSprite(id)) continue;
    Sprite *slot = nullptr;
    for (auto &s : sprites)
      if (s.id < 0) {
        slot = &s;
        break;
      }
    if (!slot) return false;
    slot->id = id;
    HTTPClient http;
    http.setConnectTimeout(2000);
    http.setTimeout(5000);
    http.begin(baseUrl() + "/device/sprite/" + String(id));
    http.addHeader("X-Cubicle-Key", cfgKey);
    int code = http.GET();
    int len = http.getSize();
    if (code != 200 || len < 5 || len > 200000) {
      slot->failed = true;
      http.end();
      return false;
    }
    uint8_t *buf = (uint8_t *)ps_malloc(len);
    if (!buf) {
      slot->failed = true;
      http.end();
      return false;
    }
    WiFiClient *stream = http.getStreamPtr();
    int got = 0;
    uint32_t until = millis() + 5000;
    while (got < len && millis() < until) {
      int r = stream->readBytes(buf + got, len - got);
      if (r <= 0) delay(5);
      got += max(r, 0);
    }
    http.end();
    if (got != len || buf[0] != 'C' || buf[1] != 'S') {
      free(buf);
      slot->failed = true;
      return false;
    }
    slot->w = buf[2];
    slot->h = buf[3];
    slot->n = min<int>(buf[4], 16);
    size_t frame = (size_t)slot->w * slot->h;
    slot->px = (uint16_t *)ps_malloc(frame * 2 * slot->n);
    slot->total = 0;
    size_t o = 5;
    for (int f = 0; f < slot->n; f++) {
      slot->delay[f] = buf[o] | (buf[o + 1] << 8);
      slot->total += slot->delay[f];
      memcpy(slot->px + frame * f, buf + o + 2, frame * 2);
      o += 2 + frame * 2;
    }
    free(buf);
    return true;
  }
  return false;
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

// ── Dibujo ────────────────────────────────────────────────────────
void cellRect(int slot, int &x, int &y, int &w, int &h) {
  int col = slot % COLS, row = slot / COLS;
  w = (W - GAP * (COLS + 1)) / COLS;
  h = (H - HEADER_H - GAP * (ROWS + 1)) / ROWS;
  x = GAP + col * (w + GAP);
  y = HEADER_H + GAP + row * (h + GAP);
}

void drawSprite(const Sprite &s, int cx, int bottom) {
  if (!s.px || !s.n) return;
  uint32_t t = s.total ? millis() % s.total : 0;
  int f = 0;
  while (f < s.n - 1 && t >= s.delay[f]) t -= s.delay[f++];
  const uint16_t *p = s.px + (size_t)s.w * s.h * f;
  int x0 = cx - s.w * SCALE / 2;
  int y0 = bottom - s.h * SCALE;
  for (int y = 0; y < s.h; y++)
    for (int x = 0; x < s.w; x++) {
      uint16_t c = p[y * s.w + x];
      if (c != SPRITE_KEY) gfx->fillRect(x0 + x * SCALE, y0 + y * SCALE, SCALE, SCALE, c);
    }
}

void drawMessage(const char *title, const String &line1, const String &line2 = "") {
  gfx->fillScreen(C_BG);
  gfx->setFont(F_TITLE);
  gfx->setTextColor(C_TEXT);
  gfx->setCursor(24, 110);
  gfx->print(title);
  gfx->setFont(F_NAME);
  gfx->setTextColor(C_MUTED);
  gfx->setCursor(24, 160);
  gfx->print(line1);
  gfx->setCursor(24, 186);
  gfx->print(line2);
  gfx->flush();
}

void draw() {
  gfx->fillScreen(C_BG);

  // Cabecera: nombre, recuento y puntos de diapositiva.
  int working = 0, needs = 0;
  for (int i = 0; i < agentCount; i++) {
    if (agents[i].status == 'w') working++;
    if (agents[i].status == 'p') needs++;
  }
  if (errorText.length()) {
    gfx->fillRect(0, 0, W, HEADER_H, C_ERR);
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_TEXT);
    gfx->setCursor(10, 20);
    gfx->print(errorText);
  } else {
    gfx->setFont(F_TITLE);
    gfx->setTextColor(C_TEXT);
    gfx->setCursor(10, 21);
    gfx->print("Cubicle");
    gfx->setFont(F_SMALL);
    gfx->setTextColor(C_WORK);
    gfx->setCursor(100, 20);
    gfx->printf("%d trabajando", working);
    if (needs > 0) {
      gfx->setTextColor(C_NEED);
      gfx->setCursor(190, 20);
      gfx->printf("%d te necesita%s", needs, needs > 1 ? "n" : "");
    }
  }
  if (pages() > 1) {
    int dots = pages();
    int x = W - 12 - (dots - 1) * 14;
    for (int i = 0; i < dots; i++) {
      if (i == page) gfx->fillCircle(x + i * 14, 15, 4, C_TEXT);
      else gfx->drawCircle(x + i * 14, 15, 4, C_MUTED);
    }
  }

  // Cuadrícula de la diapositiva.
  int start = page * PER_PAGE;
  for (int slot = 0; slot < PER_PAGE && start + slot < agentCount; slot++) {
    const Agent &a = agents[start + slot];
    int x, y, w, h;
    cellRect(slot, x, y, w, h);
    uint16_t sc = statusColor(a.status);
    bool pressed = (start + slot) == pressedIndex;
    gfx->fillRoundRect(x, y, w, h, 8, pressed ? C_CARD_HI : C_CARD);
    gfx->fillRoundRect(x, y, w, 5, 2, a.color);  // color de la sala
    if (a.status != 'i') {
      gfx->drawRoundRect(x, y, w, h, 8, sc);
      gfx->drawRoundRect(x + 1, y + 1, w - 2, h - 2, 7, sc);
    }
    int cx = x + w / 2;
    Sprite *s = a.sprite >= 0 ? findSprite(a.sprite) : nullptr;
    if (s && s->px) {
      drawSprite(*s, cx, y + 102);
    } else {
      // Sin Pokémon (o aún cargando): la inicial en un círculo del color de la sala.
      gfx->fillCircle(cx, y + 56, 30, a.color);
      gfx->setFont(F_TITLE);
      gfx->setTextColor(C_BG);
      printCentered(a.name.substring(0, 1), cx, y + 63);
    }
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_TEXT);
    printCentered(fitText(a.name, w - 10), cx, y + 120);
    gfx->setFont(F_SMALL);
    gfx->setTextColor(sc);
    String label = statusLabel(a.status);
    int lw = textWidth(label) + 12;
    gfx->fillCircle(cx - lw / 2 + 3, y + 131, 3, sc);
    gfx->setCursor(cx - lw / 2 + 12, y + 135);
    gfx->print(label);
  }
  if (agentCount == 0 && !errorText.length()) {
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_MUTED);
    printCentered("Sin agentes en la oficina", W / 2, H / 2);
  }

  // Aviso temporal (p. ej. "Abriendo X").
  if (millis() < toastUntil) {
    gfx->fillRoundRect(60, H - 50, W - 120, 38, 10, C_TEXT);
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_BG);
    printCentered(fitText(toastText, W - 140), W / 2, H - 26);
  }
  gfx->flush();
}

/** ¿Hay sprites animados en la diapositiva visible? */
bool pageAnimates() {
  for (int i = page * PER_PAGE; i < min(agentCount, (page + 1) * PER_PAGE); i++) {
    Sprite *s = agents[i].sprite >= 0 ? findSprite(agents[i].sprite) : nullptr;
    if (s && s->n > 1) return true;
  }
  return false;
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
    Serial.printf("host=%s port=%u key=%s wifi=%s ip=%s agents=%d\n", cfgHost.c_str(), cfgPort, cfgKey.length() ? "(guardada)" : "(vacia)",
                  WiFi.status() == WL_CONNECTED ? WiFi.SSID().c_str() : "-", WiFi.localIP().toString().c_str(), agentCount);
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
  gfx->setUTF8Print(true);
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
    drawMessage("Configura el Wi-Fi", "Desde el móvil, conéctate a la", "red \"Cubicle-Pantalla\"");
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
  static bool touching = false;
  if (!touching && millis() - lastFetch > 2000) {
    lastFetch = millis();
    bool changed = fetchAgents();
    bool hasError = errorText.length() > 0;
    if (changed || hasError != hadError) dirty = true;
    hadError = hasError;
  } else if (!touching && errorText.isEmpty() && loadMissingSprite()) {
    dirty = true;
  }

  // Toque: deslizar a los lados cambia de diapositiva; tocar y soltar sobre una ficha la abre.
  static int downX = 0, downY = 0, lastX = 0;
  int x, y;
  bool down = readTouch(x, y);
  if (down && !touching) {
    downX = x;
    downY = y;
    pressedIndex = -1;
    for (int slot = 0; slot < PER_PAGE; slot++) {
      int cx, cy, cw, ch;
      cellRect(slot, cx, cy, cw, ch);
      int idx = page * PER_PAGE + slot;
      if (idx < agentCount && x >= cx && x < cx + cw && y >= cy && y < cy + ch) pressedIndex = idx;
    }
    dirty = true;
  }
  if (down) {
    lastX = x;
    if (abs(x - downX) > SWIPE_PX && pressedIndex >= 0) {
      pressedIndex = -1;  // es un deslizamiento, no un toque
      dirty = true;
    }
  } else if (touching) {
    int dx = lastX - downX;
    if (abs(dx) > SWIPE_PX && pages() > 1) {
      page = (page + (dx < 0 ? 1 : pages() - 1)) % pages();
    } else if (pressedIndex >= 0) {
      openAgent(agents[pressedIndex]);
    }
    pressedIndex = -1;
    dirty = true;
  }
  touching = down;

  static bool toastShown = false;
  bool toastNow = millis() < toastUntil;
  if (toastNow != toastShown) dirty = true;
  toastShown = toastNow;

  // Animación de los Pokémon: ~10 fps.
  static uint32_t lastAnim = 0;
  if (pageAnimates() && millis() - lastAnim > 100) {
    lastAnim = millis();
    dirty = true;
  }

  if (dirty) {
    draw();
    dirty = false;
  }
  delay(10);
}
