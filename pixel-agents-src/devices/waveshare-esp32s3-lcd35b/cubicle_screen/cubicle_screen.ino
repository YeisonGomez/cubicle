/*
 * Cubicle Screen: tus agentes de Cubicle en una Waveshare ESP32-S3-Touch-LCD-3.5B.
 *
 * - Se conecta al Wi-Fi (la primera vez crea la red "Cubicle-Pantalla": conéctate
 *   desde el móvil y elige tu Wi-Fi; la contraseña se queda solo en la placa).
 * - Pide a Cubicle la lista de agentes cada 2 s (GET /device/agents) y los muestra en
 *   una cuadrícula de 4x2 por diapositiva: el Pokémon animado (GET /device/sprite/:id,
 *   ya en RGB565), el nombre, el color de su sala y su estado.
 * - Los agentes van agrupados por sala, de la más usada a la menos (orden del servidor).
 * - Las franjas de los lados (o deslizar) cambian de diapositiva; tocar un agente lo
 *   abre en el computador (POST /device/open).
 * - Mantener BOOT 3 s borra el Wi-Fi guardado y vuelve a abrir el portal.
 *
 * Servidor, puerto y clave se guardan por el puerto serie (ver README.md):
 *   CFG {"host":"mi-mac.local","ip":"192.168.1.10","port":3101,"key":"..."}
 *
 * Pantalla: controlador AXS15231B por QSPI (320x480) y táctil del mismo chip por I2C
 * (0x3B). El reset de la pantalla va por el expansor TCA9554 (0x20, pin 1).
 */
#include <Arduino.h>
#include <ArduinoOTA.h>
#include <WebServer.h>
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
static const uint16_t C_SEL = 0x7B5E;     // morado: agente seleccionado en la oficina (#7c6cf0)
static const uint16_t C_SEL_BG = 0x292C;  // su fondo (#2b2560)
static const uint16_t SPRITE_KEY = 0xF81F;  // transparente en los sprites

// Fuentes (U8g2, con tildes y eñes).
#define F_TITLE u8g2_font_helvB12_tf
#define F_NAME u8g2_font_helvB10_tf
#define F_SMALL u8g2_font_helvR08_tf

// ── Configuración guardada ────────────────────────────────────────
Preferences prefs;
WiFiManager wm;
WebServer web(80);  // GET /info: estado y acelerómetro (diagnóstico, sin datos sensibles)
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
  bool selected;  // seleccionado en la oficina
  char status;  // 'w' trabajando, 'p' pide permiso, 'q' te necesita (sin mirar), 'i' libre
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
static const int GAP = 5;
static const int SIDE_W = 40;    // franjas laterales para cambiar de diapositiva (el táctil es impreciso)
static const int FOOTER_H = 14;  // puntos de diapositiva
static const int SCALE = 3;  // sprites de 32 px → 96 px
static const int SWIPE_PX = 50;

// ── Orientación: 1 = horizontal normal, 3 = horizontal al revés ─────
// A mano (toque corto en BOOT o GET /rotate) se guarda y es la que vale con la pantalla
// tumbada; el acelerómetro (QMI8658 por I2C) solo la cambia si está claramente de pie.
int rotation = 1;
bool rotationManual = false;  // compat. con /info: true si la última la eligió el usuario
uint8_t imuAddr = 0;          // 0 = sin sensor
// Eje del acelerómetro que apunta a lo largo de la pantalla y signo con el que la
// gravedad indica "al derecho" (rotación 1). Calibrado sobre la placa real.
static const int IMU_AXIS = 1;  // 0 = x, 1 = y
static const int IMU_SIGN_UPRIGHT = -1;
static const int16_t IMU_THRESHOLD = 6000;  // ~0,37 g: por debajo, tumbada o dudosa → la guardada

