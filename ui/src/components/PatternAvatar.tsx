/**
 * A member's pattern-avatar (members and invites slice, Adam's design
 * 2026-10-10): no photo, no initials, nothing that names anyone. A 5×5
 * mirrored pattern and a hue, both read from the seed the server sends (a
 * hash of the hub and the account, so the same person looks the same
 * everywhere on one hub, and different on another).
 *
 * Decorative: the name beside it says who it is, or the count says how many.
 */
export default function PatternAvatar({ seed, size = 32 }: { seed: string; size?: number }) {
  const bits = parseInt(seed.slice(0, 8), 16) >>> 0;
  const hue = parseInt(seed.slice(8, 11), 16) % 360;
  const cells: Array<[number, number]> = [];
  // 15 bits: three columns of five rows, mirrored onto columns 3 and 4. The
  // grid spans 2..8, inside the circle's radius, so nothing needs clipping.
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 5; row++) {
      if ((bits >>> (col * 5 + row)) & 1) {
        cells.push([col, row]);
        if (col < 2) cells.push([4 - col, row]);
      }
    }
  }
  return (
    <svg
      className="pattern-avatar"
      width={size}
      height={size}
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="5" cy="5" r="5" fill={`hsl(${hue} 55% 88%)`} />
      <g fill={`hsl(${hue} 50% 38%)`}>
        {cells.map(([c, r]) => (
          <rect key={`${c}-${r}`} x={2 + c * 1.2} y={2 + r * 1.2} width="1.2" height="1.2" />
        ))}
      </g>
    </svg>
  );
}
