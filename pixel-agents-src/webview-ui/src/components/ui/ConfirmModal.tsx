import type { ReactNode } from 'react';

import { useT } from '../../i18n/index.js';
import { Button } from './Button.js';
import { Modal } from './Modal.js';

/** Confirmación con el estilo de la oficina (en vez de window.confirm). */
export function ConfirmModal({
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  return (
    <Modal isOpen title={title} onClose={onCancel} zIndex={120} className="w-[460px] max-w-[95vw]">
      <div className="ide-ui flex flex-col gap-12 px-4 pb-4">
        <div className="text-text">{children}</div>
        <div className="flex items-center justify-end gap-8">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'default' : 'accent'} size="sm" onClick={onConfirm} className={danger ? 'text-danger' : undefined}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
