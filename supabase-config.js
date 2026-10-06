insert into public.rifa_perfis (auth_user_id, login, perfil, vendedor_id)
select id, 'admin', 'admin', null
from auth.users
where email = 'admin@rifa.com'
on conflict (auth_user_id) do update
set login = excluded.login, perfil = 'admin', vendedor_id = null;
