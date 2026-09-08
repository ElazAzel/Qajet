import { Reveal } from '@qajet/ui/motion';

export default function ConciergeHome() {
  return (
    <Reveal className="flex h-full flex-col items-center justify-center gap-2 py-24 text-center">
      <p className="text-lg font-semibold text-ink">Выберите заказ слева</p>
      <p className="max-w-sm text-sm text-muted">
        Доска показывает активные заказы по приоритету — сначала споры и заказы, ждущие плана.
      </p>
    </Reveal>
  );
}