// ── Utilidades ────────────────────────────────────────────────────
uint16_t hexTo565(const char *hex) {
  if (!hex || hex[0] != '#' || strlen(hex) < 7) return C_IDLE;
  long v = strtol(hex + 1, nullptr, 16);
  uint8_t r = (v >> 16) & 0xFF, g = (v >> 8) & 0xFF, b = v & 0xFF;
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

uint16_t statusColor(char st) { return st == 'w' ? C_WORK : (st == 'p' || st == 'q') ? C_NEED : C_IDLE; }
const char *statusLabel(char st) { return st == 'w' ? "Trabajando" : st == 'p' ? "Pide permiso" : st == 'q' ? "Te necesita" : "Libre"; }
// Diapositivas: los agentes de una sala (consecutivos, ya ordenados por uso) no se parten
// entre diapositivas salvo que no quepan en una.
static const int MAX_PAGES = MAX_AGENTS;
int pageFirst[MAX_PAGES], pageLast[MAX_PAGES];  // [first, last)
int pageCount = 1;
void rebuildPages() {
  pageCount = 0;
  int i = 0;
  pageFirst[0] = 0;
  pageLast[0] = 0;
  while (i < agentCount) {
    int j = i;
    while (j < agentCount && agents[j].room == agents[i].room) j++;
    int size = j - i;
    int used = pageCount ? pageLast[pageCount - 1] - pageFirst[pageCount - 1] : PER_PAGE;
    if (used + size > PER_PAGE && !(used < PER_PAGE && size > PER_PAGE)) {
      pageFirst[pageCount] = i;
      pageLast[pageCount] = i;
      pageCount++;
    }
    // Un grupo de más de PER_PAGE agentes se reparte en diapositivas llenas.
    for (int k = i; k < j; k++) {
      if (pageLast[pageCount - 1] - pageFirst[pageCount - 1] >= PER_PAGE) {
        pageFirst[pageCount] = k;
        pageLast[pageCount] = k;
        pageCount++;
      }
      pageLast[pageCount - 1] = k + 1;
    }
    i = j;
  }
  if (pageCount == 0) pageCount = 1;
}
int pages() { return pageCount; }

// Animación al cambiar de diapositiva: la nueva entra deslizándose desde el lado.
static const uint32_t SLIDE_MS = 220;
uint32_t slideStart = 0;
int slideDir = 0;  // 1 = viene de la derecha, -1 = de la izquierda
int slideDx = 0;   // desplazamiento actual de las fichas

void goToPage(int p, int dir) {
  if (p == page || p < 0 || p >= pages()) return;
  page = p;
  slideDir = dir;
  slideStart = millis();
}

/** Diapositiva del agente seleccionado en la oficina, o -1. */
int selectedPage() {
  for (int pg = 0; pg < pages(); pg++)
    for (int i = pageFirst[pg]; i < pageLast[pg]; i++)
      if (agents[i].selected) return pg;
  return -1;
}

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
    g.selected = a["selected"] | false;
    const char *st = a["status"] | "idle";
    g.status = strcmp(st, "working") == 0 ? 'w' : strcmp(st, "permission") == 0 ? 'p' : strcmp(st, "question") == 0 ? 'q' : 'i';
  }
  rebuildPages();
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
  for (int i = pageFirst[page]; i < pageLast[page]; i++) order[k++] = i;
  for (int i = 0; i < agentCount; i++)
    if (i < pageFirst[page] || i >= pageLast[page]) order[k++] = i;
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
  w = (W - 2 * SIDE_W - GAP * (COLS + 1)) / COLS;
  h = (H - HEADER_H - FOOTER_H - GAP * (ROWS + 1)) / ROWS;
  x = SIDE_W + GAP + col * (w + GAP) + slideDx;
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

