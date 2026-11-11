/*
 * Cubicle Screen: un avisador de tus agentes de Cubicle en una Waveshare
 * ESP32-S3-Touch-LCD-3.5B, por Wi-Fi.
 *
 * Vistas:
 * - ACTIVOS (por defecto si hay alguno): solo los agentes que te necesitan (primero,
 *   del que más lleva esperando al que menos) y los que están trabajando, en grande,
 *   con su Pokémon animado y cuánto llevan en ese estado.
 * - TODOS: cuadrícula 4x2 por diapositiva, agrupada por sala y ordenada por uso (orden
 *   del servidor). Se alterna con ACTIVOS tocando la cabecera.
 * - REPOSO: tras 5 min sin agentes activos ni toques: reloj, prompts de hoy y consumo
 *   de la semana y de Fable, con la luz atenuada. Un toque vuelve a TODOS.
 * - AVISO: cuando un agente termina o pide permiso, pantalla completa unos segundos con
 *   su Pokémon y un borde que parpadea. Tocarlo abre el agente.
 *
 * Tocar un agente lo abre en el computador (POST /device/open). Las franjas de los lados
 * (o deslizar) cambian de diapositiva. BOOT: toque corto gira la pantalla, 3 s borra el
 * Wi-Fi. La primera vez crea la red "Cubicle-Pantalla" para elegir tu Wi-Fi.
 *
 * Servidor, puerto y clave se guardan por el puerto serie (ver README.md):
 *   CFG {"host":"mi-mac.local","ip":"192.168.1.10","port":3101,"key":"..."}
 *
 * Pantalla: controlador AXS15231B por QSPI (320x480) y táctil del mismo chip por I2C
 * (0x3B). El reset de la pantalla va por el expansor TCA9554 (0x20, pin 1).
 */
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <Arduino_GFX_Library.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <TCA9554.h>
#include <U8g2lib.h>
#include <WebServer.h>
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
static const uint16_t C_WORK = 0x4D1F;    // azul: trabajando
static const uint16_t C_NEED = 0xFE60;    // amarillo: te necesita
static const uint16_t C_IDLE = 0x7BEF;    // gris: libre
static const uint16_t C_ERR = 0xF9A6;
static const uint16_t C_SEL = 0x7B5E;     // morado: agente seleccionado en la oficina
static const uint16_t C_SEL_BG = 0x292C;  // su fondo
static const uint16_t C_XP = 0x3D9F;      // barras de consumo
static const uint16_t SPRITE_KEY = 0xF81F;  // transparente en los sprites

// Fuentes (U8g2, con tildes y eñes).
#define F_CLOCK u8g2_font_logisoso62_tn
#define F_BIG u8g2_font_helvB18_tf
#define F_TITLE u8g2_font_helvB12_tf
#define F_NAME u8g2_font_helvB10_tf
#define F_SMALL u8g2_font_helvR08_tf

// Textos en el idioma de la oficina (lo manda el servidor en /device/summary).
bool langEn = true;
#define T(es, en) (langEn ? (en) : (es))

// ── Configuración guardada ────────────────────────────────────────
Preferences prefs;
WiFiManager wm;
WebServer web(80);  // diagnóstico: GET /info, /rotate y /shot
bool netReady = false;
bool pendingRedraw = false;  // pedido desde fuera del bucle (p. ej. /rotate)
bool portalOpen = false;
bool mdnsReady = false;
String cfgHost;
uint16_t cfgPort = 3101;
String cfgKey;
String cfgIp;  // IP del Mac al configurar: respaldo si el nombre .local no responde
IPAddress hostIp;

