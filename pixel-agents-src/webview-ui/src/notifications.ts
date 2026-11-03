/**
 * Notificaciones del navegador: cuando un agente termina o te necesita y no
 * estás mirando su terminal (o la pestaña no está enfocada). El permiso se pide
 * en el primer clic del usuario (los navegadores bloquean pedirlo sin gesto).
 */
let armed = false;
function armPermission(): void {
  if (armed || typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  armed = true;
  const ask = () => {
    void Notification.requestPermission();
    window.removeEventListener('click', ask);
  };
  window.addEventListener('click', ask);
}
armPermission();

export function notify(names: string[], what: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // Si la pestaña está visible y enfocada, la ficha que late ya avisa; la notificación es para cuando no miras.
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const n = new Notification('Cubicle', { body: `${names.join(', ')} · ${what}`, tag: `cubicle-${names.join(',')}` });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* sin notificaciones */
  }
}
