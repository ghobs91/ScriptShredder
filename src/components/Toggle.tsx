type ToggleProps = {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
};

export function Toggle({ checked, onChange, disabled = false, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle${checked ? ' is-on' : ''}`}
      onClick={onChange}
      disabled={disabled}
    >
      <span className="toggle-knob" aria-hidden="true" />
    </button>
  );
}