// ── Agentes y sprites ─────────────────────────────────────────────
struct Agent {
  int id;
  String name;
  String room;
  String pokemon;
  int sprite;  // id del Pokémon, -1 si no hay
  uint16_t color;
  bool selected;   // seleccionado en la oficina
  uint32_t since;  // epoch (s) desde que está en su estado
  char status;     // 'w' trabajando, 'p' pide permiso, 'q' te necesita (sin mirar), 'i' libre
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

String lastPayload;
String errorText;
String toastText;
uint32_t toastUntil = 0;
int pressedIndex = -1;  // índice en agents[] de la ficha pulsada

// ── Resumen (reposo) y reloj ──────────────────────────────────────
uint32_t baseEpoch = 0;  // hora local (epoch + zona) en el momento baseMillis
uint32_t baseMillis = 0;
uint32_t serverEpoch = 0;  // epoch UTC del servidor, para "hace cuánto"
String sumDate;
int sumPrompts = 0;
int sumWeek = -1;   // % consumido de la semana; -1 = sin dato
int sumFable = -1;  // % consumido de Fable; -1 = sin dato
bool haveSummary = false;

uint32_t nowUtc() { return serverEpoch ? serverEpoch + (millis() - baseMillis) / 1000 : 0; }
uint32_t nowLocal() { return baseEpoch ? baseEpoch + (millis() - baseMillis) / 1000 : 0; }

// ── Vistas ────────────────────────────────────────────────────────
enum Mode { MODE_FOCUS, MODE_GRID, MODE_REST };
Mode mode = MODE_GRID;
bool userAll = false;         // con agentes activos, el usuario pidió ver TODOS
uint32_t lastActivityMs = 0;  // último toque o último momento con agentes activos
static const uint32_t REST_AFTER_MS = 5UL * 60UL * 1000UL;
static const int BL_FULL = 255;
static const int BL_REST = 40;
uint32_t previewRestUntil = 0;  // GET /preview?v=rest: enseña el reposo unos segundos (diagnóstico)

// Lo que se muestra: índices de agents[] y sus diapositivas [first, last) sobre view[].
int view[MAX_AGENTS];
int viewCount = 0;
int pageFirst[MAX_AGENTS], pageLast[MAX_AGENTS];
int pageCount = 1;
int page = 0;
int vCols = 4, vRows = 2, vScale = 3;

static const int HEADER_H = 30;
static const int GAP = 5;
static const int SIDE_W = 40;    // franjas laterales para cambiar de diapositiva (el táctil es impreciso)
static const int FOOTER_H = 14;  // puntos de diapositiva
static const int SWIPE_PX = 50;

// Animación al cambiar de diapositiva: la nueva entra deslizándose desde el lado.
static const uint32_t SLIDE_MS = 220;
uint32_t slideStart = 0;
int slideDir = 0;  // 1 = viene de la derecha, -1 = de la izquierda
int slideDx = 0;

// Aviso a pantalla completa: un agente terminó ('f') o pide permiso ('p').
static const uint32_t ALERT_MS = 5000;
static const uint32_t ALERT_BLINK_MS = 2000;
int alertAgentId = -1;
char alertKind = 0;
uint32_t alertStart = 0;
int prevIds[MAX_AGENTS];
char prevSt[MAX_AGENTS];
int prevN = -1;  // -1 = aún sin primera carga (no se avisa de lo que ya estaba)

// ── Orientación: 1 = horizontal normal, 3 = horizontal al revés ─────
// A mano (toque corto en BOOT o GET /rotate) se guarda y es la que vale con la pantalla
// tumbada; el acelerómetro (QMI8658 por I2C) solo la cambia si está claramente de pie.
int rotation = 1;
bool rotationManual = false;
uint8_t imuAddr = 0;  // 0 = sin sensor
static const int IMU_AXIS = 1;  // 0 = x, 1 = y (calibrado sobre la placa real)
static const int IMU_SIGN_UPRIGHT = -1;
static const int16_t IMU_THRESHOLD = 6000;  // ~0,37 g: por debajo, tumbada o dudosa → la guardada

// ── Utilidades ────────────────────────────────────────────────────
uint16_t hexTo565(const char *hex) {
  if (!hex || hex[0] != '#' || strlen(hex) < 7) return C_IDLE;
  long v = strtol(hex + 1, nullptr, 16);
  uint8_t r = (v >> 16) & 0xFF, g = (v >> 8) & 0xFF, b = v & 0xFF;
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

bool isActive(char st) { return st == 'w' || st == 'p' || st == 'q'; }
bool needsYou(char st) { return st == 'p' || st == 'q'; }
uint16_t statusColor(char st) { return st == 'w' ? C_WORK : needsYou(st) ? C_NEED : C_IDLE; }
const char *statusLabel(char st) {
  return st == 'w' ? T("Trabajando", "Working") : st == 'p' ? T("Pide permiso", "Needs permission") : st == 'q' ? T("Te necesita", "Needs you") : T("Libre", "Idle");
}

/** "<1 min", "12 min", "1 h 05": cuánto lleva el agente en su estado ("" sin hora). */
String elapsed(uint32_t since) {
  uint32_t now = nowUtc();
  if (!now || !since || now < since) return "";
  uint32_t m = (now - since) / 60;
  if (m < 1) return "<1 min";
  if (m < 60) return String(m) + " min";
  char buf[16];
  snprintf(buf, sizeof(buf), "%lu h %02lu", (unsigned long)(m / 60), (unsigned long)(m % 60));
  return buf;
}

int textWidth(const String &s) {
  int16_t x1, y1;
  uint16_t w, h;
  gfx->getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return w;
}

/** Recorta con "..." para que quepa en maxW píxeles (respeta los caracteres UTF-8). */
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

int activeCount() {
  int n = 0;
  for (int i = 0; i < agentCount; i++)
    if (isActive(agents[i].status)) n++;
  return n;
}

Agent *agentById(int id) {
  for (int i = 0; i < agentCount; i++)
    if (agents[i].id == id) return &agents[i];
  return nullptr;
}

// ── Vista y diapositivas ──────────────────────────────────────────
int pages() { return pageCount; }
int perPage() { return vCols * vRows; }

void goToPage(int p, int dir) {
  if (p == page || p < 0 || p >= pages()) return;
  page = p;
  slideDir = dir;
  slideStart = millis();
}

/** Orden de ACTIVOS: primero quien te necesita, y dentro de cada grupo quien más lleva. */
bool focusBefore(int a, int b) {
  bool na = needsYou(agents[a].status), nb = needsYou(agents[b].status);
  if (na != nb) return na;
  return agents[a].since < agents[b].since;
}

/** Recalcula modo, lista visible y diapositivas. Devuelve si cambió el modo. */
bool rebuildView() {
  Mode before = mode;
  int active = activeCount();
  if (active > 0) {
    lastActivityMs = millis();
    mode = userAll ? MODE_GRID : MODE_FOCUS;
  } else {
    userAll = false;
    mode = millis() - lastActivityMs > REST_AFTER_MS ? MODE_REST : MODE_GRID;
  }
  if (millis() < previewRestUntil) mode = MODE_REST;

  viewCount = 0;
  pageCount = 0;
  if (mode == MODE_FOCUS) {
    for (int i = 0; i < agentCount; i++)
      if (isActive(agents[i].status)) {
        int j = viewCount++;
        while (j > 0 && focusBefore(i, view[j - 1])) {
          view[j] = view[j - 1];
          j--;
        }
        view[j] = i;
      }
    // Pocos: fichas grandes en una fila (1-2 → Pokémon a 5x; 3 → a 4x). Más: 3x2 por diapositiva.
    vCols = viewCount <= 2 ? 2 : 3;
    vRows = viewCount <= 3 ? 1 : 2;
    vScale = vRows == 2 ? 3 : viewCount <= 2 ? 5 : 4;
    for (int i = 0; i < viewCount; i += perPage()) {
      pageFirst[pageCount] = i;
      pageLast[pageCount] = min(viewCount, i + perPage());
      pageCount++;
    }
  } else {
    for (int i = 0; i < agentCount; i++) view[viewCount++] = i;
    vCols = 4;
    vRows = 2;
    vScale = 3;
    // Los agentes de una sala (consecutivos) no se parten entre diapositivas si caben en una.
    int i = 0;
    while (i < viewCount) {
      int j = i;
      while (j < viewCount && agents[j].room == agents[i].room) j++;
      int used = pageCount ? pageLast[pageCount - 1] - pageFirst[pageCount - 1] : perPage();
      if (used + (j - i) > perPage() && !(used < perPage() && (j - i) > perPage())) {
        pageFirst[pageCount] = i;
        pageLast[pageCount] = i;
        pageCount++;
      }
      for (int k = i; k < j; k++) {
        if (pageLast[pageCount - 1] - pageFirst[pageCount - 1] >= perPage()) {
          pageFirst[pageCount] = k;
          pageLast[pageCount] = k;
          pageCount++;
        }
        pageLast[pageCount - 1] = k + 1;
      }
      i = j;
    }
  }
  if (pageCount == 0) {
    pageFirst[0] = pageLast[0] = 0;
    pageCount = 1;
  }
  if (mode != before) {
    page = 0;
    slideDir = 0;
    slideDx = 0;
    analogWrite(PIN_BL, mode == MODE_REST ? BL_REST : BL_FULL);
  }
  if (page >= pageCount) page = pageCount - 1;
  return mode != before;
}

/** Diapositiva del agente seleccionado en la oficina dentro de la vista, o -1. */
int selectedPage() {
  for (int pg = 0; pg < pages(); pg++)
    for (int i = pageFirst[pg]; i < pageLast[pg]; i++)
      if (agents[view[i]].selected) return pg;
  return -1;
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
  // Panel vertical (320x480) girado a horizontal.
  if (rotation == 1) {
    x = ry;
    y = 319 - rx;
  } else {
    x = 479 - ry;
    y = rx;
  }
  return true;
}

// ── Acelerómetro QMI8658 ─────────────────────────────────────────
bool imuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(imuAddr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool imuRead(uint8_t reg, uint8_t *buf, uint8_t len) {
  Wire.beginTransmission(imuAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(imuAddr, len) != len) return false;
  Wire.readBytes(buf, len);
  return true;
}

void initImu() {
  for (uint8_t addr : {0x6B, 0x6A}) {
    imuAddr = addr;
    uint8_t who = 0;
    if (imuRead(0x00, &who, 1) && who == 0x05) {
      imuWrite(0x02, 0x40);  // CTRL1: direcciones con autoincremento
      imuWrite(0x03, 0x05);  // CTRL2: acelerómetro ±2 g, frecuencia baja
      imuWrite(0x08, 0x01);  // CTRL7: acelerómetro encendido
      return;
    }
  }
  imuAddr = 0;
}

bool readAccel(int16_t &ax, int16_t &ay, int16_t &az) {
  uint8_t d[6];
  if (!imuAddr || !imuRead(0x35, d, 6)) return false;
  ax = (int16_t)(d[0] | (d[1] << 8));
  ay = (int16_t)(d[2] | (d[3] << 8));
  az = (int16_t)(d[4] | (d[5] << 8));
  return true;
}

/** Rotación que pide la gravedad, o 0 si la pantalla está plana o en duda. */
int rotationFromImu() {
  int16_t a[3];
  if (!readAccel(a[0], a[1], a[2])) return 0;
  int16_t v = a[IMU_AXIS];
  if (abs(v) < IMU_THRESHOLD) return 0;
  return (v > 0) == (IMU_SIGN_UPRIGHT > 0) ? 1 : 3;
}

void applyRotation(int r) {
  rotation = r;
  gfx->setRotation(r);
}

/** Giro elegido a mano: se aplica y se guarda. */
void setManualRotation(int r) {
  rotationManual = true;
  applyRotation(r);
  prefs.begin("cubicle", false);
  prefs.putUChar("rot", r);
  prefs.end();
}

// ── Red ───────────────────────────────────────────────────────────
/**
 * Dirección del Mac: la última que funcionó; si no hay, su nombre .local (mDNS) y, si
 * no responde (pasa con algunos routers), la IP guardada al configurar.
 */
bool resolveHost() {
  if (hostIp != IPAddress(0, 0, 0, 0)) return true;
  if (hostIp.fromString(cfgHost)) return true;
  if (cfgHost.endsWith(".local")) {
    IPAddress ip = MDNS.queryHost(cfgHost.substring(0, cfgHost.length() - 6), 1500);
    if (ip != IPAddress(0, 0, 0, 0)) {
      hostIp = ip;
      return true;
    }
  } else if (WiFi.hostByName(cfgHost.c_str(), hostIp) == 1) {
    return true;
  }
  return cfgIp.length() && hostIp.fromString(cfgIp);
}

String baseUrl() { return "http://" + hostIp.toString() + ":" + String(cfgPort); }

/** Avisa si un agente acaba de terminar o de pedir permiso (comparando con la carga anterior). */
void detectAlerts() {
  if (prevN >= 0) {
    for (int i = 0; i < agentCount; i++) {
      char was = 0;
      for (int j = 0; j < prevN; j++)
        if (prevIds[j] == agents[i].id) was = prevSt[j];
      char now = agents[i].status;
      char kind = 0;
      if (now == 'p' && was != 'p') kind = 'p';
      else if (was == 'w' && (now == 'i' || now == 'q')) kind = 'f';
      if (kind) {
        alertAgentId = agents[i].id;
        alertKind = kind;
        alertStart = millis();
        lastActivityMs = millis();
      }
    }
  }
  prevN = agentCount;
  for (int i = 0; i < agentCount; i++) {
    prevIds[i] = agents[i].id;
    prevSt[i] = agents[i].status;
  }
}

bool fetchAgents() {
  if (WiFi.status() != WL_CONNECTED) {
    errorText = T("Sin Wi-Fi", "No Wi-Fi");
    return false;
  }
  if (!resolveHost()) {
    errorText = String(T("No encuentro ", "Can't find ")) + cfgHost;
    return false;
  }
  HTTPClient http;
  http.setConnectTimeout(2000);
  http.setTimeout(3000);
  http.begin(baseUrl() + "/device/agents");
  http.addHeader("X-Cubicle-Key", cfgKey);
  int code = http.GET();
  if (code != 200) {
    errorText = code == 401 ? T("Clave incorrecta", "Wrong key") : code < 0 ? T("Cubicle no responde", "Cubicle is not responding") : "Error " + String(code);
    http.end();
    // Tras varios fallos seguidos se vuelve a buscar el Mac (su IP puede haber cambiado).
    static int fails = 0;
    if (code < 0 && ++fails >= 3) {
      fails = 0;
      hostIp = IPAddress(0, 0, 0, 0);
    }
    return false;
  }
  String body = http.getString();
  http.end();
  errorText = "";
  if (body == lastPayload) return false;  // sin cambios
  lastPayload = body;

  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    errorText = T("Respuesta no válida", "Invalid response");
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
    g.selected = a["selected"] | false;
    g.since = a["since"] | 0;
    const char *st = a["status"] | "idle";
    g.status = strcmp(st, "working") == 0 ? 'w' : strcmp(st, "permission") == 0 ? 'p' : strcmp(st, "question") == 0 ? 'q' : 'i';
  }
  detectAlerts();
  return true;
}

/** Hora, idioma, prompts de hoy y consumo (para el reposo y los "hace cuánto"). */
bool fetchSummary() {
  if (WiFi.status() != WL_CONNECTED || !resolveHost()) return false;
  HTTPClient http;
  http.setConnectTimeout(2000);
  http.setTimeout(3000);
  http.begin(baseUrl() + "/device/summary");
  http.addHeader("X-Cubicle-Key", cfgKey);
  int code = http.GET();
  if (code != 200) {
    http.end();
    return false;
  }
  String body = http.getString();
  http.end();
  JsonDocument doc;
  if (deserializeJson(doc, body)) return false;
  serverEpoch = doc["epoch"] | 0;
  baseEpoch = serverEpoch + (long)(doc["tz"] | 0);
  baseMillis = millis();
  sumDate = (const char *)(doc["date"] | "");
  langEn = strcmp(doc["lang"] | "en", "es") != 0;
  sumPrompts = doc["promptsToday"] | 0;
  sumWeek = doc["week"].is<float>() ? (int)round(doc["week"].as<float>()) : -1;
  sumFable = doc["fable"].is<float>() ? (int)round(doc["fable"].as<float>()) : -1;
  haveSummary = true;
  return true;
}

Sprite *findSprite(int id) {
  for (auto &s : sprites)
    if (s.id == id) return &s;
  return nullptr;
}

/** Descarga un sprite que falte (uno por llamada, para no frenar el táctil). Devuelve si cargó alguno. */
bool loadMissingSprite() {
  // Primero los de la diapositiva visible; después, el resto.
  int order[MAX_AGENTS * 2];
  int k = 0;
  if (mode != MODE_REST)
    for (int i = pageFirst[page]; i < pageLast[page]; i++) order[k++] = view[i];
  for (int i = 0; i < agentCount; i++) order[k++] = i;
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
  // Sin aviso al abrir (el agente se abre en el computador); solo si falla.
  if (code != 200) {
    toastText = String(T("No se pudo abrir (", "Could not open (")) + String(code) + ")";
    toastUntil = millis() + 2000;
  }
}

// ── Dibujo ────────────────────────────────────────────────────────
/** Rectángulo de la ficha `slot` de la diapositiva actual (centrada si hay una sola fila sin llenar). */
void cellRect(int slot, int &x, int &y, int &w, int &h) {
  int col = slot % vCols, row = slot / vCols;
  w = (W - 2 * SIDE_W - GAP * (vCols + 1)) / vCols;
  h = (H - HEADER_H - FOOTER_H - GAP * (vRows + 1)) / vRows;
  int onPage = pageLast[page] - pageFirst[page];
  int offset = vRows == 1 && onPage < vCols ? (vCols - onPage) * (w + GAP) / 2 : 0;
  x = SIDE_W + GAP + col * (w + GAP) + offset + slideDx;
  y = HEADER_H + GAP + row * (h + GAP);
}

void drawSprite(const Sprite &s, int cx, int bottom, int scale) {
  if (!s.px || !s.n) return;
  uint32_t t = s.total ? millis() % s.total : 0;
  int f = 0;
  while (f < s.n - 1 && t >= s.delay[f]) t -= s.delay[f++];
  const uint16_t *p = s.px + (size_t)s.w * s.h * f;
  int x0 = cx - s.w * scale / 2;
  int y0 = bottom - s.h * scale;
  for (int y = 0; y < s.h; y++)
    for (int x = 0; x < s.w; x++) {
      uint16_t c = p[y * s.w + x];
      if (c != SPRITE_KEY) gfx->fillRect(x0 + x * scale, y0 + y * scale, scale, scale, c);
    }
}

/** Pokémon del agente o, si no hay (o aún carga), su inicial en un círculo del color de la sala. */
void drawAvatar(const Agent &a, int cx, int bottom, int scale) {
  Sprite *s = a.sprite >= 0 ? findSprite(a.sprite) : nullptr;
  if (s && s->px) {
    drawSprite(*s, cx, bottom, scale);
    return;
  }
  int r = 10 * scale;
  gfx->fillCircle(cx, bottom - 14 * scale, r, a.color);
  gfx->setFont(scale >= 4 ? F_BIG : F_TITLE);
  gfx->setTextColor(C_BG);
  printCentered(a.name.substring(0, 1), cx, bottom - 14 * scale + (scale >= 4 ? 9 : 6));
}

/** Flecha de línea tipo "<" o ">" (dir -1 o 1), de 3 px de grosor, centrada en (cx, cy). */
void drawChevron(int cx, int cy, int dir) {
  const int half = 12, depth = 7;
  for (int t = -1; t <= 1; t++) {
    gfx->drawLine(cx - dir * depth + t, cy - half, cx + dir * depth + t, cy, C_MUTED);
    gfx->drawLine(cx + dir * depth + t, cy, cx - dir * depth + t, cy + half, C_MUTED);
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

/** Botón de la cabecera (derecha) para alternar ACTIVOS / TODOS. Devuelve su ancho. */
int drawToggle() {
  if (activeCount() == 0) return 0;
  gfx->setFont(F_SMALL);
  String label = mode == MODE_FOCUS ? T("Ver todos", "Show all") : T("Ver activos", "Show active");
  int tw = textWidth(label);
  int bw = tw + 20;
  gfx->fillRoundRect(W - 8 - bw, 4, bw, 22, 11, C_CARD_HI);
  gfx->setTextColor(C_TEXT);
  gfx->setCursor(W - 8 - bw + 10, 19);
  gfx->print(label);
  return bw + 12;
}

void drawHeader() {
  if (errorText.length()) {
    gfx->fillRect(0, 0, W, HEADER_H, C_ERR);
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_TEXT);
    gfx->setCursor(10, 20);
    gfx->print(errorText);
    return;
  }
  int rightW = drawToggle();
  gfx->setFont(F_NAME);
  int hx = 10;
  if (mode == MODE_FOCUS) {
    int working = 0, needs = 0;
    for (int i = 0; i < agentCount; i++) {
      if (agents[i].status == 'w') working++;
      if (needsYou(agents[i].status)) needs++;
    }
    if (needs > 0) {
      String s = String(needs) + " " + (needs > 1 ? T("te necesitan", "need you") : T("te necesita", "needs you"));
      gfx->fillCircle(hx + 4, 15, 4, C_NEED);
      gfx->setTextColor(C_NEED);
      gfx->setCursor(hx + 13, 20);
      gfx->print(s);
      hx += 13 + textWidth(s) + 16;
    }
    if (working > 0) {
      String s = String(working) + " " + T("trabajando", "working");
      gfx->fillCircle(hx + 4, 15, 4, C_WORK);
      gfx->setTextColor(C_WORK);
      gfx->setCursor(hx + 13, 20);
      gfx->print(s);
    }
    return;
  }
  // TODOS: las salas de esta diapositiva, cada una con su color.
  for (int i = pageFirst[page]; i < pageLast[page]; i++) {
    const Agent &a = agents[view[i]];
    if (i > pageFirst[page] && a.room == agents[view[i - 1]].room) continue;
    int tw = textWidth(a.room);
    if (hx + 14 + tw > W - 12 - rightW) break;
    gfx->fillCircle(hx + 4, 15, 4, a.color);
    gfx->setTextColor(C_TEXT);
    gfx->setCursor(hx + 13, 20);
    gfx->print(a.room);
    hx += 13 + tw + 14;
  }
}

void drawCard(int slot, int idx) {
  const Agent &a = agents[idx];
  int x, y, w, h;
  cellRect(slot, x, y, w, h);
  uint16_t sc = statusColor(a.status);
  bool pressed = idx == pressedIndex;
  bool big = vRows == 1;
  gfx->fillRoundRect(x, y, w, h, 8, pressed ? C_CARD_HI : a.selected ? C_SEL_BG : C_CARD);
  // Color de la sala: franja por DENTRO del borde de estado, sin taparlo.
  gfx->fillRoundRect(x + 6, y + 4, w - 12, 4, 2, a.color);
  // Borde: morado si es el seleccionado en la oficina; si no, el color del estado (libre sin borde).
  if (a.selected || a.status != 'i') {
    uint16_t bc = a.selected ? C_SEL : sc;
    gfx->drawRoundRect(x, y, w, h, 8, bc);
    gfx->drawRoundRect(x + 1, y + 1, w - 2, h - 2, 7, bc);
  }
  int cx = x + w / 2;
  String label = statusLabel(a.status);
  String time = mode == MODE_FOCUS ? elapsed(a.since) : "";
  if (big) {
    int sb = y + 14 + 32 * vScale;  // base del Pokémon
    drawAvatar(a, cx, sb, vScale);
    gfx->setFont(vScale >= 5 ? F_BIG : F_TITLE);
    gfx->setTextColor(C_TEXT);
    printCentered(fitText(a.name, w - 10), cx, sb + 30);
    gfx->setFont(F_NAME);
    gfx->setTextColor(sc);
    int lw = textWidth(label) + 12;
    gfx->fillCircle(cx - lw / 2 + 3, sb + 47, 4, sc);
    gfx->setCursor(cx - lw / 2 + 12, sb + 52);
    gfx->print(label);
    if (time.length()) {
      gfx->setFont(F_TITLE);
      gfx->setTextColor(C_MUTED);
      printCentered(time, cx, sb + 76);
    }
    return;
  }
  drawAvatar(a, cx, y + 96, vScale);
  gfx->setFont(F_NAME);
  gfx->setTextColor(C_TEXT);
  printCentered(fitText(a.name, w - 8), cx, y + h - 20);
  gfx->setFont(F_SMALL);
  gfx->setTextColor(sc);
  if (time.length() && textWidth(label + " · " + time) + 12 <= w - 8) label += " · " + time;
  int lw = textWidth(label) + 12;
  gfx->fillCircle(cx - lw / 2 + 3, y + h - 10, 3, sc);
  gfx->setCursor(cx - lw / 2 + 12, y + h - 6);
  gfx->print(label);
}

/** Barra de consumo con su título y porcentaje. */
void drawMeter(int x, int y, int w, const char *title, int pct) {
  gfx->setFont(F_NAME);
  gfx->setTextColor(C_MUTED);
  gfx->setCursor(x, y);
  gfx->print(title);
  String v = pct < 0 ? T("Sin dato", "No data") : String(pct) + "%";
  gfx->setTextColor(C_TEXT);
  gfx->setCursor(x + w - textWidth(v), y);
  gfx->print(v);
  gfx->fillRoundRect(x, y + 8, w, 10, 5, C_CARD_HI);
  if (pct > 0) gfx->fillRoundRect(x, y + 8, max(10, w * min(pct, 100) / 100), 10, 5, pct >= 90 ? C_ERR : pct >= 70 ? C_NEED : C_XP);
}

void drawRest() {
  gfx->fillScreen(C_BG);
  uint32_t t = nowLocal();
  char clock[8] = "--:--";
  if (t) snprintf(clock, sizeof(clock), "%02lu:%02lu", (unsigned long)((t % 86400) / 3600), (unsigned long)((t % 3600) / 60));
  gfx->setFont(F_CLOCK);
  gfx->setTextColor(C_TEXT);
  printCentered(clock, W / 2, 112);
  gfx->setFont(F_TITLE);
  gfx->setTextColor(C_MUTED);
  printCentered(sumDate, W / 2, 142);
  if (errorText.length()) {
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_ERR);
    printCentered(errorText, W / 2, 200);
    return;
  }
  // Tres columnas: prompts de hoy, semana y Fable.
  int cw = 130, gap = 20, x0 = (W - 3 * cw - 2 * gap) / 2, y = 210;
  gfx->setFont(F_NAME);
  gfx->setTextColor(C_MUTED);
  gfx->setCursor(x0, y);
  gfx->print(T("Prompts hoy", "Prompts today"));
  gfx->setFont(F_BIG);
  gfx->setTextColor(C_TEXT);
  gfx->setCursor(x0, y + 30);
  gfx->print(sumPrompts);
  drawMeter(x0 + cw + gap, y, cw, T("Semana", "Week"), sumWeek);
  drawMeter(x0 + 2 * (cw + gap), y, cw, "Fable", sumFable);
  gfx->setFont(F_SMALL);
  gfx->setTextColor(C_MUTED);
  printCentered(T("Nadie te necesita. Toca para ver tus agentes.", "Nobody needs you. Tap to see your agents."), W / 2, H - 16);
}

/** Aviso a pantalla completa: el agente que terminó o pide permiso. */
void drawAlert(const Agent &a) {
  uint16_t sc = alertKind == 'p' ? C_NEED : C_WORK;
  gfx->fillScreen(C_BG);
  uint32_t dt = millis() - alertStart;
  if (dt > ALERT_BLINK_MS || (dt / 250) % 2 == 0)
    for (int i = 0; i < 6; i++) gfx->drawRoundRect(i, i, W - 2 * i, H - 2 * i, 14 - i, sc);
  drawAvatar(a, 130, 250, 6);
  int tx = 250, tw = W - tx - 20;
  gfx->setFont(F_TITLE);
  gfx->setTextColor(sc);
  gfx->setCursor(tx, 112);
  gfx->print(alertKind == 'p' ? T("Pide permiso", "Needs permission") : T("Terminó", "Finished"));
  gfx->setFont(F_BIG);
  gfx->setTextColor(C_TEXT);
  gfx->setCursor(tx, 148);
  gfx->print(fitText(a.name, tw));
  gfx->setFont(F_NAME);
  gfx->fillCircle(tx + 5, 171, 5, a.color);
  gfx->setTextColor(C_MUTED);
  gfx->setCursor(tx + 16, 176);
  gfx->print(fitText(a.room, tw - 16));
  gfx->setFont(F_SMALL);
  gfx->setCursor(tx, 226);
  gfx->print(T("Toca para abrirlo", "Tap to open"));
}

void draw() {
  Agent *alerted = alertAgentId >= 0 ? agentById(alertAgentId) : nullptr;
  if (alerted) {
    drawAlert(*alerted);
    gfx->flush();
    return;
  }
  if (mode == MODE_REST) {
    drawRest();
    gfx->flush();
    return;
  }
  gfx->fillScreen(C_BG);
  drawHeader();
  for (int slot = 0; slot < perPage() && pageFirst[page] + slot < pageLast[page]; slot++) drawCard(slot, view[pageFirst[page] + slot]);
  if (agentCount == 0 && !errorText.length()) {
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_MUTED);
    printCentered(T("Sin agentes en la oficina", "No agents in the office"), W / 2, H / 2);
  }

  // Flechas laterales y puntos de diapositiva (por encima de las fichas que entran deslizándose).
  if (pages() > 1) {
    int cy = HEADER_H + (H - HEADER_H - FOOTER_H) / 2;
    gfx->fillRect(0, HEADER_H, SIDE_W, H - HEADER_H, C_BG);
    gfx->fillRect(W - SIDE_W, HEADER_H, SIDE_W, H - HEADER_H, C_BG);
    gfx->fillRoundRect(4, HEADER_H + GAP, SIDE_W - 6, H - HEADER_H - FOOTER_H - 2 * GAP, 8, C_CARD);
    gfx->fillRoundRect(W - SIDE_W + 2, HEADER_H + GAP, SIDE_W - 6, H - HEADER_H - FOOTER_H - 2 * GAP, 8, C_CARD);
    drawChevron(SIDE_W / 2 - 4, cy, -1);
    drawChevron(W - SIDE_W / 2 + 2, cy, 1);
    int dots = pages();
    int x = W / 2 - (dots - 1) * 8;
    for (int i = 0; i < dots; i++) {
      if (i == page) gfx->fillCircle(x + i * 16, H - 8, 4, C_TEXT);
      else gfx->drawCircle(x + i * 16, H - 8, 4, C_MUTED);
    }
  }

  // Aviso temporal (solo errores al abrir).
  if (millis() < toastUntil) {
    gfx->fillRoundRect(60, H - 50, W - 120, 38, 10, C_TEXT);
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_BG);
    printCentered(fitText(toastText, W - 140), W / 2, H - 26);
  }
  gfx->flush();
}