void draw() {
  gfx->fillScreen(C_BG);

  // Cabecera: las salas de esta diapositiva (con su color) y, a la derecha, el recuento.
  int working = 0, needs = 0;
  for (int i = 0; i < agentCount; i++) {
    if (agents[i].status == 'w') working++;
    if (agents[i].status == 'p' || agents[i].status == 'q') needs++;
  }
  if (errorText.length()) {
    gfx->fillRect(0, 0, W, HEADER_H, C_ERR);
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_TEXT);
    gfx->setCursor(10, 20);
    gfx->print(errorText);
  } else {
    gfx->setFont(F_SMALL);
    String right = String(working) + " trabajando";
    if (needs > 0) right += "  " + String(needs) + (needs > 1 ? " te necesitan" : " te necesita");
    int rw = textWidth(right);
    gfx->setTextColor(needs > 0 ? C_NEED : C_WORK);
    gfx->setCursor(W - 10 - rw, 20);
    gfx->print(right);
    gfx->setFont(F_NAME);
    int hx = 10;
    for (int i = pageFirst[page]; i < pageLast[page]; i++) {
      if (i > pageFirst[page] && agents[i].room == agents[i - 1].room) continue;
      String r = agents[i].room;
      int tw = textWidth(r);
      if (hx + 14 + tw > W - 20 - rw) break;
      gfx->fillCircle(hx + 4, 15, 4, agents[i].color);
      gfx->setTextColor(C_TEXT);
      gfx->setCursor(hx + 13, 20);
      gfx->print(r);
      hx += 13 + tw + 14;
    }
  }

  // Cuadrícula de la diapositiva.
  int start = pageFirst[page];
  for (int slot = 0; slot < PER_PAGE && start + slot < pageLast[page]; slot++) {
    const Agent &a = agents[start + slot];
    int x, y, w, h;
    cellRect(slot, x, y, w, h);
    uint16_t sc = statusColor(a.status);
    bool pressed = (start + slot) == pressedIndex;
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
    Sprite *s = a.sprite >= 0 ? findSprite(a.sprite) : nullptr;
    if (s && s->px) {
      drawSprite(*s, cx, y + 96);
    } else {
      // Sin Pokémon (o aún cargando): la inicial en un círculo del color de la sala.
      gfx->fillCircle(cx, y + 54, 28, a.color);
      gfx->setFont(F_TITLE);
      gfx->setTextColor(C_BG);
      printCentered(a.name.substring(0, 1), cx, y + 61);
    }
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_TEXT);
    printCentered(fitText(a.name, w - 8), cx, y + h - 20);
    gfx->setFont(F_SMALL);
    gfx->setTextColor(sc);
    String label = statusLabel(a.status);
    int lw = textWidth(label) + 12;
    gfx->fillCircle(cx - lw / 2 + 3, y + h - 10, 3, sc);
    gfx->setCursor(cx - lw / 2 + 12, y + h - 6);
    gfx->print(label);
  }
  if (agentCount == 0 && !errorText.length()) {
    gfx->setFont(F_NAME);
    gfx->setTextColor(C_MUTED);
    printCentered("Sin agentes en la oficina", W / 2, H / 2);
  }

  // Flechas laterales y puntos de diapositiva.
  if (pages() > 1) {
    int cy = HEADER_H + (H - HEADER_H - FOOTER_H) / 2;
    // Por encima de las fichas que entran deslizándose.
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
  for (int i = pageFirst[page]; i < pageLast[page]; i++) {
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

// ── Actualización por Wi-Fi y estado ──────────────────────────────
/** OTA (contraseña = la clave de Cubicle; `./flash.sh ota`) y GET /info. */
void startNetServices() {
  netReady = true;
  ArduinoOTA.setHostname("cubicle-pantalla");
  ArduinoOTA.setPassword(cfgKey.c_str());
  ArduinoOTA.onStart([]() { drawMessage("Actualizando", "No la desconectes..."); });
  ArduinoOTA.begin();
  web.on("/info", []() {
    int16_t ax = 0, ay = 0, az = 0;
    bool imu = readAccel(ax, ay, az);
    char out[200];
    snprintf(out, sizeof(out), "{\"rotation\":%d,\"manual\":%s,\"imu\":%s,\"ax\":%d,\"ay\":%d,\"az\":%d,\"agents\":%d,\"error\":\"%s\"}",
             rotation, rotationManual ? "true" : "false", imu ? "true" : "false", ax, ay, az, agentCount, errorText.c_str());
    web.send(200, "application/json", out);
  });
  web.on("/rotate", []() {
    setManualRotation(rotation == 1 ? 3 : 1);
    pendingRedraw = true;
    web.send(200, "application/json", String("{\"rotation\":") + rotation + "}");
  });
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
  digitalWrite(PIN_BL, HIGH);
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
    if (!shown) drawMessage("Falta configurar", "Conecta la pantalla por USB", "y guarda servidor y clave");
    shown = true;
    delay(50);
    return;
  }

  // BOOT: toque corto = girar la pantalla; 3 s = olvidar el Wi-Fi.
  static uint32_t bootSince = 0;
  static bool dirtyRot = false;
  if (digitalRead(PIN_BOOT) == LOW) {
    if (!bootSince) bootSince = millis();
    if (millis() - bootSince > 3000) {
      drawMessage("Wi-Fi olvidado", "Reiniciando...");
      wm.resetSettings();
      delay(500);
      ESP.restart();
    }
  } else {
    if (bootSince && millis() - bootSince > 30 && millis() - bootSince < 1000) {
      setManualRotation(rotation == 1 ? 3 : 1);
      dirtyRot = true;
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
      dirtyRot = true;
    }
  }

  static uint32_t lastFetch = 0;
  static bool dirty = true;
  static bool hadError = false;
  static bool touching = false;
  if (!touching && millis() - lastFetch > 2000) {
    lastFetch = millis();
    bool changed = fetchAgents();
    // Si cambia el seleccionado en la oficina y está en otra diapositiva, se pasa a ella.
    static int lastSelectedId = -1;
    int selId = -1;
    for (int i = 0; i < agentCount; i++)
      if (agents[i].selected) selId = agents[i].id;
    if (selId != lastSelectedId) {
      lastSelectedId = selId;
      int sp = selectedPage();
      if (sp >= 0 && sp != page) goToPage(sp, sp > page ? 1 : -1);
    }
    bool hasError = errorText.length() > 0;
    if (changed || hasError != hadError) dirty = true;
    hadError = hasError;
  } else if (!touching && errorText.isEmpty() && loadMissingSprite()) {
    dirty = true;
  }

  // Toque: las franjas laterales (o deslizar) cambian de diapositiva; tocar y soltar sobre una ficha la abre.
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
      int idx = pageFirst[page] + slot;
      if (idx < pageLast[page] && x >= cx && x < cx + cw && y >= cy && y < cy + ch) pressedIndex = idx;
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
    bool leftZone = downX < SIDE_W && downY > HEADER_H;
    bool rightZone = downX >= W - SIDE_W && downY > HEADER_H;
    if (pages() > 1 && (rightZone || dx < -SWIPE_PX)) {
      goToPage((page + 1) % pages(), 1);
    } else if (pages() > 1 && (leftZone || dx > SWIPE_PX)) {
      goToPage((page + pages() - 1) % pages(), -1);
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

  // Animación de los Pokémon: ~10 fps.
  static uint32_t lastAnim = 0;
  if (pageAnimates() && millis() - lastAnim > 100) {
    lastAnim = millis();
    dirty = true;
  }

  if (dirtyRot || pendingRedraw) {
    dirtyRot = false;
    pendingRedraw = false;
    dirty = true;
  }
  if (dirty) {
    draw();
    dirty = false;
  }
  delay(10);
}
