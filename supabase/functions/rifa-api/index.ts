import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const authEmailDomain = Deno.env.get('RIFA_AUTH_EMAIL_DOMAIN')!;
const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Profile = {
  auth_user_id: string;
  login: string;
  perfil: 'admin' | 'vendedor';
  vendedor_id: number | null;
};

type Ticket = {
  id: number;
  numero: number;
  vendedor_id: number;
  tipo: string;
  status: string;
  nome_comprador: string | null;
  telefone_comprador: string | null;
  data_venda: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function raise(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function loginEmail(login: string) {
  const domain = authEmailDomain?.trim().toLowerCase().replace(/^@/, '');
  if (!domain || !/^[a-z0-9.-]+$/.test(domain)) {
    raise('Configure RIFA_AUTH_EMAIL_DOMAIN nos segredos da Edge Function.', 500);
  }
  return `${login.trim().toLowerCase()}@${domain}`;
}

async function requireProfile(request: Request): Promise<Profile> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) raise('Faça login para continuar.', 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) raise('Sessão inválida. Entre novamente.', 401);

  const { data: profile, error } = await service.from('rifa_perfis')
    .select('auth_user_id, login, perfil, vendedor_id')
    .eq('auth_user_id', auth.user.id)
    .maybeSingle();
  if (error || !profile) raise('Conta sem perfil de rifa. Configure o perfil de administrador.', 403);
  if (profile.perfil === 'vendedor') {
    const { data: seller } = await service.from('rifa_vendedores')
      .select('ativo').eq('id', profile.vendedor_id).maybeSingle();
    if (!seller?.ativo) raise('O acesso deste vendedor está desativado.', 403);
  }
  return profile as Profile;
}

async function configuration() {
  const { data, error } = await service.from('rifa_configuracao')
    .select('*').eq('id', 1).single();
  if (error) raise(error.message, 500);
  return {
    ...data,
    valor_bilhete: Number(data.valor_bilhete),
    quantidade_premios: Number(data.quantidade_premios),
    quantidade_vendedores: Number(data.quantidade_vendedores),
    bilhetes_impressos: Number(data.bilhetes_impressos),
    bilhetes_online: Number(data.bilhetes_online),
  };
}

async function ensureTickets() {
  const { error } = await service.rpc('rifa_inicializar_bilhetes');
  if (error) raise(error.message, 500);
}

async function getData(profile: Profile) {
  await ensureTickets();
  const config = await configuration();
  let sellersQuery = service.from('rifa_vendedores')
    .select('id, nome, codigo_ref, ativo').eq('ativo', true).order('id')
    .limit(config.quantidade_vendedores);
  let ticketsQuery = service.from('rifa_bilhetes')
    .select('id, numero, vendedor_id, tipo, status, nome_comprador, telefone_comprador, data_venda')
    .order('id');
  if (profile.perfil === 'vendedor') {
    sellersQuery = sellersQuery.eq('id', profile.vendedor_id);
    ticketsQuery = ticketsQuery.eq('vendedor_id', profile.vendedor_id);
    config.quantidade_vendedores = 1;
  }

  const [sellerResult, ticketResult, reservationResult] = await Promise.all([
    sellersQuery,
    ticketsQuery,
    service.from('rifa_reservas').select('bilhete_id, nome_comprador, telefone_comprador'),
  ]);
  if (sellerResult.error || ticketResult.error || reservationResult.error) {
    raise('Não foi possível carregar os dados da rifa.', 500);
  }

  const reservations = new Map((reservationResult.data || []).map((item) => [item.bilhete_id, item]));
  const tickets = ((ticketResult.data || []) as Ticket[]).map((ticket) => {
    const reservation = reservations.get(ticket.id);
    return {
      ...ticket,
      status: ticket.status === 'pago' ? 'pago' : reservation ? 'reservado' : 'disponivel',
      nome_comprador: reservation?.nome_comprador || ticket.nome_comprador || '',
      telefone_comprador: reservation?.telefone_comprador || ticket.telefone_comprador || '',
    };
  });

  const sellers = await Promise.all((sellerResult.data || []).map(async (seller) => {
    const { data: account } = await service.from('rifa_perfis')
      .select('auth_user_id').eq('vendedor_id', seller.id).maybeSingle();
    return {
      id: seller.id,
      nome: seller.nome,
      codigo_ref: seller.codigo_ref,
      chave_pix: config.chave_pix,
      acesso_configurado: Boolean(account),
    };
  }));

  let latestDraw = null;
  if (profile.perfil === 'admin') {
    const { data: latest, error } = await service.from('rifa_sorteios')
      .select('*').order('id', { ascending: false }).limit(1).maybeSingle();
    if (error) raise(error.message, 500);
    if (latest) {
      const { data: draws, error: drawsError } = await service.from('rifa_sorteios')
        .select('id, numero_bilhete, nome_vencedor, telefone_vencedor, nome_vendedor, premio_numero, total_bilhetes_pagos, realizado_em, renovado')
        .eq('grupo_sorteio', latest.grupo_sorteio).order('premio_numero');
      if (drawsError) raise(drawsError.message, 500);
      latestDraw = { ...latest, renovado: Boolean(latest.renovado), sorteios: draws || [] };
    }
  }

  return { success: true, configuracao: config, vendedores: sellers, bilhetes: tickets, ultimo_sorteio: latestDraw };
}

