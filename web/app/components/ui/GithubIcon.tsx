import type { SVGProps } from "react";

// lucide-react v1 dropped brand icons (no `Github`), so we ship the GitHub mark
// as a small inline SVG. Inherits size/color from className (e.g. "h-4 w-4").
export function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.62 8.21 11.18.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.6-4.04-1.6-.55-1.37-1.34-1.74-1.34-1.74-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.22 1.84 1.22 1.07 1.81 2.81 1.29 3.5.99.11-.77.42-1.29.76-1.59-2.67-.3-5.47-1.31-5.47-5.84 0-1.29.47-2.35 1.23-3.18-.12-.3-.53-1.51.12-3.15 0 0 1-.32 3.3 1.21a11.5 11.5 0 0 1 6 0c2.29-1.53 3.29-1.21 3.29-1.21.65 1.64.24 2.85.12 3.15.77.83 1.23 1.89 1.23 3.18 0 4.54-2.81 5.54-5.49 5.83.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .31.22.68.83.56A11.8 11.8 0 0 0 24 12.29C24 5.78 18.63.5 12 .5Z" />
    </svg>
  );
}
