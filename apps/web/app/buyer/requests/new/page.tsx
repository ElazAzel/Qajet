import { NewRequestForm } from './_new-request-form';

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ prepared?: string | string[] }>;
}) {
  return <NewRequestForm resumeProgramBrief={(await searchParams).prepared === 'program'} />;
}