async function upsertSellerAccount(sellerId: number, login: string, name: string, password: string) {
  const { data: existing, error: lookupError } = await service.from('rifa_perfis')
    .select('auth_user_id').eq('vendedor_id', sellerId).maybeSingle();
  if (lookupError) raise(lookupError.message, 500);

  let userId = existing?.auth_user_id;
  if (userId) {
    const update: { password?: string; user_metadata: { nome: string } } = {
      user_metadata: { nome: name },
    };
    if (password) update.password = password;
    const { error } = await service.auth.admin.updateUserById(userId, update);
    if (error) raise(`Falha ao atualizar ${login}: ${error.message}`, 422);
  } else {
    if (password.length < 8 || password.length > 200) {
      raise(`Defina uma senha de pelo menos 8 caracteres para ${login}.`, 422);
    }
    const { data, error } = await service.auth.admin.createUser({
      email: loginEmail(login), password, email_confirm: true, user_metadata: { nome: name },
    });
    if (error || !data.user) raise(`Falha ao criar ${login}: ${error?.message || 'erro de autenticação'}`, 422);
    userId = data.user.id;
  }

  const { error } = await service.from('rifa_perfis').upsert({
    auth_user_id: userId, login, perfil: 'vendedor', vendedor_id: sellerId,
  }, { onConflict: 'auth_user_id' });
  if (error) raise(`Falha ao salvar perfil ${login}: ${error.message}`, 500);
}

