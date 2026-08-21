"use client";

interface MaturixLogoProps {
  variant?: "full" | "compact" | "icon";
  className?: string;
}

export function MaturixLogo({ variant = "full", className = "" }: MaturixLogoProps) {
  if (variant === "icon") {
    return (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className={className}>
        <defs>
          <linearGradient id="simGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2B7FFF" />
            <stop offset="100%" stopColor="#00D4E7" />
          </linearGradient>
        </defs>
        {/* Speed lines */}
        <rect x="0" y="9"  width="6" height="1.8" rx="0.9" fill="url(#simGrad)" opacity="0.9" />
        <rect x="0" y="13" width="4" height="1.8" rx="0.9" fill="url(#simGrad)" opacity="0.6" />
        <rect x="0" y="17" width="5" height="1.8" rx="0.9" fill="url(#simGrad)" opacity="0.75" />
        {/* SIM card rounded square */}
        <rect x="8" y="2" width="20" height="24" rx="4" fill="url(#simGrad)" opacity="0.15" stroke="url(#simGrad)" strokeWidth="1.2" />
        {/* SIM chip cut corner */}
        <path d="M14 2h14v5l-5 0V2z" fill="hsl(220,30%,4%)" />
        {/* Chip grid */}
        <rect x="11" y="9"  width="14" height="10" rx="1.5" fill="none" stroke="url(#simGrad)" strokeWidth="0.9" />
        <line x1="15" y1="9" x2="15" y2="19" stroke="url(#simGrad)" strokeWidth="0.7" opacity="0.7" />
        <line x1="19" y1="9" x2="19" y2="19" stroke="url(#simGrad)" strokeWidth="0.7" opacity="0.7" />
        <line x1="11" y1="13" x2="25" y2="13" stroke="url(#simGrad)" strokeWidth="0.7" opacity="0.7" />
        <line x1="11" y1="16" x2="25" y2="16" stroke="url(#simGrad)" strokeWidth="0.7" opacity="0.7" />
      </svg>
    );
  }

  if (variant === "compact") {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <MaturixLogo variant="icon" />
        <span
          style={{
            fontFamily: "'IBM Plex Sans', sans-serif",
            fontWeight: 700,
            fontSize: "15px",
            letterSpacing: "-0.02em",
            background: "linear-gradient(95deg, #fff 60%, #00D4E7 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          maturix
        </span>
      </div>
    );
  }

  // Full variant
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="flex items-center gap-3">
        {/* Big icon */}
        <svg width="52" height="52" viewBox="0 0 28 28" fill="none">
          <defs>
            <linearGradient id="simGradFull" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#2B7FFF" />
              <stop offset="100%" stopColor="#00D4E7" />
            </linearGradient>
          </defs>
          <rect x="0" y="9"  width="6" height="1.8" rx="0.9" fill="url(#simGradFull)" opacity="0.9" />
          <rect x="0" y="13" width="4" height="1.8" rx="0.9" fill="url(#simGradFull)" opacity="0.6" />
          <rect x="0" y="17" width="5" height="1.8" rx="0.9" fill="url(#simGradFull)" opacity="0.75" />
          <rect x="8" y="2" width="20" height="24" rx="4" fill="url(#simGradFull)" opacity="0.12" stroke="url(#simGradFull)" strokeWidth="1.2" />
          <path d="M14 2h14v5l-5 0V2z" fill="hsl(220,30%,4%)" />
          <rect x="11" y="9"  width="14" height="10" rx="1.5" fill="none" stroke="url(#simGradFull)" strokeWidth="0.9" />
          <line x1="15" y1="9" x2="15" y2="19" stroke="url(#simGradFull)" strokeWidth="0.7" opacity="0.7" />
          <line x1="19" y1="9" x2="19" y2="19" stroke="url(#simGradFull)" strokeWidth="0.7" opacity="0.7" />
          <line x1="11" y1="13" x2="25" y2="13" stroke="url(#simGradFull)" strokeWidth="0.7" opacity="0.7" />
          <line x1="11" y1="16" x2="25" y2="16" stroke="url(#simGradFull)" strokeWidth="0.7" opacity="0.7" />
        </svg>

        {/* Wordmark */}
        <div className="flex flex-col">
          <span
            style={{
              fontFamily: "'IBM Plex Sans', sans-serif",
              fontWeight: 800,
              fontSize: "32px",
              letterSpacing: "-0.04em",
              lineHeight: 1,
              background: "linear-gradient(95deg, #ffffff 55%, #00D4E7 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            maturix
          </span>
        </div>
      </div>

      {/* Tagline */}
      <div className="flex items-center gap-2" style={{ color: "#4E6580" }}>
        <div style={{ width: 28, height: 1, background: "linear-gradient(90deg, transparent, #4E6580)" }} />
        <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: "9px", letterSpacing: "0.18em", fontWeight: 500, color: "#4E6580", textTransform: "uppercase" }}>
          SIM Maturation Platform
        </span>
        <div style={{ width: 28, height: 1, background: "linear-gradient(90deg, #4E6580, transparent)" }} />
      </div>

      <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: "10px", color: "#334155", letterSpacing: "0.02em" }}>
        by <strong style={{ color: "#4E6580" }}>simplix</strong>
      </span>
    </div>
  );
}
