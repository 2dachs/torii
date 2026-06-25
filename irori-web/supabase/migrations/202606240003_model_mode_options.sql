update public.model_configs
set
  input_price_per_million_tokens = 0.09,
  output_price_per_million_tokens = 0.18,
  context_window = 1048576,
  updated_at = now()
where mode = 'quick'
  and model_slug = 'deepseek/deepseek-v4-flash';

update public.model_configs
set
  input_price_per_million_tokens = 0.435,
  output_price_per_million_tokens = 0.87,
  context_window = 1048576,
  updated_at = now()
where mode = 'standard'
  and model_slug = 'deepseek/deepseek-v4-pro';