async function saveConfiguration(profile: Profile, body: Record<string, unknown>) {
  if (profile.perfil !== 'admin') raise('Ação permitida somente ao administrador.', 403);
  const name = String(body.nome_rifa || '').trim();
  const prize = String(body.premio || '').trim();
  const pixKey = String(body.chave_pix || '').trim();
  const price = Number(body.valor_bilhete);
  const prizeCount = Number(body.quantidade_premios);
  const sellerCount = Number(body.quantidade_vendedores);
  const printed = Number(body.bilhetes_impressos);
  const online = Number(body.bilhetes_online);
  const names = body.nomes_vendedores;
  const passwords = body.senhas_vendedores;

  if (!name || name.length > 120 || prize.length > 200 || !pixKey || pixKey.length > 255
    || !Number.isFinite(price) || price <= 0 || price > 1000000
    || !Number.isInteger(prizeCount) || prizeCount < 1 || prizeCount > 1000
    || !Number.isInteger(sellerCount) || sellerCount < 1 || sellerCount > 100
    || !Number.isInteger(printed) || !Number.isInteger(online) || printed < 0 || online < 0
    || printed + online < 1 || printed + online > 1000
    || !Array.isArray(names) || names.length !== sellerCount
    || !Array.isArray(passwords) || passwords.length !== sellerCount
    || names.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 100)) {
    raise('Confira nome, prêmio, chave Pix, preço, prêmios, quantidades e nomes dos vendedores.', 422);
  }

  const { count: pending, error: pendingError } = await service.from('rifa_sorteios')
    .select('id', { count: 'exact', head: true }).eq('renovado', false);
  if (pendingError) raise(pendingError.message, 500);
  if (pending) raise('Conclua a renovação pendente antes de alterar as configurações.', 409);

  await ensureTickets();
  const current = await configuration();
  const resetTickets = sellerCount !== current.quantidade_vendedores
    || printed !== current.bilhetes_impressos || online !== current.bilhetes_online;
  if (resetTickets) {
    const [paid, reserved, drawHistory] = await Promise.all([
      service.from('rifa_bilhetes').select('id', { count: 'exact', head: true }).eq('status', 'pago'),
      service.from('rifa_reservas').select('bilhete_id', { count: 'exact', head: true }),
      service.from('rifa_sorteios').select('id', { count: 'exact', head: true }),
    ]);
    if (paid.error || reserved.error || drawHistory.error) raise('Falha ao verificar bilhetes em uso.', 500);
    if ((paid.count || 0) + (reserved.count || 0) > 0) {
      raise('Não é possível mudar quantidades enquanto houver bilhetes pagos ou reservados.', 409);
    }
    if (drawHistory.count) raise('Não é possível recriar bilhetes depois de haver sorteios no histórico.', 409);
  }

  const { data: allSellers, error: sellersError } = await service.from('rifa_vendedores')
    .select('id, nome, codigo_ref, ativo').order('id');
  if (sellersError) raise(sellersError.message, 500);
  const active = (allSellers || []).filter((seller) => seller.ativo);
  let nextNumber = (allSellers || []).reduce((max, seller) => {
    const match = /^v(\d+)$/.exec(seller.codigo_ref);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0) + 1;

  while (active.length < sellerCount) {
    const login = `v${nextNumber++}`;
    const { data, error } = await service.from('rifa_vendedores')
      .insert({ nome: `Vendedor ${login.slice(1)}`, codigo_ref: login, ativo: true })
      .select('id, nome, codigo_ref, ativo').single();
    if (error) raise(error.message, 500);
    active.push(data);
  }

  const selected = active.slice(0, sellerCount);
  for (let index = 0; index < selected.length; index += 1) {
    const seller = selected[index];
    const sellerName = (names[index] as string).trim();
    const password = String(passwords[index] || '');
    const { error } = await service.from('rifa_vendedores')
      .update({ nome: sellerName, ativo: true }).eq('id', seller.id);
    if (error) raise(error.message, 500);
    await upsertSellerAccount(seller.id, seller.codigo_ref, sellerName, password);
  }

  const deactivated = active.slice(sellerCount).map((seller) => seller.id);
  if (deactivated.length) {
    const { error } = await service.from('rifa_vendedores').update({ ativo: false }).in('id', deactivated);
    if (error) raise(error.message, 500);
  }

  const { error: configError } = await service.from('rifa_configuracao').update({
    nome_rifa: name,
    premio: prize,
    chave_pix: pixKey,
    valor_bilhete: price,
    quantidade_premios: prizeCount,
    quantidade_vendedores: sellerCount,
    bilhetes_impressos: printed,
    bilhetes_online: online,
    atualizado_em: new Date().toISOString(),
  }).eq('id', 1);
  if (configError) raise(configError.message, 500);

  if (resetTickets) {
    const { error: deleteError } = await service.from('rifa_bilhetes').delete().gt('id', 0);
    if (deleteError) raise(deleteError.message, 500);
    const rows: { numero: number; vendedor_id: number; tipo: string; status: string }[] = [];
    let number = 1;
    for (const seller of selected) {
      for (let index = 0; index < printed + online; index += 1) {
        rows.push({ numero: number++, vendedor_id: seller.id, tipo: index < printed ? 'impresso' : 'online', status: 'disponivel' });
      }
    }
    for (let index = 0; index < rows.length; index += 500) {
      const { error } = await service.from('rifa_bilhetes').insert(rows.slice(index, index + 500));
      if (error) raise(error.message, 500);
    }
  }
  return { success: true, message: 'Configurações da rifa salvas.' };
}

