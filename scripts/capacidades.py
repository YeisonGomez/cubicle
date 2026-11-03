#!/usr/bin/env python3
"""Base de capacidades de cada sesión de la oficina: <OFICINA_DIR>/capacidades.json

  { "<Directorio>": { "recursos": [{"nombre","tipo","detalle"}], "mcp": [str],
                      "apps": [str], "skills": [{"nombre","descripcion"}],
                      "actualizado": ms, "fuente": "sesion|manual" } }

  capacidades.py pregunta "<Directorio>"      imprime la pregunta estándar para una sesión
  capacidades.py set "<Directorio>" < json    guarda (reemplaza) lo declarado por la sesión
  capacidades.py get ["<Directorio>"]         muestra lo guardado
  capacidades.py lista                        resumen de todas

El servidor de la oficina (GET /api/agents/:name/capabilities) mezcla lo declarado
aquí con lo detectado en los transcripts (MCP y skills usados de verdad).
"""
import json, os, sys, time

DATA = os.environ.get("OFICINA_DIR") or os.path.join(os.path.expanduser("~"), ".pixel-agents", "oficina")
OFI = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(DATA, "capacidades.json")
TIPOS = ["base de datos", "api", "nube", "correo", "servicio", "otro"]
# "archivos" (carpetas locales, iCloud, Drive) no es un recurso externo: se descarta al guardar.

PREGUNTA = """Oficina (pixel agents): registra tus capacidades externas. Responde SOLO ejecutando este comando
con el JSON lleno (sin texto adicional), basándote en tu CLAUDE.md, tus skills, tus MCP y lo que
realmente sabes usar en este proyecto:

python3 {script} set "{nombre}" <<'JSON'
{{
  "recursos": [ {{"nombre": "MongoDB production", "tipo": "base de datos", "detalle": "lectura via mongosh"}} ],
  "mcp": [ "Sentry", "Customer.io" ],
  "apps": [ "Chrome", "Mail" ],
  "skills": [ {{"nombre": "Health check de ambientes", "descripcion": "Verifica el deploy en dev, sandbox y prod",
               "detalle": "Comprueba que el build desplegado es el HEAD de la rama, que el frontend carga sin errores y que Sentry y el backend responden. Se usa con 'revisa el health de sandbox'."}} ]
}}
JSON

Reglas: "recursos" = SOLO lo que consultas FUERA del proyecto: bases de datos (una por ambiente),
APIs y servicios externos (Sila, Customer.io, DocuSign, Garmin, Wompi…), nube (AWS, GCP), correo.
NO incluyas carpetas locales, iCloud/Drive, repos ni la propia oficina. "tipo" ∈ {tipos}. "mcp" = servidores MCP que
usas (nombre corto). "apps" = aplicaciones (Mail, Chrome, Notion, Slack, Terminal, Excel...). "skills" =
tus habilidades (máx. 8), incluidas las que aún no son skills formales: "descripcion" = una frase corta;
"detalle" = 2-4 frases en lenguaje natural explicando qué hace, cuándo se usa y cómo se pide.
Empieza cada texto con mayúscula. Nombres cortos (máx. 30 caracteres)."""

PREGUNTA_EN = """Cubicle (pixel agents): register your external capabilities. Reply ONLY by running this command
with the JSON filled in (no extra text), based on your CLAUDE.md, your skills, your MCP servers and what
you can actually use in this project:

python3 {script} set "{nombre}" <<'JSON'
{{
  "recursos": [ {{"nombre": "MongoDB production", "tipo": "base de datos", "detalle": "read access via mongosh"}} ],
  "mcp": [ "Sentry", "Customer.io" ],
  "apps": [ "Chrome", "Mail" ],
  "skills": [ {{"nombre": "Environment health check", "descripcion": "Verifies the deploy in dev, sandbox and prod",
               "detalle": "Checks that the deployed build is the branch HEAD, that the frontend loads without errors and that Sentry and the backend respond. Triggered with 'check sandbox health'."}} ]
}}
JSON

Rules: "recursos" = ONLY what you query OUTSIDE the project: databases (one per environment),
external APIs and services (Sila, Customer.io, DocuSign, Garmin, Wompi…), cloud (AWS, GCP), email.
Do NOT include local folders, iCloud/Drive, repos or the office itself. "tipo" ∈ {tipos} (keep these Spanish keys as-is). "mcp" = MCP servers
you use (short name). "apps" = applications (Mail, Chrome, Notion, Slack, Terminal, Excel...). "skills" =
your skills (max 8), including ones that are not formal skills yet: "descripcion" = one short sentence;
"detalle" = 2-4 sentences in plain English explaining what it does, when it is used and how to ask for it.
Write every text in English, starting with a capital letter. Short names (max 30 characters)."""

