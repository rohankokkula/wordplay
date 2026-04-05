import odDiscUrl from '../assets/OD_Compact_disc.svg?url';

type Props = {
  spinning: boolean;
  poke: boolean;
  className?: string;
};

/** Full Illustrator export `OD_Compact_disc.svg` (embedded texture + vector layers). */
export function OdCompactDiscIcon({ spinning, poke, className = 'mix-disc-svg' }: Props) {
  const rotClass = [
    'mix-disc-rotator',
    'mix-disc-rotator--asset',
    spinning && 'mix-disc-rotator--spin',
    poke && !spinning && 'mix-disc-rotator--poke',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rotClass}>
      <img src={odDiscUrl} alt="" className={className} decoding="async" draggable={false} />
    </div>
  );
}
