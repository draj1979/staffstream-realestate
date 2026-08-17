export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="28" height="28" rx="8" fill="#4338ca" />
        <path
          d="M8 19V12.5L14 8L20 12.5V19H16.5V15H11.5V19H8Z"
          fill="white"
        />
      </svg>
      <span className="text-lg font-semibold tracking-tight text-slate-900">Staffstream</span>
    </span>
  );
}
