import { CATALOG_BY_KEY } from './catalog';
import { almatyToday } from './dates';

export const PROGRAM_CITIES = { almaty: 'Алматы', astana: 'Астана', shymkent: 'Шымкент' } as const;
export type ProgramCity = keyof typeof PROGRAM_CITIES;
export type ProgramId = 'welcome' | 'event' | 'team-gifts';
interface ProgramDefinition {
  id: ProgramId;
  title: string;
  occasion: string;
  description: string;
  items: { itemKey: string; perRecipient: boolean }[];
  defaultQty: number;
}
export function getProgramCatalogItem(key: string) {
  const item = CATALOG_BY_KEY.get(key);
  if (!item) throw new Error('Program references an unavailable catalog entry');
  return item;
}
function defineProgram(program: ProgramDefinition) {
  const perRecipient = program.items.filter((item) => item.perRecipient);
  return {
    ...program,
    qtyMin: Math.max(...perRecipient.map((item) => getProgramCatalogItem(item.itemKey).qtyMin)),
    qtyMax: Math.min(...perRecipient.map((item) => getProgramCatalogItem(item.itemKey).qtyMax)),
  };
}
/** Starter briefs, not stocked products or supplier quotations. Catalog owns limits. */
export const PROGRAMS = [
  defineProgram({
    id: 'welcome',
    title: 'Первый день в команде',
    occasion: 'Новым сотрудникам',
    description: 'Welcome-набор с вашим брендом. Наполнение и макет согласуем до производства.',
    items: [{ itemKey: 'welcome-kit', perRecipient: true }],
    defaultQty: 50,
  }),
  defineProgram({
    id: 'event',
    title: 'Мерч для мероприятия',
    occasion: 'Участникам события',
    description: 'Футболки и кепки для участников, один баннер для площадки.',
    items: [
      { itemKey: 'tshirt-logo', perRecipient: true },
      { itemKey: 'cap-logo', perRecipient: true },
      { itemKey: 'banner-2x1', perRecipient: false },
    ],
    defaultQty: 100,
  }),
  defineProgram({
    id: 'team-gifts',
    title: 'Подарки команде',
    occasion: 'К корпоративному празднику',
    description: 'Корпоративные подарочные наборы. Состав, упаковку и нанесение уточним вместе.',
    items: [{ itemKey: 'newyear-set', perRecipient: true }],
    defaultQty: 50,
  }),
] as const;
export interface ProgramBrief {
  program: ProgramId;
  qty: number;
  city: ProgramCity;
  budgetKzt: number | null;
  deadlineDate: string | null;
}
const ALLOWED_FIELDS = new Set(['program', 'qty', 'city', 'budget', 'date']);
export const PROGRAM_BRIEF_STORAGE_KEY = 'qajet.program-brief.v1';
export function getProgram(id: ProgramId) {
  const program = PROGRAMS.find((entry) => entry.id === id);
  if (!program) throw new Error('Unavailable program');
  return program;
}
/** Import only known planning fields. A brief never grants identity or approval authority. */
export function parseProgramBrief(value: unknown, today = almatyToday()): ProgramBrief | null {
  if (typeof value !== 'string' || !value || value.length > 1024) return null;
  const params = new URLSearchParams(value);
  for (const key of params.keys()) {
    if (!ALLOWED_FIELDS.has(key) || params.getAll(key).length !== 1) return null;
  }
  const program = PROGRAMS.find((entry) => entry.id === params.get('program'));
  const qtyText = params.get('qty') ?? '';
  const city = params.get('city') ?? '';
  if (!program || !/^\d+$/.test(qtyText) || !Object.hasOwn(PROGRAM_CITIES, city)) return null;
  const qty = Number(qtyText);
  if (!Number.isSafeInteger(qty) || qty < program.qtyMin || qty > program.qtyMax) return null;
  const budgetText = params.get('budget');
  const budgetKzt = budgetText === null ? null : Number(budgetText);
  if (
    budgetText !== null &&
    (budgetKzt === null ||
      !/^\d+$/.test(budgetText) ||
      !Number.isSafeInteger(budgetKzt) ||
      budgetKzt < 1 ||
      budgetKzt > 10_000_000_000)
  )
    return null;
  const deadlineDate = params.get('date');
  if (deadlineDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) return null;
    const date = new Date(`${deadlineDate}T00:00:00Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== deadlineDate ||
      deadlineDate < today
    )
      return null;
  }
  return { program: program.id, qty, city: city as ProgramCity, budgetKzt, deadlineDate };
}
export function programBriefQuery(brief: ProgramBrief): string {
  const params = new URLSearchParams({
    program: brief.program,
    qty: String(brief.qty),
    city: brief.city,
  });
  if (brief.budgetKzt !== null) params.set('budget', String(brief.budgetKzt));
  if (brief.deadlineDate !== null) params.set('date', brief.deadlineDate);
  return params.toString();
}
export function programRequestUrl(): string {
  return '/buyer/requests/new?prepared=program';
}
export function getProgramItems(brief: ProgramBrief): { itemKey: string; qty: number }[] {
  return getProgram(brief.program).items.map((item) => ({
    itemKey: item.itemKey,
    qty: item.perRecipient ? brief.qty : 1,
  }));
}
export function buildProgramBriefText(brief: ProgramBrief): string {
  const money = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  return [
    `Закупка QAJET: ${getProgram(brief.program).title}`,
    `Получателей: ${brief.qty}. Город: ${PROGRAM_CITIES[brief.city]}.`,
    brief.deadlineDate
      ? `Желаемая дата получения: ${brief.deadlineDate}.`
      : 'Дату получения нужно согласовать.',
    brief.budgetKzt !== null
      ? `Общий бюджет клиента: ${money(brief.budgetKzt)} ₸, до ${money(brief.budgetKzt / brief.qty)} ₸ на получателя.`
      : 'Бюджет нужно согласовать.',
    'Предварительный состав:',
    ...getProgramItems(brief).map(
      (line) =>
        `- ${getProgramCatalogItem(line.itemKey).name}: ${line.qty} ${getProgramCatalogItem(line.itemKey).unit}`,
    ),
    'Нужно согласовать наполнение, макет, полную цену с доставкой и дату получения. Производство начнётся после согласования плана. Условия предоплаты обсудим отдельно.',
  ].join('\n');
}
