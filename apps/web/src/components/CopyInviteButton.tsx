import { useState } from "react";

export interface CopyInviteButtonProps {
  inviteUrl: string;
}

export function CopyInviteButton({ inviteUrl }: CopyInviteButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
      const textarea = document.createElement("textarea");
      textarea.value = inviteUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-secondary btn-copy"
      onClick={handleCopy}
      aria-label="Copy invite link to clipboard"
    >
      <span aria-hidden="true">{copied ? "✓" : "📋"}</span>
      <span>{copied ? "Copied!" : "Copy Invite"}</span>
    </button>
  );
}
