'use client';

import { useEffect, useRef } from 'react';

/**
 * Демо-ролик на посадочной: 30 секунд реального пути покупателя на демо-данных.
 *
 * Не `autoplay`: ролик запускается, только когда он на экране, и никогда — если
 * человек попросил уменьшить движение. Звука в ролике нет, `muted` нужен
 * браузерам, чтобы разрешить воспроизведение без нажатия. `preload="metadata"`:
 * первый экран не ждёт 2 МБ видео, заголовок страницы показывается сразу.
 */
export function DemoVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          // Отказ браузера (энергосбережение, политика автозапуска) не ошибка:
          // остаются постер и кнопка воспроизведения.
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <figure
      aria-label="Как это выглядит в продукте"
      className="overflow-hidden rounded-hero border border-white/10 bg-white/5 shadow-2xl shadow-black/40"
    >
      <div
        className="flex items-center gap-2 border-white/10 border-b px-4 py-3"
        aria-hidden="true"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="ml-3 truncate rounded-pill bg-white/10 px-3 py-1 text-micro text-white/60">
          qajet-seven.vercel.app
        </span>
      </div>
      <video
        ref={ref}
        muted
        loop
        playsInline
        controls
        preload="metadata"
        poster="/landing/qajet-demo-poster.webp"
        width={1280}
        height={720}
        className="block aspect-video h-auto w-full bg-ink"
      >
        <source src="/landing/qajet-demo.mp4" type="video/mp4" />
      </video>
      <figcaption className="px-4 py-3 text-fine text-white/60">
        30 секунд: от одной фразы до закрывающих документов. Демо-данные, не реальный клиент.
      </figcaption>
    </figure>
  );
}
