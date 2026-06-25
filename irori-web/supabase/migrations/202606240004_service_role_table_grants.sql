grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.profiles,
  public.projects,
  public.conversations,
  public.messages,
  public.model_configs,
  public.usage_logs,
  public.app_settings,
  public.api_key_secrets
to service_role;
