import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The PetMate mark.
 *
 * A single ribbon that draws a dog (teal) and a cat (silver) meeting in an
 * infinity loop — traced from the brand artwork so it stays crisp from a 20px
 * tab icon to a full hero, and so it can be re-coloured per theme and drawn on
 * as an animation, which a raster logo cannot do.
 *
 * Colours come from `--logo-*` tokens in globals.css. On light surfaces the
 * silver becomes slate (silver on white is invisible); `.logo-on-dark` forces
 * the original metallic palette for dark surfaces such as the badge.
 */

const CAT =
  "M209 176C210.2 172.9 213.3 163.8 216 157.5C218.7 151.2 221.4 144.4 225 138C228.6 131.6 233 124.8 237.5 119C242 113.2 247.7 106.9 252 103C256.3 99.1 260.4 98.1 263.5 95.5C266.6 92.9 269.3 88.8 270.5 87.5L271.5 101C272.9 102 276.9 103.9 280 107C283.1 110.1 287.2 115.5 290 119.5C292.8 123.5 294.2 127.5 296.5 131C298.8 134.5 302.3 138.9 303.5 140.5C302.1 142 298.5 147.2 295 149.5C291.5 151.8 286.5 152.7 282.5 154.5C278.5 156.3 273.8 157.6 271 160.5C268.2 163.4 266.2 167.6 265.5 172C264.8 176.4 266 182 267 187C268 192 270.8 197 271.5 202C272.2 207 272.6 212.4 271.5 217C270.4 221.6 268.1 226.2 265 229.5C261.9 232.8 257.6 235.2 253 236.5C248.4 237.8 242.6 238.1 237.5 237.5C232.4 236.9 227.1 235.2 222.5 233C217.9 230.8 213.8 228 210 224.5C206.2 221 203.3 217 200 212C196.7 207 192.9 200.8 190 194.5C187.1 188.2 184.8 180.8 182.5 174.5C180.2 168.2 177.3 159.9 176.3 157C174.8 159.1 171.4 165.7 167.5 169.5C163.6 173.3 157.4 176.5 153 180C148.6 183.5 144.2 186.7 141 190.5C137.8 194.3 135 198.6 133.5 203C132 207.4 131.3 212.7 132 217C132.7 221.3 135 225.8 137.5 229C140 232.2 143.6 234.7 147 236.5C150.4 238.3 156.2 239.1 158 239.6";

const DOG =
  "M256 217C254.2 216.8 248.8 216.8 245 216C241.2 215.2 236.6 213.9 233 212C229.4 210.1 226.3 207.8 223.5 204.5C220.7 201.2 218.6 196.1 216 192C213.4 187.9 210.3 184.6 208 180C205.7 175.4 204.2 170 202 164.5C199.8 159 197 152.8 194.5 147C192 141.2 189.8 135.2 187 129.5C184.2 123.8 180.9 117.2 178 112.5C175.1 107.8 172.9 104.6 169.5 101.5C166.1 98.4 161.6 95.7 157.5 94C153.4 92.3 149.2 91.8 145 91.5C140.8 91.2 136.5 91.6 132.5 92.5C128.5 93.4 124.1 95.2 121 97C117.9 98.8 115.2 102 114 103C112.9 104.5 110.7 108.8 107.5 112C104.3 115.2 99.2 119.1 95 122C90.8 124.9 84.6 128.2 82.5 129.5C83.1 130.6 83.9 133.3 86 136C88.1 138.7 91.4 143.2 95 145.5C98.6 147.8 103.3 148.6 107.5 149.5C111.7 150.4 116.7 149.9 120 151C123.3 152.1 125.6 153.8 127.5 156C129.4 158.2 130.8 161 131.5 164.5C132.2 168 132.8 172.8 132 177C131.2 181.2 128.6 185.3 127 189.5C125.4 193.7 123.5 197.8 122.5 202C121.5 206.2 121 210.3 121.3 214.5C121.5 218.7 122.3 223.5 124 227C125.7 230.5 127.8 233.4 131.3 235.5C134.8 237.6 140.6 238.8 145 239.5C149.4 240.2 153.3 240.3 157.5 239.5C161.7 238.7 166.2 236.6 170 234.5C173.8 232.4 177.5 229.5 180 227C182.5 224.5 184.2 220.8 185 219.5";

