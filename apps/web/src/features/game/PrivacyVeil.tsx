export interface PrivacyVeilProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function PrivacyVeil({ isOpen, onToggle }: PrivacyVeilProps) {
  return (
    <div className="privacy-veil-container">
      <button
        type="button"
        className={`btn ${isOpen ? "btn-secondary" : "btn-primary"} btn-privacy-veil`}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        {isOpen ? "Hide Keycard" : "Show Keycard"}
      </button>
      <span className="privacy-veil-hint">
        {isOpen
          ? "Keycard is visible to you. Close veil if sharing screen."
          : "Keycard hidden. Open veil when ready to review your team's words."}
      </span>
    </div>
  );
}
