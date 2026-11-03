import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  label: ReactNode;
  className?: string;
}

export function Checkbox({ checked, onChange, label, className = '' }: CheckboxProps) {
  return (
    <button
      onClick={onChange}
      className={`flex items-center justify-between w-full py-6 px-10 bg-transparent border-none rounded-none cursor-pointer text-left hover:bg-btn-bg ${className}`}
    >
      <span>{label}</span>
      <span
        className={`size-18 shrink-0 rounded-[5px] flex items-center justify-center transition-colors ${checked ? 'bg-accent text-white' : 'bg-white/10 text-transparent'}`}
      >
        <Check size={13} strokeWidth={3} />
      </span>
    </button>
  );
}
