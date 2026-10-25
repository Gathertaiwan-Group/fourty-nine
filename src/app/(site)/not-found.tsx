import type { Metadata } from 'next';
import { NotFoundPage } from '@/components/NotFoundPage';
import { SITE_NAME } from '@/lib/seo';

export const metadata: Metadata = {
  title: { absolute: `找不到頁面 | ${SITE_NAME}` },
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return <NotFoundPage />;
}
