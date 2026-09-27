DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid, command FROM cron.job
           WHERE jobname IN ('eterna-scan-orchestrator','protection-autopilot-sweep')
             AND command NOT LIKE '%timeout_milliseconds%'
  LOOP
    PERFORM cron.alter_job(
      j.jobid,
      command := regexp_replace(
        j.command,
        '(body\s*:=\s*(?:''\{\}''::jsonb|jsonb_build_object\(''limit'',\s*10\)))',
        '\1,
    timeout_milliseconds := 840000'
      )
    );
  END LOOP;
END $$;