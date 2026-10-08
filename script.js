// ==================== CONFIGURAÇÕES ====================
const CONFIG = {
    TOTAL_VENDEDORES: 19,
    BILHETES_POR_VENDEDOR: 40,
    BILHETES_ONLINE_POR_VENDEDOR: 20,
    BILHETES_IMPRESSOS_POR_VENDEDOR: 20,
    VALOR_BILHETE: 10.00,
    PIX_KEY: 'rifa@exemplo.com.br',
    NOME_RIFA: 'Rifa Solidária 2025',
    PIX_CITY: 'BRASILIA',
    SUPABASE_URL: window.RIFA_SUPABASE_CONFIG?.url || '',
    SUPABASE_ANON_KEY: window.RIFA_SUPABASE_CONFIG?.anonKey || '',
    AUTH_EMAIL_DOMAIN: window.RIFA_SUPABASE_CONFIG?.authEmailDomain || ''
};
const supabaseClient = window.supabase && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY
    ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
    : null;
const RIFA_API_URL = CONFIG.SUPABASE_URL
    ? `${CONFIG.SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/rifa-api`
    : '';

// ==================== ESTADO ====================
let vendedores = [];
let bilhetes = {};
let filtroVendedor = '';
let bilhetePagamentoAtual = null;
let ultimoSorteio = null;
let usuarioAtual = null;
let configuracaoRifa = {
    nome_rifa: 'Rifa Solidária',
    premio: '',
    chave_pix: CONFIG.PIX_KEY,
    valor_bilhete: CONFIG.VALOR_BILHETE,
    quantidade_premios: 1,
    quantidade_vendedores: CONFIG.TOTAL_VENDEDORES,
    bilhetes_impressos: CONFIG.BILHETES_IMPRESSOS_POR_VENDEDOR,
    bilhetes_online: CONFIG.BILHETES_ONLINE_POR_VENDEDOR
};

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', async () => {
    configurarEventos();
    await verificarSessao();
});

