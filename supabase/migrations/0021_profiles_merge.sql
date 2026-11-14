-- 0021 · Профіль не затирається «порожньою» копією (2026-11-14: у учня після входу з нового браузера зникли рівень і налаштування —
-- клієнт надсилає профіль цілим документом, а свіжий пристрій ще до першої синхронізації мав майже порожній профіль із новішим updated_at).
-- Тепер сервер ЗЛИВАЄ: ключі, яких немає в новій версії, лишаються зі старої; settings і about зливаються на рівень глибше.
-- Порядок тригерів за назвою: profiles_sync (sync_guard — старіша версія відкидається) → profiles_zmerge (злиття).
create or replace function public.profiles_merge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and jsonb_typeof(old.data) = 'object' and jsonb_typeof(new.data) = 'object' then
    new.data := old.data || new.data;
    if jsonb_typeof(old.data->'settings') = 'object' and jsonb_typeof(new.data->'settings') = 'object' then
      new.data := jsonb_set(new.data, '{settings}', (old.data->'settings') || (new.data->'settings'));
    end if;
    if jsonb_typeof(old.data->'about') = 'object' and jsonb_typeof(new.data->'about') = 'object' then
      new.data := jsonb_set(new.data, '{about}', (old.data->'about') || (new.data->'about'));
    end if;
  end if;
  return new;
end $$;

create or replace trigger profiles_zmerge before update on public.profiles for each row execute function public.profiles_merge();
