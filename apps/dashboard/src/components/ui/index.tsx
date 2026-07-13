import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Info,
  LoaderCircle,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export function Button({
  variant = "secondary",
  compact,
  loading,
  children,
  className = "",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  compact?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      className={`button button--${variant}${compact ? " button--compact" : ""} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <LoaderCircle className="button__spinner" size={16} />}
      <span className={loading ? "button__label--loading" : undefined}>
        {children}
      </span>
    </button>
  );
}

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input(props, ref) {
  return <input ref={ref} {...props} />;
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea(props, ref) {
  return <textarea ref={ref} {...props} />;
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select(props, ref) {
  return <select ref={ref} {...props} />;
});

export function Field({
  label,
  description,
  error,
  required,
  children,
}: {
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {description && <span className="field__hint">{description}</span>}
      {children}
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

export function Checkbox({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="checkbox-control">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  label,
  description,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  description?: string;
}) {
  return (
    <label className="switch-control">
      <input type="checkbox" role="switch" {...props} />
      <span className="switch-control__track" aria-hidden="true">
        <span />
      </span>
      <span className="switch-control__copy">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}

export function RadioGroup({
  legend,
  children,
}: {
  legend: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="radio-group">
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

export function Panel({
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <section className={`panel ${className}`} {...props} />;
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="section-header">
      <span>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </span>
      {actions}
    </header>
  );
}

export function Toolbar(props: HTMLAttributes<HTMLDivElement>) {
  return <div className="toolbar" role="toolbar" {...props} />;
}

type NoticeVariant = "info" | "success" | "warning" | "danger" | "neutral";
const noticeIcons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: AlertCircle,
  neutral: Circle,
};
export function Notice({
  variant = "neutral",
  title,
  children,
  action,
}: {
  variant?: NoticeVariant;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const Icon = noticeIcons[variant];
  return (
    <div
      className={`notice notice--${variant}`}
      role={variant === "danger" ? "alert" : "status"}
    >
      <Icon size={18} />
      <span>
        {title && <strong>{title}</strong>}
        <span>{children}</span>
      </span>
      {action}
    </div>
  );
}

type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";
export function StatusDot({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: StatusTone;
}) {
  return (
    <span className={`status-dot-label status-dot-label--${tone}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}
export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: StatusTone;
}) {
  return (
    <span className={`status-chip status-chip--${tone}`}>
      <Circle size={8} fill="currentColor" />
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function Dialog({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="tc-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <header>
        <h2 id="tc-dialog-title">{title}</h2>
        <IconButton label="Close" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      {children}
    </dialog>
  );
}

export function TableContainer(props: HTMLAttributes<HTMLDivElement>) {
  return <div className="table-container" {...props} />;
}

export function Skeleton({ width = "100%" }: { width?: string }) {
  return <span className="skeleton" style={{ width }} aria-hidden="true" />;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
