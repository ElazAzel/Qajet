/** Generated demo SQL must enforce the same client-data boundary as db:reset. */
export const DEMO_RESET_PRECHECK_SQL = `DO $qajet_demo_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.settings
    WHERE key = 'environment_kind' AND value = '"clients"'::jsonb) THEN
    RAISE EXCEPTION 'Demo reset is forbidden in a client environment';
  END IF;
END;
$qajet_demo_guard$;`;
