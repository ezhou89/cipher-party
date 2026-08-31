interface PrivacyVeilProps {
  open: boolean;
  disabled: boolean;
  onToggle(): void;
}

export function PrivacyVeil({ open, disabled, onToggle }: PrivacyVeilProps) {
  return (
    <div className="privacy-veil">
      <div>
        <p className="card-index">Clue-giver key</p>
        <p>
          {open
            ? "Secret ownership is visible."
            : "Secret ownership is veiled."}
        </p>
      </div>
      <button
        className="button-secondary"
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
      >
        {open ? "Hide secret key" : "Show secret key"}
      </button>
    </div>
  );
}
