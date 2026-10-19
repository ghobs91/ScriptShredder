export function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 2.25 20 5.6v5.7c0 4.8-3.3 8.4-8 10.45-4.7-2.05-8-5.65-8-10.45V5.6L12 2.25Z"
        fill="currentColor"
      />
      <path
        d="m8.4 9.9-2.1 2.1 2.1 2.1M15.6 9.9l2.1 2.1-2.1 2.1M13.6 8.2l-3.2 7.6"
        stroke="#0d120b"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
