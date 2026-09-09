import Link from 'next/link';

/**
 * Общий 404 для всего сайта (agents.md — нет отдельного экрана для этого
 * в спеке, но брендированная страница нужна везде: неверная ссылка,
 * устаревшая закладка на удалённый заказ). До этого файла Next отдавал
 * дефолтную белую страницу "This page could not be found" — вне дизайн-
 * системы QAJET и без пути назад.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-page px-6 text-center">
      <p className="text-6xl font-extrabold text-ink">404</p>
      <p className="text-fine text-muted">Страница не найдена — возможно, ссылка устарела.</p>
      <Link
        href="/"
        className="mt-2 inline-flex h-10 items-center justify-center rounded-control bg-purple px-5 text-sm font-medium text-white"
      >
        На главную
      </Link>
    </div>
  );
}
