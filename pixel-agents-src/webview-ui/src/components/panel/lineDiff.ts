/** Diff por líneas (Myers O(ND)) para el visor de cambios. Sin dependencias. */

export type DiffOp = { kind: 'same' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number };

export function lineDiff(oldText: string, newText: string): DiffOp[] {
  const a = oldText.length ? oldText.split('\n') : [];
  const b = newText.length ? newText.split('\n') : [];
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  // Myers: traza de V por iteración para reconstruir el camino.
  const trace: Int32Array[] = [];
  let v = new Int32Array(2 * max + 2);
  const off = max;
  v[off + 1] = 0;
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    const snapshot = new Int32Array(v);
    trace.push(snapshot);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && snapshot[off + k - 1] < snapshot[off + k + 1])) x = snapshot[off + k + 1];
      else x = snapshot[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    v = new Int32Array(v);
  }
  // Reconstrucción hacia atrás.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'same', text: a[x - 1], oldNo: x, newNo: y });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push({ kind: 'add', text: b[y - 1], newNo: y });
        y--;
      } else {
        ops.push({ kind: 'del', text: a[x - 1], oldNo: x });
        x--;
      }
    }
  }
  ops.reverse();
  return ops;
}