async function verificarSessao() {
    try {
        if (!supabaseClient || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
            throw new Error('Configure a URL e a chave pública do Supabase em supabase-config.js.');
        }
        const { data: sessionData, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        usuarioAtual = sessionData.session ? (await enviarApi('sessao', {})).usuario : null;
    } catch (error) {
        usuarioAtual = null;
        if (error.message?.includes('supabase-config.js')) mostrarToast(error.message);
    }

    atualizarVisibilidadeAcesso();
    if (usuarioAtual) {
        await iniciarPainel();
    }
}

function atualizarVisibilidadeAcesso() {
    const autenticado = Boolean(usuarioAtual);
    document.getElementById('loginScreen').hidden = autenticado;
    document.querySelectorAll('.authenticated-content').forEach((elemento) => {
        elemento.hidden = !autenticado;
    });

    if (!autenticado) return;

    const administrador = usuarioAtual.perfil === 'admin';
    document.getElementById('sessionLabel').textContent = administrador
        ? 'Administrador'
        : `Vendedor: ${usuarioAtual.nome}`;
    document.querySelectorAll('.admin-only').forEach((elemento) => {
        elemento.hidden = !administrador;
    });
    document.querySelectorAll('.seller-only').forEach((elemento) => {
        elemento.hidden = administrador;
    });
}

async function iniciarPainel() {
    try {
        await carregarDados();
        renderizarTudo();
    } catch (error) {
        if (error.status === 401) {
            usuarioAtual = null;
            atualizarVisibilidadeAcesso();
            return;
        }
        mostrarToast(error.message || 'Não foi possível carregar os dados da rifa.');
    }
}

// ==================== DADOS ====================
async function carregarDados() {
    try {
        const data = await enviarApi('dados', {});

        if (data && data.success) {
            vendedores = Array.isArray(data.vendedores) ? data.vendedores : [];
            bilhetes = agruparBilhetes(data.bilhetes || []);
            ultimoSorteio = data.ultimo_sorteio || null;
            if (data.configuracao) {
                configuracaoRifa = data.configuracao;
                CONFIG.TOTAL_VENDEDORES = Number(configuracaoRifa.quantidade_vendedores);
                CONFIG.BILHETES_IMPRESSOS_POR_VENDEDOR = Number(configuracaoRifa.bilhetes_impressos);
                CONFIG.BILHETES_ONLINE_POR_VENDEDOR = Number(configuracaoRifa.bilhetes_online);
                CONFIG.BILHETES_POR_VENDEDOR = CONFIG.BILHETES_IMPRESSOS_POR_VENDEDOR + CONFIG.BILHETES_ONLINE_POR_VENDEDOR;
                CONFIG.VALOR_BILHETE = Number(configuracaoRifa.valor_bilhete);
                CONFIG.NOME_RIFA = configuracaoRifa.nome_rifa;
            }

            if (!vendedores.length || Object.keys(bilhetes).length === 0) {
                throw new Error('A conta não possui vendedor ou bilhetes cadastrados.');
            }
            return;
        }

        throw new Error(data?.message || 'Resposta da API inválida.');
    } catch (error) {
        vendedores = [];
        bilhetes = {};
        throw error;
    }
}

function gerarDadosFallback() {
    vendedores = Array.from({ length: CONFIG.TOTAL_VENDEDORES }, (_, index) => ({
        id: index + 1,
        nome: `Vendedor ${index + 1}`,
        codigo_ref: `v${index + 1}`,
        chave_pix: `pix${index + 1}@exemplo.com`
    }));

    bilhetes = {};
    let numero = 1;

    vendedores.forEach((vendedor) => {
        const lista = [];

        for (let i = 0; i < CONFIG.BILHETES_POR_VENDEDOR; i++) {
            lista.push({
                id: numero,
                numero: numero,
                vendedor_id: vendedor.id,
                tipo: i < CONFIG.BILHETES_IMPRESSOS_POR_VENDEDOR ? 'impresso' : 'online',
                status: 'disponivel',
                nome_comprador: null,
                telefone_comprador: null,
                data_venda: null
            });
            numero += 1;
        }

        bilhetes[vendedor.id] = lista;
    });
}

function agruparBilhetes(listaBilhetes) {
    const agrupado = {};

    (listaBilhetes || []).forEach((bilhete) => {
        const vendedorId = Number(bilhete.vendedor_id);

        if (!agrupado[vendedorId]) {
            agrupado[vendedorId] = [];
        }

        agrupado[vendedorId].push({
            id: bilhete.id,
            numero: Number(bilhete.numero),
            vendedor_id: vendedorId,
            tipo: bilhete.tipo || 'online',
            status: bilhete.status || 'disponivel',
            nome_comprador: bilhete.nome_comprador || '',
            telefone_comprador: bilhete.telefone_comprador || '',
            data_venda: bilhete.data_venda || null
        });
    });

    return agrupado;
}

function renderizarTudo() {
    renderizarCabecalhoRifa();
    renderizarSelectVendedores();
    renderizarEstatisticas();
    renderizarUltimoSorteio();
    renderizarRelatorioCompradores();
    renderizarVendedores();
}

function renderizarRelatorioCompradores() {
    const corpo = document.getElementById('buyerReportRows');
    const pesquisa = document.getElementById('buyerReportSearch')?.value.trim().toLocaleLowerCase('pt-BR') || '';
    const filtroStatus = document.getElementById('buyerReportStatus')?.value || 'todos';
    const linhas = [];

    vendedores.forEach((vendedor) => {
        (bilhetes[vendedor.id] || []).forEach((bilhete) => {
            if (!['reservado', 'pago'].includes(bilhete.status) || !bilhete.nome_comprador) return;
            if (filtroStatus !== 'todos' && bilhete.status !== filtroStatus) return;

            const numeroFormatado = String(bilhete.numero).padStart(3, '0');
            const textoBusca = `${bilhete.nome_comprador} ${bilhete.telefone_comprador} ${bilhete.numero} ${numeroFormatado}`.toLocaleLowerCase('pt-BR');
            if (pesquisa && !textoBusca.includes(pesquisa)) return;
            linhas.push({ vendedor, bilhete });
        });
    });

    linhas.sort((a, b) => Number(a.bilhete.numero) - Number(b.bilhete.numero));
    corpo.innerHTML = '';

    linhas.forEach(({ vendedor, bilhete }) => {
        const linha = document.createElement('tr');
        const valores = [
            String(bilhete.numero).padStart(3, '0'),
            bilhete.nome_comprador,
            bilhete.telefone_comprador || 'Não informado'
        ];
        if (usuarioAtual?.perfil === 'admin') valores.push(vendedor.nome);

        valores.forEach((valor) => {
            const celula = document.createElement('td');
            celula.textContent = valor;
            linha.appendChild(celula);
        });

        const situacao = document.createElement('td');
        const etiqueta = document.createElement('span');
        etiqueta.className = `buyer-status ${bilhete.status}`;
        etiqueta.textContent = bilhete.status === 'pago' ? 'Pago' : 'Reservado';
        situacao.appendChild(etiqueta);
        linha.appendChild(situacao);
        corpo.appendChild(linha);
    });

    const count = document.getElementById('buyerReportCount');
    count.textContent = `${linhas.length} ${linhas.length === 1 ? 'comprador' : 'compradores'}`;
    document.getElementById('buyerReportEmpty').hidden = linhas.length > 0;
}

function renderizarCabecalhoRifa() {
    const premiacao = configuracaoRifa.premio ? ` • Prêmio: ${configuracaoRifa.premio}` : '';
    const preco = ` • Bilhete: R$ ${Number(configuracaoRifa.valor_bilhete).toFixed(2).replace('.', ',')}`;
    const subtitulo = usuarioAtual?.perfil === 'vendedor'
        ? `${configuracaoRifa.bilhetes_impressos} impressos + ${configuracaoRifa.bilhetes_online} online para você${preco}${premiacao}`
        : `${configuracaoRifa.quantidade_vendedores} vendedores • ${configuracaoRifa.bilhetes_impressos} impressos + ${configuracaoRifa.bilhetes_online} online por vendedor • ${configuracaoRifa.quantidade_vendedores * (configuracaoRifa.bilhetes_impressos + configuracaoRifa.bilhetes_online)} bilhetes${preco}${premiacao}`;

    document.getElementById('rifaNameHeading').textContent = `🎟️ ${configuracaoRifa.nome_rifa}`;
    document.getElementById('rifaSubtitle').textContent = subtitulo;
    document.title = `${configuracaoRifa.nome_rifa} - Rifa Online`;
}

function renderizarNomesVendedores(nomes = []) {
    const container = document.getElementById('configNomesVendedores');
    const quantidade = Number(document.getElementById('configQuantidadeVendedores').value) || 1;
    const nomesAtuais = [...container.querySelectorAll('.seller-name-input')].map((input) => input.value);
    const nomesParaUsar = nomes.length ? nomes : nomesAtuais;
    container.innerHTML = '';

    for (let indice = 0; indice < quantidade; indice += 1) {
        const grupo = document.createElement('div');
        grupo.className = 'form-group';
        const rotulo = document.createElement('label');
        const campo = document.createElement('input');
        const grupoCompleto = document.createElement('div');
        const id = `configNomeVendedor${indice + 1}`;

        rotulo.htmlFor = id;
        const codigoLogin = vendedores[indice]?.codigo_ref || `v${indice + 1}`;
        rotulo.textContent = `Vendedor ${indice + 1} (login: ${codigoLogin})`;
        campo.type = 'text';
        campo.id = id;
        campo.name = 'nomes_vendedores[]';
        campo.maxLength = 100;
        campo.className = 'seller-name-input';
        campo.required = true;
        campo.value = nomesParaUsar[indice] || vendedores[indice]?.nome || `Vendedor ${indice + 1}`;
        grupo.append(rotulo, campo);

        const rotuloSenha = document.createElement('label');
        const campoSenha = document.createElement('input');
        rotuloSenha.htmlFor = `configSenhaVendedor${indice + 1}`;
        rotuloSenha.textContent = `Senha do vendedor ${indice + 1}`;
        campoSenha.type = 'password';
        campoSenha.id = `configSenhaVendedor${indice + 1}`;
        campoSenha.name = 'senhas_vendedores[]';
        campoSenha.minLength = 8;
        campoSenha.maxLength = 200;
        campoSenha.autocomplete = 'new-password';
        campoSenha.placeholder = vendedores[indice]?.acesso_configurado ? 'Manter senha atual' : 'Definir senha (mín. 8 caracteres)';
        campoSenha.required = !vendedores[indice]?.acesso_configurado;
        grupoCompleto.className = 'seller-account-fields';
        grupoCompleto.append(grupo, rotuloSenha, campoSenha);
        container.appendChild(grupoCompleto);
    }
}

function preencherFormularioConfiguracao() {
    document.getElementById('configNomeRifa').value = configuracaoRifa.nome_rifa;
    document.getElementById('configPremio').value = configuracaoRifa.premio;
    document.getElementById('configChavePix').value = configuracaoRifa.chave_pix;
    document.getElementById('configValorBilhete').value = Number(configuracaoRifa.valor_bilhete).toFixed(2);
    document.getElementById('configQuantidadePremios').value = configuracaoRifa.quantidade_premios;
    document.getElementById('configQuantidadeVendedores').value = configuracaoRifa.quantidade_vendedores;
    document.getElementById('configBilhetesImpressos').value = configuracaoRifa.bilhetes_impressos;
    document.getElementById('configBilhetesOnline').value = configuracaoRifa.bilhetes_online;
    renderizarNomesVendedores(vendedores.map((vendedor) => vendedor.nome));
}

function renderizarUltimoSorteio() {
    const resumo = document.getElementById('lastDrawSummary');
    const painel = document.getElementById('drawResultPanel');
    const listaVencedores = document.getElementById('drawWinnerList');
    if (!resumo) return;

    const botaoSorteio = document.getElementById('btnAbrirSorteio');
    const quantidadePremios = Number(configuracaoRifa.quantidade_premios) || 1;

    if (!ultimoSorteio) {
        resumo.textContent = 'Nenhum sorteio registrado.';
        painel.hidden = true;
        listaVencedores.replaceChildren();
        botaoSorteio.textContent = `Sortear ${quantidadePremios} ${quantidadePremios === 1 ? 'prêmio' : 'prêmios'}`;
        return;
    }

    const sorteios = Array.isArray(ultimoSorteio.sorteios) && ultimoSorteio.sorteios.length
        ? ultimoSorteio.sorteios
        : [ultimoSorteio];
    const data = new Date(String(ultimoSorteio.realizado_em).replace(' ', 'T'));
    const dataFormatada = Number.isNaN(data.getTime()) ? '' : ` • ${data.toLocaleString('pt-BR')}`;
    painel.hidden = false;
    document.getElementById('drawResultHeading').textContent = sorteios.length === 1 ? 'Número sorteado' : `${sorteios.length} prêmios sorteados`;
    document.getElementById('drawNumber').textContent = String(sorteios[0].numero_bilhete).padStart(3, '0');
    document.getElementById('drawWinner').textContent = `${sorteios[0].nome_vencedor} • ${sorteios[0].nome_vendedor}`;
    document.getElementById('drawWinnerPhone').textContent = `Telefone: ${sorteios[0].telefone_vencedor || 'não registrado neste sorteio'}`;
    listaVencedores.replaceChildren();
    sorteios.forEach((sorteio, indice) => {
        const item = document.createElement('li');
        const premioNumero = Number(sorteio.premio_numero) || indice + 1;
        item.textContent = `Prêmio ${premioNumero}: bilhete ${String(sorteio.numero_bilhete).padStart(3, '0')} • ${sorteio.nome_vencedor} • ${sorteio.nome_vendedor}`;
        listaVencedores.appendChild(item);
    });
    if (ultimoSorteio.renovado) {
        resumo.textContent = `Sorteio entre ${ultimoSorteio.total_bilhetes_pagos} bilhetes pagos; ${sorteios.length} ${sorteios.length === 1 ? 'prêmio distribuído' : 'prêmios distribuídos'}${dataFormatada}.`;
        botaoSorteio.textContent = 'Sortear nova rodada';
    } else {
        resumo.textContent = `Resultado exibido. Os bilhetes continuam preservados até confirmar a limpeza${dataFormatada}.`;
        botaoSorteio.textContent = 'Limpar bilhetes e renovar';
    }
}

function animarRevelacaoSorteio(numerosParticipantes, sorteios) {
    const painel = document.getElementById('drawResultPanel');
    const titulo = document.getElementById('drawResultHeading');
    const numero = document.getElementById('drawNumber');
    const vencedor = document.getElementById('drawWinner');
    const telefoneVencedor = document.getElementById('drawWinnerPhone');
    const resultados = Array.isArray(sorteios) ? sorteios : [sorteios];
    const sorteioPrincipal = resultados[0];
    const participantes = numerosParticipantes.length ? numerosParticipantes : [sorteioPrincipal.numero_bilhete];

    painel.hidden = false;
    painel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    painel.classList.add('is-spinning');
    titulo.textContent = 'Sorteando...';
    vencedor.textContent = `${participantes.length} bilhete${participantes.length === 1 ? '' : 's'} pago${participantes.length === 1 ? '' : 's'} participando`;

    return new Promise((resolve) => {
        const intervalo = window.setInterval(() => {
            const indiceAleatorio = Math.floor(Math.random() * participantes.length);
            numero.textContent = String(participantes[indiceAleatorio]).padStart(3, '0');
        }, 70);

        window.setTimeout(() => {
            window.clearInterval(intervalo);
            painel.classList.remove('is-spinning');
            titulo.textContent = resultados.length === 1 ? 'Número sorteado' : `${resultados.length} prêmios sorteados`;
            numero.textContent = String(sorteioPrincipal.numero_bilhete).padStart(3, '0');
            vencedor.textContent = `${sorteioPrincipal.nome_vencedor} • ${sorteioPrincipal.nome_vendedor}`;
            telefoneVencedor.textContent = `Telefone: ${sorteioPrincipal.telefone_vencedor || 'não registrado'}`;
            resolve();
        }, 2600);
    });
}

function renderizarSelectVendedores() {
    const select = document.getElementById('vendedorSelect');
    if (!select) return;

    select.innerHTML = '<option value="">Todos os vendedores</option>';

    vendedores.forEach((vendedor) => {
        const option = document.createElement('option');
        option.value = vendedor.id;
        option.textContent = vendedor.nome;
        select.appendChild(option);
    });

    if (!filtroVendedor || !vendedores.some((vendedor) => String(vendedor.id) === String(filtroVendedor))) {
        filtroVendedor = '';
    }

    document.getElementById('buyerReportSearch')?.addEventListener('input', renderizarRelatorioCompradores);
    document.getElementById('buyerReportStatus')?.addEventListener('change', renderizarRelatorioCompradores);

    select.value = filtroVendedor || '';
}

function renderizarEstatisticas() {
    const total = vendedores.reduce((acc, vendedor) => {
        return acc + (bilhetes[vendedor.id]?.length || 0);
    }, 0);

    const disponiveis = vendedores.reduce((acc, vendedor) => {
        const lista = bilhetes[vendedor.id] || [];
        return acc + lista.filter((bilhete) => bilhete.status !== 'pago' && bilhete.status !== 'reservado').length;
    }, 0);

    const reservados = vendedores.reduce((acc, vendedor) => {
        const lista = bilhetes[vendedor.id] || [];
        return acc + lista.filter((bilhete) => bilhete.status === 'reservado').length;
    }, 0);

    const vendidos = vendedores.reduce((acc, vendedor) => {
        const lista = bilhetes[vendedor.id] || [];
        return acc + lista.filter((bilhete) => bilhete.status === 'pago').length;
    }, 0);

    document.getElementById('totalBilhetes').textContent = total;
    document.getElementById('totalDisponiveis').textContent = disponiveis;
    document.getElementById('totalReservados').textContent = reservados;
    document.getElementById('totalVendidos').textContent = vendidos;
}

function renderizarVendedores() {
    const container = document.getElementById('vendedoresContainer');
    if (!container) return;

    const vendedoresFiltrados = filtroVendedor
        ? vendedores.filter((vendedor) => String(vendedor.id) === String(filtroVendedor))
        : vendedores;

    if (!vendedoresFiltrados.length) {
        container.innerHTML = '<div class="empty-state">Nenhum vendedor encontrado.</div>';
        return;
    }

    container.innerHTML = '';

    vendedoresFiltrados.forEach((vendedor) => {
        const bilhetesDoVendedor = bilhetes[vendedor.id] || [];
        const disponiveis = bilhetesDoVendedor.filter((bilhete) => bilhete.status !== 'pago' && bilhete.status !== 'reservado').length;
        const pagos = bilhetesDoVendedor.filter((bilhete) => bilhete.status === 'pago').length;

        const card = document.createElement('article');
        card.className = 'vendedor-card';

        card.innerHTML = `
            <div class="vendedor-header">
                <div class="vendedor-nome">${escaparHtml(vendedor.nome)}</div>
                <div class="vendedor-stats">${disponiveis} disponíveis • ${pagos} pagos</div>
            </div>
            <div class="bilhetes-grid"></div>
        `;

        const grid = card.querySelector('.bilhetes-grid');

        bilhetesDoVendedor.forEach((bilhete) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `bilhete ${obterClasseBilhete(bilhete)}`;
            button.textContent = bilhete.numero;
            button.title = `Bilhete ${bilhete.numero} - ${bilhete.tipo}`;

            if (bilhete.status === 'pago') {
                button.disabled = true;
                button.setAttribute('aria-disabled', 'true');
            } else if (bilhete.status === 'reservado') {
                button.title = `Bilhete ${bilhete.numero} reservado - abrir pagamento`;
                button.addEventListener('click', () => abrirModalPagamento(bilhete, vendedor));
            } else {
                button.addEventListener('click', () => abrirModalCompra(bilhete, vendedor));
            }

            grid.appendChild(button);
        });

        container.appendChild(card);
    });
}

