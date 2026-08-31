import { useState } from "react";

interface CopyInviteButtonProps {
  inviteUrl: string;
}

export function CopyInviteButton({ inviteUrl }: CopyInviteButtonProps) {
  const [feedback, setFeedback] = useState("");

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setFeedback("Invite copied");
    } catch {
      setFeedback("Copy failed. Select the invite link instead.");
    }
  };

  return (
    <div className="invite-copy">
      <span className="invite-url">{inviteUrl}</span>
      <button
        className="button-secondary"
        type="button"
        onClick={() => void copyInvite()}
      >
        Copy invite link
      </button>
      <span className="copy-feedback" role="status" aria-live="polite">
        {feedback}
      </span>
    </div>
  );
}
