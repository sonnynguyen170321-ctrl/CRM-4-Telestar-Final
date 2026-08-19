import type { Metadata } from 'next';
import TypographyLab from '@/components/TypographyLab';

export const metadata: Metadata = {
  title: 'Typography Lab | Telestar Design System',
  description: 'Living design reference for Telestar Typography Architecture (Montserrat + Futura).',
};

export default function TypographyDocsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <TypographyLab />
    </div>
  );
}
