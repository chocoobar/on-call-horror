export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#0b0c10" stroke="#2a2d35" />
      <path
        d="M10 10.5 14.5 16 10 21.5"
        stroke="#ff4d4d"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="17" y1="21.5" x2="23" y2="21.5" stroke="#ff4d4d" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
