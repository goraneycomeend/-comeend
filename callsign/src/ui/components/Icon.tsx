// 인라인 SVG 아이콘. 24×24 격자, 선 굵기 1.75. 색은 글자색(currentColor)을 따른다.
import type { ReactNode } from 'react';

export type IconName =
  | 'agents'
  | 'lines'
  | 'studio'
  | 'changer'
  | 'lab'
  | 'info'
  | 'play'
  | 'stop'
  | 'close'
  | 'check'
  | 'chevronDown'
  | 'chevronRight'
  | 'swap'
  | 'download'
  | 'upload'
  | 'share'
  | 'copy'
  | 'refresh'
  | 'trash'
  | 'plus'
  | 'edit'
  | 'radio'
  | 'mic'
  | 'headphones'
  | 'warning'
  | 'keyboard'
  | 'chip'
  | 'file'
  | 'record'
  | 'wave';

const PATHS: Record<IconName, ReactNode> = {
  agents: (
    <>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3 19.5c.5-3.4 2.9-5.5 6-5.5s5.5 2.1 6 5.5" />
      <path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.3c2 .7 3.2 2.5 3.5 5.2" />
    </>
  ),
  lines: (
    <>
      <path d="M4 5h16v11h-8.5L7 19.5V16H4z" />
      <path d="M8 9h8M8 12.25h5" />
    </>
  ),
  studio: <path d="M4 10v4M8 6.5v11M12 3.5v17M16 7.5v9M20 10.5v3" />,
  changer: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  lab: (
    <>
      <path d="M4 6.5h4M12.5 6.5H20M4 12h9.5M18 12h2M4 17.5h2.5M11 17.5h9" />
      <circle cx="10.25" cy="6.5" r="2.25" />
      <circle cx="15.75" cy="12" r="2.25" />
      <circle cx="8.75" cy="17.5" r="2.25" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.3" />
    </>
  ),
  play: <path d="M8 5.2v13.6L19 12z" fill="currentColor" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  swap: <path d="M4 8.5h14M14.5 5l3.5 3.5-3.5 3.5M20 15.5H6M9.5 12L6 15.5 9.5 19" />,
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  upload: <path d="M12 15.5v-11M7.5 9L12 4.5 16.5 9M5 19.5h14" />,
  share: <path d="M12 14.5V3.5M8 7.5l4-4 4 4M6 11.5v8h12v-8" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M15.5 8.5v-3a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
    </>
  ),
  refresh: <path d="M19 12a7 7 0 1 1-2.2-5.1M19 4.5v4h-4" />,
  trash: <path d="M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7M10.25 10.5v5.5M13.75 10.5v5.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <path d="M5 19l.8-3.8L16.6 4.4a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L8.8 18.2zM14.5 6.5l3 3" />,
  radio: (
    <>
      <rect x="7" y="8" width="10" height="13" rx="1.5" />
      <path d="M10 8V3M10 12h4M10 15h4M10 18h4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </>
  ),
  headphones: (
    <>
      <path d="M4.5 14.5V12a7.5 7.5 0 0 1 15 0v2.5" />
      <path d="M4.5 14h3v5.5h-2a1 1 0 0 1-1-1zM19.5 14h-3v5.5h2a1 1 0 0 0 1-1z" />
    </>
  ),
  warning: <path d="M12 4.5l8.5 14.5h-17zM12 10v4.5M12 16.9v.3" />,
  keyboard: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="1.5" />
      <path d="M7 10.25h.3M11.85 10.25h.3M16.7 10.25h.3M7.5 14h9" />
    </>
  ),
  chip: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1" />
      <path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3" />
    </>
  ),
  file: <path d="M7 3.5h7l4 4v13H7zM14 3.5v4h4" />,
  record: <circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none" />,
  wave: <path d="M3 12h2.5l2-5 3 10 3-13 2.5 11 1.5-3H21" />,
};

export interface IconProps {
  name: IconName;
  /** 한 변 길이(px). 기본 20 */
  size?: number;
  className?: string;
}

/** 장식용 아이콘. 뜻은 곁의 글자나 버튼의 이름(aria-label)이 전한다 */
export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
