/** Detective/agent hat icon used to identify Agent Smith throughout the app.
 *  Custom SVG since lucide-react has no detective hat. */
interface Props {
  size?: number;
  className?: string;
}

export default function AgentHatIcon({ size = 16, className = '' }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Fedora-style hat: brim + crown + band */}
      <path d="M3 17.5c0-0.5 0.5-1 1.4-1.3 2.4-0.7 5-1.2 7.6-1.2s5.2 0.5 7.6 1.2c0.9 0.3 1.4 0.8 1.4 1.3 0 0.7-0.8 1-1.6 1H4.6c-0.8 0-1.6-0.3-1.6-1z" />
      <path d="M6 16c0-3.5 2.7-7 6-7s6 3.5 6 7" />
      <path d="M6.5 13.5c0 0 2 0.5 5.5 0.5s5.5-0.5 5.5-0.5" />
    </svg>
  );
}