def pregunta_tpl():
    return PREGUNTA_EN if os.environ.get("OFICINA_LANG", "en") == "en" else PREGUNTA

def load():
    return json.load(open(DB)) if os.path.exists(DB) else {}
def save(d):
    tmp = DB + ".tmp"
    json.dump(d, open(tmp, "w"), indent=2, ensure_ascii=False)
    os.replace(tmp, DB)

import re
_LOCAL = re.compile(r"^(~|/|\.)|localhost|127\.0\.0\.1|\blocal\b|icloud|pixel ?agents|\boficina\b|launchd|artifacts", re.I)
def es_local(nombre, detalle=""):
    """Carpetas, procesos locales y la propia oficina no son recursos externos."""
    return bool(_LOCAL.search(str(nombre))) or bool(re.search(r"^(~|/)", str(detalle).strip()))

def cap(t):
    """Primera letra en mayúscula (los textos se muestran en la UI)."""
    t = str(t).strip()
    return t[:1].upper() + t[1:] if t else t

def norm(raw):
    def s(x, n=60):
        return str(x).strip()[:n]
    out = {"recursos": [], "mcp": [], "apps": [], "skills": []}
    for r in raw.get("recursos") or []:
        if isinstance(r, str):
            r = {"nombre": r}
        if not r.get("nombre"):
            continue
        tipo = s(r.get("tipo") or "otro").lower()
        if tipo == "archivos" or es_local(r.get("nombre", ""), r.get("detalle", "")):
            continue
        out["recursos"].append({"nombre": s(r["nombre"]), "tipo": tipo if tipo in TIPOS else "otro", "detalle": s(r.get("detalle") or "", 120)})
    out["mcp"] = sorted({s(x, 40) for x in (raw.get("mcp") or []) if str(x).strip()})
    out["apps"] = sorted({s(x, 40) for x in (raw.get("apps") or []) if str(x).strip()})
    for k in (raw.get("skills") or [])[:12]:
        if isinstance(k, str):
            k = {"nombre": k}
        if k.get("nombre"):
            out["skills"].append({"nombre": cap(s(k["nombre"])), "descripcion": cap(s(k.get("descripcion") or "", 160)), "detalle": cap(s(k.get("detalle") or "", 700))})
    for r in out["recursos"]:
        r["detalle"] = cap(r["detalle"])
    return out

def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__); return 0
    cmd = argv[1]
    if cmd == "pregunta":
        print(pregunta_tpl().format(nombre=argv[2], tipos=", ".join(TIPOS), script=os.path.join(OFI, "capacidades.py"))); return 0
    if cmd == "set":
        nombre = argv[2]
        raw = json.loads(sys.stdin.read())
        d = load()
        d[nombre] = {**norm(raw), "actualizado": int(time.time() * 1000), "fuente": "sesion"}
        save(d)
        e = d[nombre]
        print(f"guardado {nombre}: {len(e['recursos'])} recursos, {len(e['mcp'])} mcp, {len(e['apps'])} apps, {len(e['skills'])} skills → {DB}")
        return 0
    if cmd == "get":
        d = load()
        print(json.dumps(d.get(argv[2]) if len(argv) > 2 else d, indent=2, ensure_ascii=False)); return 0
    if cmd == "lista":
        for n, e in load().items():
            print(f"{n:<22} recursos: {', '.join(r['nombre'] for r in e['recursos']) or '—'} | mcp: {', '.join(e['mcp']) or '—'} | apps: {', '.join(e['apps']) or '—'} | skills: {len(e['skills'])}")
        return 0
    print("comando desconocido", cmd); return 1

if __name__ == "__main__":
    sys.exit(main(sys.argv))