async function handle(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ success: false, message: 'Método inválido.' }, 405);

  try {
    const profile = await requireProfile(request);
    const action = new URL(request.url).searchParams.get('action');
    const body = await request.json().catch(() => ({}));

    if (action === 'sessao') {
      return json({ success: true, usuario: {
        perfil: profile.perfil,
        nome: profile.perfil === 'admin' ? 'Administrador' : profile.login,
        vendedor_id: profile.vendedor_id,
      } });
    }
    if (action === 'dados') return json(await getData(profile));
    if (action === 'salvar-configuracao') return json(await saveConfiguration(profile, body));

    if (action === 'reservar') {
      const ticketId = Number(body.bilhete_id);
      const buyerName = String(body.nome || '').trim();
      const phone = String(body.telefone || '').trim();
      if (!Number.isInteger(ticketId) || ticketId <= 0 || !buyerName || buyerName.length > 100 || !phone || phone.length > 20) {
        raise('Informe bilhete, nome e telefone válidos.', 422);
      }
      const { data, error } = await service.rpc('rifa_reservar_bilhete', {
        p_bilhete_id: ticketId,
        p_nome: buyerName,
        p_telefone: phone,
        p_perfil: profile.perfil,
        p_vendedor_id: profile.vendedor_id,
      });
      if (error) raise(error.message, error.code === 'P0001' ? 409 : 500);
      return json({ success: true, message: data });
    }

    if (action === 'confirmar-pagamento') {
      const ticketId = Number(body.bilhete_id);
      if (!Number.isInteger(ticketId) || ticketId <= 0) raise('Bilhete inválido.', 422);
      const { error } = await service.rpc('rifa_confirmar_pagamento', {
        p_bilhete_id: ticketId,
        p_vendedor_id: profile.perfil === 'vendedor' ? profile.vendedor_id : null,
      });
      if (error) raise(error.message, error.code === 'P0001' ? 409 : 500);
      return json({ success: true, message: 'Pagamento confirmado.' });
    }

    if (action === 'sortear') {
      if (profile.perfil !== 'admin') raise('Ação permitida somente ao administrador.', 403);
      const { data, error } = await service.rpc('rifa_sortear');
      if (error) raise(error.message, error.code === 'P0001' ? 409 : 500);
      const draws = data.sorteios as Record<string, unknown>[];
      return json({ success: true, message: 'Sorteio realizado. Confira os resultados antes de renovar os bilhetes.', sorteio: draws[0], sorteios: draws });
    }

    if (action === 'renovar') {
      if (profile.perfil !== 'admin') raise('Ação permitida somente ao administrador.', 403);
      const { error } = await service.rpc('rifa_renovar');
      if (error) raise(error.message, error.code === 'P0001' ? 409 : 500);
      return json({ success: true, message: 'Bilhetes limpos e rifas renovadas.' });
    }

    return json({ success: false, message: 'Ação inválida.' }, 404);
  } catch (error) {
    const status = Number((error as { status?: number }).status) || 500;
    const message = error instanceof Error ? error.message : 'Erro ao processar a solicitação.';
    return json({ success: false, message }, status);
  }
}

Deno.serve(handle);
