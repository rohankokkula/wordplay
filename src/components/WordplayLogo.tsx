import { useId } from 'react';
import {
  WP_MAIN_PATH,
  WP_D_INNER_1,
  WP_D_INNER_2,
  WP_PLAY_PATH,
} from './wordplayLogoData';
import odDiscUrl from '../assets/OD_Compact_disc.svg?url';
import './wordplayLogo.css';

const DISC_R = 28;
const DISC_D = DISC_R * 2;
const CX = 104.5;
const CY = 58.5;

type Props = {
  className?: string;
  title?: string;
};

/** Frame 8 wordmark + triangle; “o” uses OD_Compact_disc.svg (same asset as the deck disc). */
export function WordplayLogo({ className, title = 'Wordplay' }: Props) {
  const rawId = useId();
  const clipId = `wp-logo-o-${rawId.replace(/:/g, '')}`;

  return (
    <svg
      className={className}
      viewBox="0 0 485 109"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <circle cx={CX} cy={CY} r={DISC_R} />
        </clipPath>
      </defs>
      <path d={WP_MAIN_PATH} fill="currentColor" />
      <path d={WP_D_INNER_1} fill="currentColor" />
      <path d={WP_D_INNER_2} fill="currentColor" />
      <g clipPath={`url(#${clipId})`}>
        <g transform={`translate(${CX} ${CY})`}>
          <g className="wp-logo-disk">
            <image
              href={odDiscUrl}
              x={-DISC_R}
              y={-DISC_R}
              width={DISC_D}
              height={DISC_D}
              preserveAspectRatio="xMidYMid slice"
            />
          </g>
        </g>
      </g>
      <path
        d={WP_PLAY_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