function obterClasseBilhete(bilhete) {
    if (bilhete.status === 'pago') return 'vendido';
    if (bilhete.status === 'reservado') return 'reservado';
    if (bilhete.tipo === 'impresso') return 'impresso';
    return 'disponivel';
}

function abrirModalCompra(bilhete, vendedor) {
    const modalCompra = document.getElementById('modalCompra');
    if (!modalCompra) return;

    document.getElementById('modalVendedor').textContent = vendedor.nome;
    document.getElementById('modalBilhete').textContent = bilhete.numero;
    document.getElementById('modalValor').textContent = CONFIG.VALOR_BILHETE.toFixed(2).replace('.', ',');
    document.getElementById('bilheteId').value = bilhete.id;
    document.getElementById('modalVendaTitulo').textContent = 'Reservar bilhete';
    document.getElementById('btnRegistrarVenda').textContent = 'Reservar e Pagar via Pix';

    modalCompra.classList.add('active');
}

function abrirModalPagamento(bilhete, vendedor) {
    bilhetePagamentoAtual = bilhete.id;

    const chavePix = configuracaoRifa.chave_pix;
    const codigoPix = gerarCodigoPix(chavePix, CONFIG.VALOR_BILHETE, `RIFA${bilhete.numero}`);
    const areaQrCode = document.getElementById('qrcodeImg');
    const campoPix = document.getElementById('pixKey');

    areaQrCode.innerHTML = '';
    campoPix.value = codigoPix;
    document.getElementById('pixRecipient').textContent = chavePix;
    document.getElementById('pixAmount').textContent = `R$ ${CONFIG.VALOR_BILHETE.toFixed(2).replace('.', ',')}`;

    if (typeof QRCode === 'function') {
        new QRCode(areaQrCode, {
            text: codigoPix,
            width: 220,
            height: 220,
            correctLevel: QRCode.CorrectLevel.M
        });
    } else {
        areaQrCode.textContent = 'QR Code indisponível. Copie o código Pix abaixo.';
    }

    document.getElementById('modalPix').classList.add('active');
}

function fecharModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

function configurarEventos() {
    document.getElementById('loginForm')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const botao = document.getElementById('btnLogin');
        botao.disabled = true;
        try {
            if (!supabaseClient || !CONFIG.AUTH_EMAIL_DOMAIN) {
                throw new Error('Configure o Supabase em supabase-config.js antes de entrar.');
            }
            const login = document.getElementById('loginUsuario').value.trim();
            const dominio = CONFIG.AUTH_EMAIL_DOMAIN.trim().replace(/^@/, '').toLowerCase();
            const { error } = await supabaseClient.auth.signInWithPassword({
                email: `${login.toLowerCase()}@${dominio}`,
                password: document.getElementById('loginSenha').value
            });
            if (error) throw error;
            const resultado = await enviarApi('sessao', {});
            usuarioAtual = resultado.usuario;
            document.getElementById('loginSenha').value = '';
            atualizarVisibilidadeAcesso();
            await iniciarPainel();
        } catch (error) {
            mostrarToast(error.message || 'Não foi possível entrar.');
        } finally {
            botao.disabled = false;
        }
    });

    document.getElementById('btnLogout')?.addEventListener('click', async () => {
        try {
            await supabaseClient?.auth.signOut();
        } finally {
            usuarioAtual = null;
            vendedores = [];
            bilhetes = {};
            atualizarVisibilidadeAcesso();
        }
    });

    const btnAbrirConfiguracao = document.getElementById('btnAbrirConfiguracao');
    btnAbrirConfiguracao?.addEventListener('click', () => {
        preencherFormularioConfiguracao();
        document.getElementById('modalConfiguracao').classList.add('active');
    });

    document.getElementById('configQuantidadeVendedores')?.addEventListener('change', () => renderizarNomesVendedores());

    const formConfiguracao = document.getElementById('formConfiguracao');
    formConfiguracao?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const botaoSalvar = document.getElementById('btnSalvarConfiguracao');
        const dados = {
            nome_rifa: document.getElementById('configNomeRifa').value.trim(),
            premio: document.getElementById('configPremio').value.trim(),
            chave_pix: document.getElementById('configChavePix').value.trim(),
            valor_bilhete: Number(document.getElementById('configValorBilhete').value),
            quantidade_premios: Number(document.getElementById('configQuantidadePremios').value),
            quantidade_vendedores: Number(document.getElementById('configQuantidadeVendedores').value),
            bilhetes_impressos: Number(document.getElementById('configBilhetesImpressos').value),
            bilhetes_online: Number(document.getElementById('configBilhetesOnline').value),
            nomes_vendedores: [...document.querySelectorAll('#configNomesVendedores .seller-name-input')].map((input) => input.value.trim()),
            senhas_vendedores: [...document.querySelectorAll('#configNomesVendedores input[type="password"]')].map((input) => input.value)
        };

        botaoSalvar.disabled = true;
        try {
            await enviarApi('salvar-configuracao', dados);
            fecharModal('modalConfiguracao');
            await carregarDados();
            renderizarTudo();
            mostrarToast('Configurações da rifa salvas.');
        } catch (error) {
            mostrarToast(error.message || 'Não foi possível salvar as configurações.');
        } finally {
            document.querySelectorAll('#configNomesVendedores input[type="password"]').forEach((input) => {
                input.value = '';
            });
            botaoSalvar.disabled = false;
        }
    });

    const btnAbrirSorteio = document.getElementById('btnAbrirSorteio');
    btnAbrirSorteio?.addEventListener('click', () => {
        const limpezaPendente = Boolean(ultimoSorteio && !ultimoSorteio.renovado);
        const quantidadePremios = Number(configuracaoRifa.quantidade_premios) || 1;
        document.getElementById('drawModalTitle').textContent = limpezaPendente
            ? 'Limpar bilhetes e renovar'
            : `Sortear ${quantidadePremios} ${quantidadePremios === 1 ? 'prêmio' : 'prêmios'}`;
        document.getElementById('drawModalWarning').textContent = limpezaPendente
            ? 'O número sorteado já está exibido acima. Ao confirmar, as reservas e os estados dos bilhetes serão limpos para iniciar uma nova rodada; o resultado permanecerá no histórico.'
            : `Serão sorteados ${quantidadePremios} bilhetes pagos diferentes, um para cada prêmio. O resultado será exibido antes de qualquer limpeza; os bilhetes continuam como estão até você confirmar a renovação em uma segunda etapa.`;
        document.getElementById('drawConfirmationText').textContent = limpezaPendente
            ? 'Confirmo que desejo limpar os bilhetes e iniciar uma nova rodada.'
            : `Confirmo que desejo sortear ${quantidadePremios} ${quantidadePremios === 1 ? 'prêmio' : 'prêmios'}.`;
        document.getElementById('btnExecutarSorteio').textContent = limpezaPendente
            ? 'Limpar agora e renovar rifas'
            : `Sortear ${quantidadePremios} ${quantidadePremios === 1 ? 'prêmio' : 'prêmios'}`;
        document.getElementById('confirmarRenovacao').checked = false;
        document.getElementById('modalSorteio').classList.add('active');
    });

    const btnExecutarSorteio = document.getElementById('btnExecutarSorteio');
    btnExecutarSorteio?.addEventListener('click', async () => {
        const confirmou = document.getElementById('confirmarRenovacao').checked;

        if (!confirmou) {
            mostrarToast('Confirme que deseja sortear e renovar os bilhetes.');
            return;
        }

        const limpezaPendente = Boolean(ultimoSorteio && !ultimoSorteio.renovado);
        btnExecutarSorteio.disabled = true;
        try {
            if (limpezaPendente) {
                await enviarApi('renovar', {});
                fecharModal('modalSorteio');
                await carregarDados();
                renderizarTudo();
                mostrarToast('Bilhetes limpos. Nova rodada iniciada.');
            } else {
                const numerosParticipantes = Object.values(bilhetes)
                    .flat()
                    .filter((bilhete) => bilhete.status === 'pago')
                    .map((bilhete) => bilhete.numero);
                const resultado = await enviarApi('sortear', {});
                const sorteios = Array.isArray(resultado.sorteios) ? resultado.sorteios : [resultado.sorteio];
                fecharModal('modalSorteio');
                await animarRevelacaoSorteio(numerosParticipantes, sorteios);
                await carregarDados();
                renderizarTudo();
                mostrarToast(`${sorteios.length} ${sorteios.length === 1 ? 'prêmio sorteado' : 'prêmios sorteados'}. Confira os resultados antes de limpar os bilhetes.`);
            }
        } catch (error) {
            mostrarToast(error.message || 'Não foi possível concluir esta etapa.');
        } finally {
            btnExecutarSorteio.disabled = false;
        }
    });

    const select = document.getElementById('vendedorSelect');
    if (select) {
        select.addEventListener('change', (event) => {
            filtroVendedor = event.target.value;
            renderizarTudo();
        });
    }

    const btnImprimirBilhetes = document.getElementById('btnImprimirBilhetes');
    if (btnImprimirBilhetes) {
        btnImprimirBilhetes.addEventListener('click', () => {
            gerarBilhetesImpressos();
            window.print();
        });
    }

    document.querySelectorAll('.close').forEach((botao) => {
        botao.addEventListener('click', () => {
            const modal = botao.closest('.modal');
            if (modal) {
                modal.classList.remove('active');
            }
        });
    });

    document.querySelectorAll('.modal').forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    const formCompra = document.getElementById('formCompra');
    if (formCompra) {
        formCompra.addEventListener('submit', async (event) => {
            event.preventDefault();

            const nome = document.getElementById('nome').value.trim();
            const telefone = document.getElementById('telefone').value.trim();
            const bilheteId = Number(document.getElementById('bilheteId').value);

            if (!nome || !telefone || !bilheteId) {
                mostrarToast('Preencha todos os campos obrigatórios.');
                return;
            }

            const vendedor = vendedores.find((item) =>
                (bilhetes[item.id] || []).some((bilhete) => Number(bilhete.id) === bilheteId)
            );
            const bilhete = vendedor && (bilhetes[vendedor.id] || []).find((item) => Number(item.id) === bilheteId);

            if (!vendedor || !bilhete || bilhete.status !== 'disponivel') {
                mostrarToast('Este bilhete não está disponível. Atualize a página e tente novamente.');
                return;
            }

            try {
                await enviarApi('reservar', {
                    bilhete_id: bilhete.id,
                    nome,
                    telefone
                });
            } catch (error) {
                mostrarToast(error.message || 'Não foi possível reservar o bilhete.');
                return;
            }

            bilhete.status = 'reservado';
            bilhete.nome_comprador = nome;
            bilhete.telefone_comprador = telefone;
            renderizarTudo();

            const modalCompra = document.getElementById('modalCompra');
            if (modalCompra) modalCompra.classList.remove('active');
            abrirModalPagamento(bilhete, vendedor);
            mostrarToast('Pagamento via Pix solicitado.');
        });
    }

    const btnConfirmarPagamento = document.getElementById('btnConfirmarPagamento');
    if (btnConfirmarPagamento) {
        btnConfirmarPagamento.addEventListener('click', async () => {
            if (!bilhetePagamentoAtual) return;

            btnConfirmarPagamento.disabled = true;
            try {
                await enviarApi('confirmar-pagamento', {
                    bilhete_id: bilhetePagamentoAtual
                });

                const bilhete = Object.values(bilhetes).flat().find((item) => Number(item.id) === Number(bilhetePagamentoAtual));
                if (bilhete) bilhete.status = 'pago';
                fecharModal('modalPix');
                renderizarTudo();
                mostrarToast('Pagamento confirmado e bilhete marcado como pago.');
            } catch (error) {
                mostrarToast(error.message || 'Não foi possível confirmar o pagamento.');
            } finally {
                btnConfirmarPagamento.disabled = false;
            }
        });
    }

}