/** ¿Hay sprites animados a la vista? */
bool screenAnimates() {
  if (alertAgentId >= 0) return true;
  if (mode == MODE_REST) return false;
  for (int i = pageFirst[page]; i < pageLast[page]; i++) {
    const Agent &a = agents[view[i]];
    Sprite *s = a.sprite >= 0 ? findSprite(a.sprite) : nullptr;
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
  cfgIp = prefs.getString("ip", "");
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
    prefs.putString("ip", (const char *)(doc["ip"] | ""));
    prefs.end();
    loadConfig();
    hostIp = IPAddress(0, 0, 0, 0);
    lastPayload = "";
    Serial.println("OK");
  } else if (line == "INFO") {
    Serial.printf("host=%s mac=%s backup=%s port=%u key=%s wifi=%s ip=%s agents=%d err=%s\n", cfgHost.c_str(), hostIp.toString().c_str(), cfgIp.c_str(), cfgPort, cfgKey.length() ? "(guardada)" : "(vacia)",
                  WiFi.status() == WL_CONNECTED ? WiFi.SSID().c_str() : "-", WiFi.localIP().toString().c_str(), agentCount, errorText.c_str());
  } else if (line == "IMU") {
    int16_t ax, ay, az;
    if (readAccel(ax, ay, az)) Serial.printf("addr=0x%02X ax=%d ay=%d az=%d rotation=%d\n", imuAddr, ax, ay, az, rotation);
    else Serial.println("sin sensor");
  } else if (line == "WIFI_RESET") {
    wm.resetSettings();
    Serial.println("OK");
    ESP.restart();
  }
}

