#!/usr/bin/env python3
"""Añade a scripts/pokemon.json las cadenas de evolución de 1.ª y 2.ª generación
(`evo`: id -> {name, slug, gen, next}). Las lee de PokeAPI y solo incluye formas
cuyo sprite existe en vscode-pokemon. Se corre a mano: el resultado va en el repo."""
import concurrent.futures as cf
import json
import os
import urllib.error
import urllib.request

RUTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pokemon.json')
UA = {'User-Agent': 'cubicle-data-script'}


def get(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))


def cadena(i):
    try:
        return get(f'https://pokeapi.co/api/v2/evolution-chain/{i}/')['chain']
    except (urllib.error.URLError, ValueError):
        return None


def id_de(nodo):
    return int(nodo['species']['url'].rstrip('/').split('/')[-1])


def existe(url):
    try:
        req = urllib.request.Request(url, headers=UA, method='HEAD')
        return urllib.request.urlopen(req, timeout=30).status == 200
    except urllib.error.URLError:
        return False


data = json.load(open(RUTA))
listados = {p['id']: p for t in data['types'].values() for p in t['pokemon']}
with cf.ThreadPoolExecutor(12) as ex:
    cadenas = [c for c in ex.map(cadena, range(1, 140)) if c]

formas, aristas = {}, []


def recorrer(nodo):
    i = id_de(nodo)
    if i <= 251:
        slug = nodo['species']['name']
        p = listados.get(i, {'name': slug.replace('-', ' ').title(), 'slug': slug, 'gen': 1 if i <= 151 else 2})
        formas[i] = {'name': p['name'], 'slug': p['slug'], 'gen': p['gen'], 'next': []}
    for hijo in nodo['evolves_to']:
        if i <= 251 and id_de(hijo) <= 251:
            aristas.append((i, id_de(hijo)))
        recorrer(hijo)


for c in cadenas:
    recorrer(c)


def sprites_ok(i):
    f = formas[i]
    base = data['sprite'].replace('{gen}', str(f['gen'])).replace('{slug}', f['slug'])
    return i, all(existe(base.replace('{anim}', a)) for a in ('idle', 'walk'))


with cf.ThreadPoolExecutor(16) as ex:
    faltan = {i for i, ok in ex.map(sprites_ok, list(formas)) if not ok}
for a, b in aristas:
    if a in formas and b in formas and a not in faltan and b not in faltan:
        formas[a]['next'].append(b)
for i in faltan:
    del formas[i]
data['evo'] = {str(i): formas[i] for i in sorted(formas)}
json.dump(data, open(RUTA, 'w'), ensure_ascii=False, indent=2)
print('formas', len(formas), 'sin sprite', sorted(faltan))
