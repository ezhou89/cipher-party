import { useEffect, useRef } from "react";

interface PrivacyVeilProps {
  open: boolean;
  disabled: boolean;
  onToggle(): void;
}

export function PrivacyVeil({ open, disabled, onToggle }: PrivacyVeilProps) {
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const hideKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      toggleRef.current?.focus();
      onToggle();
    };
    document.addEventListener("keydown", hideKey);
    return () => document.removeEventListener("keydown", hideKey);
  }, [onToggle, open]);

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
        ref={toggleRef}
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