async function enviarApi(action, dados, headersExtras = {}) {
    if (!supabaseClient || !RIFA_API_URL) {
        throw new Error('Configure a URL e a chave pública do Supabase em supabase-config.js.');
    }
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error('Faça login para continuar.');

    const response = await fetch(`${RIFA_API_URL}?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: CONFIG.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
            ...headersExtras
        },
        body: JSON.stringify(dados)
    });
    const resultado = await response.json();

    if (!response.ok || !resultado.success) {
        const error = new Error(resultado.message || 'Erro ao comunicar com o servidor.');
        error.status = response.status;
        throw error;
    }

    return resultado;
}

function gerarCodigoPix(chavePix, valor, identificador) {
    const campo = (id, conteudo) => `${id}${String(new TextEncoder().encode(String(conteudo)).length).padStart(2, '0')}${conteudo}`;
    const nomeRecebedor = CONFIG.NOME_RIFA.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').toUpperCase().slice(0, 25);
    const cidade = CONFIG.PIX_CITY.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').toUpperCase().slice(0, 15);
    const contaPix = campo('00', 'BR.GOV.BCB.PIX') + campo('01', String(chavePix).trim());
    const dadosAdicionais = campo('05', String(identificador).slice(0, 25));
    const valorFormatado = Number(valor).toFixed(2);

    let payload = '000201';
    payload += campo('01', '11');
    payload += campo('26', contaPix);
    payload += campo('52', '0000');
    payload += campo('53', '986');
    payload += campo('54', valorFormatado);
    payload += campo('58', 'BR');
    payload += campo('59', nomeRecebedor);
    payload += campo('60', cidade);
    payload += campo('62', dadosAdicionais);
    payload += '6304';

    return payload + calcularCrc16(payload);
}

function calcularCrc16(texto) {
    let crc = 0xFFFF;

    for (const byte of new TextEncoder().encode(texto)) {
        crc ^= byte << 8;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xFFFF;
        }
    }

    return crc.toString(16).toUpperCase().padStart(4, '0');
}

function gerarBilhetesImpressos() {
    const area = document.getElementById('ticketPrintArea');
    if (!area) return;

    const vendedoresParaImprimir = filtroVendedor
        ? vendedores.filter((vendedor) => String(vendedor.id) === String(filtroVendedor))
        : vendedores;

    const todosBilhetes = [];

    vendedoresParaImprimir.forEach((vendedor) => {
        const lista = (bilhetes[vendedor.id] || [])
            .filter((bilhete) => bilhete.tipo === 'impresso')
            .sort((a, b) => Number(a.numero) - Number(b.numero))
            .slice(0, CONFIG.BILHETES_IMPRESSOS_POR_VENDEDOR);
        lista.forEach((bilhete) => {
            todosBilhetes.push({
                ...bilhete,
                vendedorNome: vendedor.nome,
                vendedorId: vendedor.id
            });
        });
    });

    if (!todosBilhetes.length) {
        area.innerHTML = '<div class="empty-state">Nenhum bilhete disponível para impressão.</div>';
        return;
    }

    const html = `
        <div class="ticket-sheet">
            ${todosBilhetes.map((bilhete) => `
                <article class="ticket-card ${bilhete.tipo}">
                    <div class="ticket-card-header">
                        <span>${escaparHtml(configuracaoRifa.nome_rifa)}</span>
                        <span class="tag">${bilhete.tipo}</span>
                    </div>
                    ${configuracaoRifa.premio ? `<div class="ticket-prize">Prêmio: ${escaparHtml(configuracaoRifa.premio)}</div>` : ''}
                    <div class="ticket-card-number">${bilhete.numero}</div>
                    <div class="ticket-card-meta">
                        <span>Vendedor: ${bilhete.vendedorNome}</span>
                        <span>R$ ${CONFIG.VALOR_BILHETE.toFixed(2).replace('.', ',')}</span>
                    </div>
                    <div class="ticket-customer-fields">
                        <div class="ticket-customer-field">
                            <span>Nome:</span>
                            <span class="ticket-fill">${escaparHtml(bilhete.nome_comprador || '')}</span>
                        </div>
                        <div class="ticket-customer-field">
                            <span>Telefone:</span>
                            <span class="ticket-fill">${escaparHtml(bilhete.telefone_comprador || '')}</span>
                        </div>
                    </div>
                </article>
            `).join('')}
        </div>
    `;

    area.innerHTML = html;
    area.style.display = 'block';
}

function escaparHtml(valor) {
    return String(valor).replace(/[&<>"']/g, (caractere) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[caractere]);
}

function mostrarToast(mensagem) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = mensagem;
    toast.classList.add('show');

    clearTimeout(mostrarToast.timer);
    mostrarToast.timer = setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
}

function copiarPix() {
    const pixKey = document.getElementById('pixKey');
    if (!pixKey) return;

    pixKey.select();
    document.execCommand('copy');
    mostrarToast('Código Pix copiado!');
}

window.fecharModal = fecharModal;
window.copiarPix = copiarPix;
