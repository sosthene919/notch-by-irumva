import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/** One component library (brief section 4). Every component documents its
 *  states: rest, hover, pressed, focus, disabled, loading, error — styled in app.css. */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean };
export function Button({ variant = 'ghost', loading, children, disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant}`} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? 'Working…' : children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'agent' | 'danger' | 'action' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return <section className="card">{title ? <h3>{title}</h3> : null}{children}</section>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="row"><span className="row-label">{label}</span><span className="row-value">{children}</span></div>;
}

export function Toggle({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" {...rest} />
      <span aria-hidden="true" className="toggle-track" />
      <span>{label}</span>
    </label>
  );
}

export function Slider({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" aria-label={label} {...rest} />
    </label>
  );
}
