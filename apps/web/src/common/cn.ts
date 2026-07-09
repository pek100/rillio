import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// shadcn's class-merge helper: clsx for conditional composition + tailwind-merge
// so later utilities beat earlier conflicting ones (e.g. cn('p-2', 'p-4') -> 'p-4').
// Used by the new Tailwind/shadcn components; legacy code keeps using `classnames`.
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