// ── Actualización por Wi-Fi y diagnóstico ─────────────────────────
/** OTA (contraseña = la clave de Cubicle; `./flash.sh ota`), GET /info, /rotate y /shot. */
void startNetServices() {
  netReady = true;
  ArduinoOTA.setHostname("cubicle-pantalla");
  ArduinoOTA.setPassword(cfgKey.c_str());
  ArduinoOTA.onStart([]() {
    analogWrite(PIN_BL, BL_FULL);
    drawMessage(T("Actualizando", "Updating"), T("No la desconectes...", "Do not unplug..."));
  });
  ArduinoOTA.begin();
  web.on("/info", []() {
    int16_t ax = 0, ay = 0, az = 0;
    bool imu = readAccel(ax, ay, az);
    char out[260];
    snprintf(out, sizeof(out), "{\"rotation\":%d,\"manual\":%s,\"imu\":%s,\"ax\":%d,\"ay\":%d,\"az\":%d,\"agents\":%d,\"mode\":%d,\"shown\":%d,\"pages\":%d,\"page\":%d,\"alert\":%d,\"error\":\"%s\"}",
             rotation, rotationManual ? "true" : "false", imu ? "true" : "false", ax, ay, az, agentCount, (int)mode, viewCount, pageCount, page, alertAgentId, errorText.c_str());
    web.send(200, "application/json", out);
  });
  web.on("/rotate", []() {
    setManualRotation(rotation == 1 ? 3 : 1);
    pendingRedraw = true;
    web.send(200, "application/json", String("{\"rotation\":") + rotation + "}");
  });
  // Captura de lo que hay en pantalla (RGB565 crudo, 320x480 sin girar). Pide la clave.
  web.on("/shot", []() {
    if (web.header("X-Cubicle-Key") != cfgKey) {
      web.send(401, "text/plain", "unauthorized");
      return;
    }
    const size_t len = 320UL * 480UL * 2UL;
    const uint8_t *fb = (const uint8_t *)gfx->getFramebuffer();
    web.setContentLength(len);
    web.send(200, "application/octet-stream", "");
    for (size_t o = 0; o < len; o += 4096) web.sendContent((const char *)fb + o, min((size_t)4096, len - o));
  });
  // Vista previa para revisar la pantalla sin esperar: v=rest | alert | toggle. Pide la clave.
  web.on("/preview", []() {
    if (web.header("X-Cubicle-Key") != cfgKey) {
      web.send(401, "text/plain", "unauthorized");
      return;
    }
    String v = web.arg("v");
    if (v == "rest") {
      previewRestUntil = millis() + 8000;
    } else if (v == "alert" && agentCount > 0) {
      alertAgentId = agents[0].id;
      alertKind = web.arg("k") == "p" ? 'p' : 'f';
      alertStart = millis();
    } else if (v == "toggle") {
      userAll = !userAll;
    }
    rebuildView();
    pendingRedraw = true;
    web.send(200, "application/json", "{\"ok\":true}");
  });
  const char *headers[] = {"X-Cubicle-Key"};
  web.collectHeaders(headers, 1);
  web.begin();
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
  analogWrite(PIN_BL, BL_FULL);
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(200);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  initDisplay();
  initImu();
  prefs.begin("cubicle", true);
  int saved = prefs.getUChar("rot", 1);
  prefs.end();
  int r = rotationFromImu();
  applyRotation(r ? r : (saved == 3 ? 3 : 1));
  loadConfig();
  lastActivityMs = millis();

  drawMessage("Cubicle", "Wi-Fi...");
  // Portal NO bloqueante: mientras esperas en el móvil, la placa sigue atendiendo el USB.
  wm.setConfigPortalBlocking(false);
  wm.setConfigPortalTimeout(0);
  wm.setAPCallback([](WiFiManager *) {
    portalOpen = true;
    drawMessage("Wi-Fi", "Conecta el móvil a la red / Join the network", "\"Cubicle-Pantalla\"");
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
  if (WiFi.status() == WL_CONNECTED && !netReady && cfgKey.length()) startNetServices();
  if (netReady) {
    ArduinoOTA.handle();
    web.handleClient();
  }
  if (portalOpen) {
    delay(20);
    return;
  }
  if (cfgHost.isEmpty() || cfgKey.isEmpty()) {
    static bool shown = false;
    if (!shown) drawMessage("Cubicle", "Falta configurar: ./flash.sh config", "Not configured: ./flash.sh config");
    shown = true;
    delay(50);
    return;
  }

  static bool dirty = true;

  // BOOT: toque corto = girar la pantalla; 3 s = olvidar el Wi-Fi.
  static uint32_t bootSince = 0;
  if (digitalRead(PIN_BOOT) == LOW) {
    if (!bootSince) bootSince = millis();
    if (millis() - bootSince > 3000) {
      drawMessage("Wi-Fi", T("Wi-Fi olvidado. Reiniciando...", "Wi-Fi forgotten. Restarting..."));
      wm.resetSettings();
      delay(500);
      ESP.restart();
    }
  } else {
    if (bootSince && millis() - bootSince > 30 && millis() - bootSince < 1000) {
      setManualRotation(rotation == 1 ? 3 : 1);
      dirty = true;
    }
    bootSince = 0;
  }

  // Giro automático: la misma orientación durante ~1 s seguido (sin saltos al moverla).
  static uint32_t lastImu = 0, wantSince = 0;
  static int want = 0;
  if (imuAddr && millis() - lastImu > 250) {
    lastImu = millis();
    int r = rotationFromImu();
    if (r == 0 || r == rotation) {
      want = 0;
    } else if (r != want) {
      want = r;
      wantSince = millis();
    } else if (millis() - wantSince > 1000) {
      applyRotation(r);
      rotationManual = false;
      want = 0;
      dirty = true;
    }
  }

  // Datos: agentes cada 2 s, resumen cada 30 s, y un sprite que falte en los huecos.
  static uint32_t lastFetch = 0, lastSummary = 0;
  static bool hadError = false, touching = false;
  static int lastSelectedId = -1;
  if (!touching && millis() - lastFetch > 2000) {
    lastFetch = millis();
    bool changed = fetchAgents();
    bool hasError = errorText.length() > 0;
    if (changed) {
      rebuildView();
      // Si cambia el seleccionado en la oficina y está en otra diapositiva, se pasa a ella.
      int selId = -1;
      for (int i = 0; i < agentCount; i++)
        if (agents[i].selected) selId = agents[i].id;
      if (selId != lastSelectedId) {
        lastSelectedId = selId;
        int sp = selectedPage();
        if (sp >= 0 && sp != page) goToPage(sp, sp > page ? 1 : -1);
      }
    }
    if (changed || hasError != hadError) dirty = true;
    hadError = hasError;
  } else if (!touching && errorText.isEmpty() && (!haveSummary || millis() - lastSummary > 30000) && millis() - lastSummary > 3000) {
    lastSummary = millis();
    if (fetchSummary()) dirty = true;
  } else if (!touching && errorText.isEmpty() && loadMissingSprite()) {
    dirty = true;
  }

  // Paso a reposo tras 5 min sin agentes activos ni toques.
  static uint32_t lastModeCheck = 0;
  if (millis() - lastModeCheck > 1000) {
    lastModeCheck = millis();
    if (rebuildView()) dirty = true;
  }

  // Fin del aviso.
  if (alertAgentId >= 0 && millis() - alertStart > ALERT_MS) {
    alertAgentId = -1;
    dirty = true;
  }

  // Toque. Con aviso: abre ese agente. En reposo: despierta. En la cabecera: alterna ACTIVOS/TODOS.
  // Franjas laterales (o deslizar): cambian de diapositiva. Sobre una ficha: la abre al soltar.
  static int downX = 0, downY = 0, lastX = 0;
  static bool consumed = false;
  int x, y;
  bool down = readTouch(x, y);
  if (down && !touching) {
    downX = x;
    downY = y;
    pressedIndex = -1;
    consumed = false;
    lastActivityMs = millis();
    if (alertAgentId >= 0) {
      Agent *a = agentById(alertAgentId);
      alertAgentId = -1;
      consumed = true;
      if (a) openAgent(*a);
    } else if (mode == MODE_REST) {
      rebuildView();
      consumed = true;
    } else if (y < HEADER_H + 4) {
      if (activeCount() > 0) {
        userAll = !userAll;
        rebuildView();
      }
      consumed = true;
    } else {
      for (int slot = 0; slot < perPage(); slot++) {
        int cx, cy, cw, ch;
        cellRect(slot, cx, cy, cw, ch);
        int i = pageFirst[page] + slot;
        if (i < pageLast[page] && x >= cx && x < cx + cw && y >= cy && y < cy + ch) pressedIndex = view[i];
      }
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
    if (!consumed) {
      int dx = lastX - downX;
      bool leftZone = downX < SIDE_W && downY > HEADER_H;
      bool rightZone = downX >= W - SIDE_W && downY > HEADER_H;
      if (pages() > 1 && (rightZone || dx < -SWIPE_PX)) {
        goToPage((page + 1) % pages(), 1);
      } else if (pages() > 1 && (leftZone || dx > SWIPE_PX)) {
        goToPage((page + pages() - 1) % pages(), -1);
      } else if (pressedIndex >= 0 && pressedIndex < agentCount) {
        openAgent(agents[pressedIndex]);
      }
    }
    pressedIndex = -1;
    dirty = true;
  }
  touching = down;

  static bool toastShown = false;
  bool toastNow = millis() < toastUntil;
  if (toastNow != toastShown) dirty = true;
  toastShown = toastNow;

  // Deslizamiento de la diapositiva (ease-out).
  if (slideDir) {
    float t = (millis() - slideStart) / (float)SLIDE_MS;
    if (t >= 1) {
      slideDir = 0;
      slideDx = 0;
    } else {
      float e = 1 - (1 - t) * (1 - t) * (1 - t);
      slideDx = (int)(slideDir * (W / 3) * (1 - e));
    }
    dirty = true;
  }

  // Animación de los Pokémon y del aviso (~10 fps); el reloj del reposo, cada 10 s.
  static uint32_t lastAnim = 0;
  if (millis() - lastAnim > (uint32_t)(screenAnimates() ? 100 : mode == MODE_REST ? 10000 : 30000)) {
    lastAnim = millis();
    dirty = true;
  }

  if (pendingRedraw) {
    pendingRedraw = false;
    dirty = true;
  }
  if (dirty) {
    draw();
    dirty = false;
  }
  delay(10);
}