const EAR =
  "M151 92C149.8 92.8 145.7 94.5 144 97C142.3 99.5 141.5 103 141 107C140.5 111 140.3 116.2 141 121C141.7 125.8 143.2 131.8 145 136C146.8 140.2 149.2 144.2 152 146.5C154.8 148.8 158.5 149.8 161.5 149.5C164.5 149.2 167.7 147.1 170 145C172.3 142.9 173.9 140 175.5 137C177.1 134 178.4 129.8 179.5 127C180.6 124.2 181.6 121.2 182 120";

/** Tight box around the artwork, and a square box centred on it. */
const VIEWBOX_TIGHT = "76 81 234 166";
const VIEWBOX_SQUARE = "60 31 266 266";

export const LOGO_PATHS = { cat: CAT, dog: DOG, ear: EAR } as const;

export function LogoMark({
  className,
  animated = false,
  square = false,
  onDark = false,
  title,
}: {
  className?: string;
  /** Draws the ribbon on, cat first, then dog — used on splash and hero. */
  animated?: boolean;
  /** Centres the artwork in a square box, for icon-like placements. */
  square?: boolean;
  /** Force the metallic palette regardless of theme. */
  onDark?: boolean;
  /** Supply when the mark is the only thing naming the brand. */
  title?: string;
}) {
  // Gradient ids must be unique per instance: the header renders the mark
  // twice and hides one, and Chrome will not paint a gradient defined inside a
  // display:none SVG for the visible copy.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const teal = `pm-teal-${uid}`;
  const silver = `pm-silver-${uid}`;

  return (
    <svg
      viewBox={square ? VIEWBOX_SQUARE : VIEWBOX_TIGHT}
      fill="none"
      className={cn("pm-mark", animated && "pm-mark-draw", onDark && "logo-on-dark", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={teal} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--logo-teal-1)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--logo-teal-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--logo-teal-3)" }} />
        </linearGradient>
        <linearGradient id={silver} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--logo-silver-1)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--logo-silver-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--logo-silver-3)" }} />
        </linearGradient>
      </defs>

      <g strokeLinecap="round" strokeLinejoin="round" strokeWidth={6.2}>
        {/* Depth: the artwork is embossed metal, so it casts a soft shadow. */}
        <g className="pm-mark-shadow" transform="translate(1.4 2.2)" style={{ stroke: "var(--logo-shadow)" }}>
          <path d={CAT} pathLength={1} />
          <path d={DOG} pathLength={1} />
          <path d={EAR} pathLength={1} />
        </g>

        <path d={CAT} pathLength={1} stroke={`url(#${silver})`} className="pm-mark-cat" />
        <path d={DOG} pathLength={1} stroke={`url(#${teal})`} className="pm-mark-dog" />
        <path d={EAR} pathLength={1} stroke={`url(#${teal})`} className="pm-mark-ear" />

        {/* A thin specular line along the top edge reads as polish. */}
        <g
          className="pm-mark-shine"
          transform="translate(-0.9 -1.1)"
          strokeWidth={1.2}
          style={{ stroke: "var(--logo-shine)" }}
        >
          <path d={CAT} pathLength={1} />
          <path d={DOG} pathLength={1} />
          <path d={EAR} pathLength={1} />
        </g>
      </g>
    </svg>
  );
}

/**
 * The app-icon form: the metallic mark on the deep-slate tile from the brand
 * artwork. It carries its own background, so it reads on any surface.
 */
export function LogoBadge({
  className,
  animated = false,
  title,
}: {
  className?: string;
  animated?: boolean;
  title?: string;
}) {
  return (
    <span className={cn("pm-badge", className)}>
      <LogoMark square onDark animated={animated} title={title} className="relative size-full" />
    </span>
  );
}

/** The wordmark, set wide like the brand artwork. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("pm-wordmark", className)}>
      PETMATE
    </span>
  );
}

export function Logo({
  className,
  showWordmark = true,
  size = "md",
}: {
  className?: string;
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: { mark: "size-8 rounded-[10px]", text: "text-[13px]" },
    md: { mark: "size-10 rounded-xl", text: "text-[15px]" },
    lg: { mark: "size-14 rounded-2xl", text: "text-xl" },
  };

  return (
    <span className={cn("group/logo inline-flex items-center gap-2.5", className)}>
      <LogoBadge
        className={cn(
          sizes[size].mark,
          "transition-transform duration-500 ease-[var(--ease-spring)] group-hover/logo:-rotate-6 group-hover/logo:scale-105",
        )}
      />
      {showWordmark && <Wordmark className={sizes[size].text} />}
    </span>
  );
}
