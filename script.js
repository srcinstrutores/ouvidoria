const SUPABASE_URL = 'https://mhssvjeklhqyauzbvntf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oc3N2amVrbGhxeWF1emJ2bnRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTQwMDUsImV4cCI6MjA4ODIzMDAwNX0.p8gD3cmLBpiACGwbv8SCA315QV_3CwNdlHWZAFAwc-c';

// URL DO GOOGLE APPS SCRIPT (SUBSTITUA PELA SUA)
const URL_SCRIPT = 'https://script.google.com/macros/s/AKfycbwjBk9m9_6HLLsrN-2_FJYX8PgvX04ZPXgrjCKPQCru8M4f0reJ8Otuvcp_zZIuG1YR/exec';
const ID_TOPICO_FORUM = '1';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let usuarioAtual = {
    nick: '',
    cargo: '',
    isLideranca: false,
    podeAdministrar: false
};

let propostas = [];
let logAcoes = [];
let tipoSelecionado = 'Projeto';
let abaAtual = 'todos';
let paginaAtual = 1;
const ITENS_POR_PAGINA = 10;
let nickPrincipal = '';
let subscription = null;

// ==================== INICIALIZAÇÃO ====================

async function pegarUsernameForum() {
    try {
        const resposta = await fetch("/forum");
        const html = await resposta.text();
        const regex = /_userdata\["username"\]\s*=\s*"([^"]+)"/;
        const match = html.match(regex);

        if (match && match[1]) {
            const username = match[1];
            localStorage.setItem("forumUser", username);
            return username;
        }
        throw new Error('Não autenticado');
    } catch (err) {
        const fallback = localStorage.getItem("forumUser");
        if (fallback) return fallback;
        showToast('Erro', 'Você precisa estar logado no fórum', 'error');
        throw err;
    }
}

async function buscarCargo(nick) {
    try {
        const response = await fetch(`${URL_SCRIPT}?acao=listarMembros`);
        const dados = await response.json();
        
        if (dados.sucesso && dados.membros) {
            const membro = dados.membros.find(m => 
                m.nick && m.nick.toLowerCase() === nick.toLowerCase()
            );
            
            if (membro) {
                return {
                    nick: membro.nick,
                    cargo: membro.cargo,
                    cargoOriginal: membro.cargoOriginal,
                    isLideranca: ['lider', 'vice-lider'].includes(membro.cargo.toLowerCase())
                };
            }
        }
        return { nick: nick, cargo: 'membro', cargoOriginal: 'Membro', isLideranca: false };
    } catch (err) {
        return { nick: nick, cargo: 'membro', cargoOriginal: 'Membro', isLideranca: false };
    }
}

async function inicializarSistema() {
    showToast('Carregando', 'Verificando permissões...', 'info');
    
    try {
        const nick = await pegarUsernameForum();
        const dadosUsuario = await buscarCargo(nick);
        
        usuarioAtual = {
            nick: nick,
            cargo: dadosUsuario.cargoOriginal,
            isLideranca: dadosUsuario.isLideranca,
            podeAdministrar: dadosUsuario.isLideranca
        };

        verificarPermissoesUI();
        
        await carregarPropostas();
        await carregarLogs();
        iniciarRealtime();
        
        // Preenche campos
        const firstNick = document.querySelector('.nick-input');
        if (firstNick) {
            firstNick.value = nick;
            atualizarNickPrincipal(nick);
        }
        
        const atualizacaoNick = document.getElementById('atualizacaoNick');
        if (atualizacaoNick) atualizacaoNick.value = nick;

        showToast('Bem-vindo', `${nick} - ${dadosUsuario.cargoOriginal}`, 'success');
        
    } catch (err) {
        usuarioAtual = { nick: 'Visitante', cargo: 'Visitante', isLideranca: false, podeAdministrar: false };
        verificarPermissoesUI();
        await carregarPropostas();
    }
}

function verificarPermissoesUI() {
    // Remove botões de admin se não for liderança
    const elementosAdmin = [
        'btnPendentes',
        'badgePendentes',
        'atualizacaoPanel',
        'logPanel',
        'pendentesPanel'
    ];
    
    elementosAdmin.forEach(id => {
        const el = document.getElementById(id);
        if (el && !usuarioAtual.podeAdministrar) {
            if (id === 'btnPendentes' || id === 'badgePendentes') {
                el.style.display = 'none';
            } else {
                el.remove();
            }
        }
    });

    // Esconde botões de atualização e log
    const btnAtualizar = document.querySelector('button[onclick="toggleAtualizacao()"]');
    const btnLog = document.querySelector('button[onclick="toggleLog()"]');
    
    if (btnAtualizar && !usuarioAtual.podeAdministrar) btnAtualizar.style.display = 'none';
    if (btnLog && !usuarioAtual.podeAdministrar) btnLog.style.display = 'none';
}

// ==================== SUPABASE - OPERAÇÕES ====================

async function carregarPropostas() {
    try {
        const { data, error } = await supabaseClient
            .from('ouvidoria')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        propostas = (data || []).map(p => ({
            id: p.id,
            ordem: p.ordem,
            nick: p.nick,
            tipo: p.tipo,
            tema: p.tema,
            descricao: p.descricao,
            bbcode: p.bbcode || '',
            veredito: p.veredito || 'Pendente',
            data: formatarDataISO(p.created_at),
            isAtualizacao: p.is_atualizacao || false,
            tagAtualizacao: p.tag_atualizacao || '',
            forumPostado: p.forum_postado,
            planilhaSync: p.planilha_sync
        }));

        atualizarBadgePendentes();
        renderizarPropostas();
        
    } catch (err) {
        showToast('Erro', 'Falha ao carregar propostas', 'error');
    }
}

async function salvarNoSupabase(dados, isAtualizacao = false) {
    try {
        const insertData = {
            ordem: dados.ordem,
            nick: dados.nick,
            tipo: isAtualizacao ? 'Atualização' : dados.tipo,
            tema: isAtualizacao ? dados.tema : dados.tema,
            descricao: isAtualizacao ? dados.descricao : dados.descricao,
            bbcode: dados.bbcode || '',
            veredito: isAtualizacao ? 'Atualização' : 'Pendente',
            criado_por: usuarioAtual.nick,
            is_atualizacao: isAtualizacao,
            tag_atualizacao: isAtualizacao ? dados.tag : null
        };

        const { data, error } = await supabaseClient
            .from('ouvidoria')
            .insert([insertData])
            .select();

        if (error) throw error;
        return data[0];
    } catch (err) {
        throw err;
    }
}

async function atualizarVereditoSupabase(id, novoVeredito) {
    try {
        const { error } = await supabaseClient
            .from('ouvidoria')
            .update({ veredito: novoVeredito })
            .eq('id', id);

        if (error) throw error;
    } catch (err) {
        throw err;
    }
}

async function inserirLog(acao, detalhes, propostaId = null) {
    try {
        await supabaseClient
            .from('ouvidoria_logs')
            .insert([{
                acao: acao,
                detalhes: detalhes,
                proposta_id: propostaId,
                usuario: usuarioAtual.nick,
                cargo: usuarioAtual.cargo
            }]);
    } catch (err) {
        console.error('Erro ao inserir log:', err);
    }
}

async function carregarLogs() {
    if (!usuarioAtual.podeAdministrar) return;
    
    try {
        const { data, error } = await supabaseClient
            .from('ouvidoria_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        logAcoes = (data || []).map(l => ({
            id: l.id,
            acao: l.acao,
            detalhes: l.detalhes,
            propostaId: l.proposta_id,
            usuario: l.usuario,
            cargo: l.cargo,
            data: formatarDataISO(l.created_at)
        }));

        renderizarLog();
    } catch (err) {
        console.error('Erro ao carregar logs:', err);
    }
}

// ==================== PLANILHA ====================

async function enviarParaPlanilha(dados, isAtualizacao = false) {
    try {
        const payload = {
            acao: isAtualizacao ? 'criarAtualizacao' : 'criarProposta',
            ...dados,
            criadoPor: usuarioAtual.nick
        };

        await fetch(URL_SCRIPT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            mode: 'no-cors'
        });

        return { sucesso: true };
    } catch (err) {
        console.error('Erro planilha:', err);
        return { sucesso: false };
    }
}

async function atualizarVereditoPlanilha(ordem, novoVeredito) {
    try {
        await fetch(URL_SCRIPT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                acao: 'atualizarVeredito',
                ordem: ordem,
                veredito: novoVeredito,
                atualizadoPor: usuarioAtual.nick
            }),
            mode: 'no-cors'
        });
        return { sucesso: true };
    } catch (err) {
        return { sucesso: false };
    }
}

// ==================== FÓRUM ====================

async function postarNoForum(titulo, mensagem) {
    return new Promise((resolve, reject) => {
        function fazerPostagem() {
            const formData = new FormData();
            formData.append('t', ID_TOPICO_FORUM);
            formData.append('mode', 'reply');
            formData.append('subject', titulo);
            formData.append('message', mensagem);
            formData.append('post', 'Enviar');

            $.ajax({
                url: '/post',
                type: 'POST',
                data: formData,
                processData: false,
                contentType: false,
                success: resolve,
                error: (xhr, status, error) => reject(new Error(`Erro: ${status}`))
            });
        }

        if (typeof $ === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js';
            script.onload = fazerPostagem;
            script.onerror = () => reject(new Error('Falha ao carregar jQuery'));
            document.head.appendChild(script);
        } else {
            fazerPostagem();
        }
    });
}

function gerarBBCodeProposta(proposta) {
    const checkboxProjeto = proposta.tipo === 'Projeto' ? '(X)' : '(  )';
    const checkboxSugestao = proposta.tipo === 'Sugestão' ? '(X)' : '(  )';
    const checkboxAlteracao = proposta.tipo === 'Correção/Alteração' ? '(X)' : '(  )';
    
    const bbcodeSpoiler = proposta.bbcode ? `[spoiler="BBCode Original"]${proposta.bbcode}[/spoiler]` : '';
    
    return `[b]Nick:[/b] ${proposta.nick}
[b]Número de ordem:[/b] ${proposta.ordem}
${checkboxProjeto} Projeto ${checkboxSugestao} Sugestão ${checkboxAlteracao} Alteração/Correção
[b]Tema:[/b] ${proposta.tema}

[b]Descrição:[/b]
${proposta.descricao}

${bbcodeSpoiler}`;
}

function gerarBBCodeAtualizacao(tag, nick) {
    return `[center][table bgcolor="005fb2" style="border-radius: 14px; overflow: hidden; width: 80%; box-shadow: 0 1px 2px #f233be;"][tr][td][color=#f8f8ff][img(45px,45px)]https://www.habbo.com.br/habbo-imaging/badge/b09064s43084s50134eda71d18c813ca341e7e285475586bf5.gif[/img]

[size=13][font=Poppins][b][SRC] Atualização realizada! ${tag}[/size]

[size=11]Foi realizada uma atualização neste horário, em caso de erros, consulte um membro da Liderança.[/b][/font][/size][/color][/td][/tr][/table][/center]`;
}

// ==================== FUNÇÕES PRINCIPAIS ====================

async function enviarProposta() {
    const nicks = obterTodosNicks();
    const ordemInput = document.getElementById('ordemInput');
    const temaInput = document.getElementById('temaInput');
    const descricaoInput = document.getElementById('descricaoInput');
    const bbcodeInput = document.getElementById('bbcodeInput');
    
    const ordem = ordemInput?.value.trim();
    const tema = temaInput?.value.trim();
    const descricao = descricaoInput?.value.trim();
    const bbcode = bbcodeInput?.value.trim();

    if (!nicks || !ordem || !tema || !descricao) {
        showToast('Erro', 'Preencha todos os campos obrigatórios', 'error');
        return;
    }

    const proposta = {
        ordem: ordem,
        nick: nicks,
        tipo: tipoSelecionado,
        tema: tema,
        descricao: descricao,
        bbcode: bbcode || '',
        data: formatarData()
    };

    try {
        showToast('Enviando', 'Salvando no Supabase...', 'info');
        await salvarNoSupabase(proposta, false);
        
        showToast('Enviando', 'Salvando na Planilha...', 'info');
        await enviarParaPlanilha(proposta, false);
        
        showToast('Enviando', 'Postando no Fórum...', 'info');
        const titulo = `[Ouvidoria] Proposta #${ordem} - ${tema}`;
        const mensagem = gerarBBCodeProposta(proposta);
        
        try {
            await postarNoForum(titulo, mensagem);
            showToast('Sucesso', 'Postagem realizada!', 'success');
        } catch (forumErr) {
            showToast('Aviso', 'Salvo, mas falha no fórum', 'warning');
        }
        
        await inserirLog('CRIAR_PROPOSTA', `Criou proposta #${ordem}`, null);
        
        limparFormulario();
        toggleForm();
        await carregarPropostas();
        
        showToast('Sucesso', 'Proposta enviada!', 'success');
        
    } catch (err) {
        showToast('Erro', 'Falha ao enviar: ' + err.message, 'error');
    }
}

async function postarAtualizacao() {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Apenas Liderança pode atualizar', 'error');
        return;
    }

    const tagInput = document.getElementById('atualizacaoTag');
    const nickInput = document.getElementById('atualizacaoNick');
    
    const tag = tagInput?.value.trim();
    const nick = nickInput?.value.trim();
    
    if (!tag) {
        showToast('Erro', 'Digite sua TAG', 'error');
        return;
    }

    const atualizacao = {
        ordem: 'UPD',
        nick: nick,
        tag: tag,
        tema: `Atualização de ${tag}`,
        descricao: `Atualização postada por ${tag} ${nick}`,
        data: formatarData()
    };

    try {
        showToast('Enviando', 'Salvando atualização...', 'info');
        
        await salvarNoSupabase(atualizacao, true);
        await enviarParaPlanilha(atualizacao, true);
        
        const titulo = `[Ouvidoria] Atualização - ${new Date().toLocaleDateString('pt-BR')}`;
        const mensagem = gerarBBCodeAtualizacao(tag, nick);
        
        try {
            await postarNoForum(titulo, mensagem);
        } catch (e) {
            console.error('Erro fórum:', e);
        }
        
        await inserirLog('ATUALIZACAO_OUVIDORIA', `Postou atualização como ${tag}`, null);
        
        toggleAtualizacao();
        await carregarPropostas();
        
        showToast('Sucesso', 'Atualização postada!', 'success');
        
    } catch (err) {
        showToast('Erro', 'Falha ao postar atualização', 'error');
    }
}

async function alterarVeredito(id, novoVeredito) {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Sem permissão', 'error');
        return;
    }

    const proposta = propostas.find(p => p.id === id);
    if (!proposta) return;

    try {
        await atualizarVereditoSupabase(id, novoVeredito);
        await atualizarVereditoPlanilha(proposta.ordem, novoVeredito);
        
        // Posta no fórum
        const titulo = `[Ouvidoria] Veredito - Proposta #${proposta.ordem}`;
        const mensagem = `[b]Veredito Alterado[/b]
        
[b]Ordem:[/b] #${proposta.ordem}
[b]Tema:[/b] ${proposta.tema}
[b]Nick:[/b] ${proposta.nick}
[b]Novo Veredito:[/b] ${novoVeredito}
[b]Alterado por:[/b] ${usuarioAtual.nick} (${usuarioAtual.cargo})`;
        
        try {
            await postarNoForum(titulo, mensagem);
        } catch (e) {
            console.error('Erro ao postar veredito:', e);
        }
        
        await inserirLog('ALTERAR_VEREDITO', `Alterou veredito de #${proposta.ordem} para ${novoVeredito}`, id);
        
        proposta.veredito = novoVeredito;
        showToast('Sucesso', `Veredito alterado para ${novoVeredito}`, 'success');
        atualizarBadgePendentes();
        renderizarPropostas();
        
    } catch (err) {
        showToast('Erro', 'Falha ao alterar veredito', 'error');
    }
}

// ==================== RENDERIZAÇÃO ====================

function renderizarPropostas() {
    const container = document.getElementById('propostasList');
    const countEl = document.getElementById('countPropostas');
    
    if (!container) return;

    const listaCompleta = obterPropostasFiltradas();
    const totalItens = listaCompleta.length;
    
    const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
    const fim = inicio + ITENS_POR_PAGINA;
    const lista = listaCompleta.slice(inicio, fim);
    
    if (countEl) countEl.textContent = `${totalItens} registro${totalItens !== 1 ? 's' : ''}`;

    renderizarPaginacao(totalItens);

    if (lista.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-inbox"></i>
                <p>Nenhuma proposta encontrada</p>
            </div>
        `;
        return;
    }

    container.innerHTML = lista.map(p => {
        if (p.isAtualizacao) {
            return renderizarAtualizacao(p);
        }
        return renderizarPropostaNormal(p);
    }).join('');
}

function renderizarAtualizacao(p) {
    return `
        <div class="atualizacao-item-simples">
            <div class="atualizacao-icon">
                <i class="fa-solid fa-rotate"></i>
            </div>
            <div class="atualizacao-conteudo">
                <div class="atualizacao-tag-texto">${p.tagAtualizacao}</div>
                <div class="atualizacao-nick-texto">${p.nick}</div>
                <div class="atualizacao-data-texto">${p.data}</div>
            </div>
        </div>
    `;
}

function renderizarPropostaNormal(p) {
    const avataresHTML = gerarAvataresHTML(p.nick, p.id);
    
    const vereditoHTML = usuarioAtual.podeAdministrar ? `
        <div class="veredito-dropdown" data-proposta-id="${p.id}">
            <div class="veredito-trigger" onclick="toggleVereditoDropdown(event, ${p.id})">
                <div class="veredito-dot ${p.veredito.toLowerCase().replace(/\s+/g, '')}"></div>
                <span>${p.veredito}</span>
                <i class="fa-solid fa-chevron-down" style="font-size: 10px;"></i>
            </div>
            <div class="veredito-menu">
                <div class="veredito-option pendente" onclick="selecionarVeredito(event, ${p.id}, 'Pendente')">
                    <i class="fa-solid fa-clock"></i> Pendente
                </div>
                <div class="veredito-option aprovado" onclick="selecionarVeredito(event, ${p.id}, 'Aprovado')">
                    <i class="fa-solid fa-check-circle"></i> Aprovado
                </div>
                <div class="veredito-option alteracao" onclick="selecionarVeredito(event, ${p.id}, 'Aprovado com alteração')">
                    <i class="fa-solid fa-edit"></i> Com Alteração
                </div>
                <div class="veredito-option reprovado" onclick="selecionarVeredito(event, ${p.id}, 'Reprovado')">
                    <i class="fa-solid fa-times-circle"></i> Reprovado
                </div>
            </div>
        </div>
    ` : `
        <div style="display: flex; align-items: center; gap: 6px;">
            <div class="veredito-dot ${p.veredito.toLowerCase().replace(/\s+/g, '')}"></div>
            <span style="font-size: 11px; color: var(--text-secondary);">${p.veredito}</span>
        </div>
    `;

    return `
        <div class="proposta-item" id="proposta-${p.id}">
            <div class="proposta-header" onclick="toggleProposta(${p.id}, event)">
                ${avataresHTML}
                <div class="proposta-info">
                    <div class="proposta-nick">${p.nick}</div>
                    <div class="proposta-meta">
                        <span><i class="fa-regular fa-clock"></i> ${p.data}</span>
                        <span class="proposta-tipo tipo-projeto">
                            <i class="fa-solid fa-hashtag"></i> Ordem ${p.ordem}
                        </span>
                    </div>
                    <div class="proposta-tema">${p.tema}</div>
                    <div class="proposta-status">
                        ${vereditoHTML}
                    </div>
                </div>
                <button class="proposta-expand" title="Expandir/Recolher">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
            </div>
            <div class="proposta-content" style="display: none;">
                <div class="proposta-detalhes">
                    <div class="proposta-tema-full">
                        <i class="fa-solid fa-heading"></i>
                        <strong>Tema:</strong> ${p.tema}
                    </div>
                    <div class="proposta-descricao-full">
                        <i class="fa-solid fa-align-left"></i>
                        <strong>Descrição:</strong>
                        <div class="descricao-texto">${formatarDescricao(p.descricao)}</div>
                    </div>
                    ${p.bbcode ? `
                    <div class="proposta-bbcode-section">
                        <div class="descricao-label">
                            <i class="fa-solid fa-code"></i> BBCode Original
                        </div>
                        <div class="code-viewer">
                            <div class="code-header">
                                <div class="code-header-left">
                                    <div class="code-dots">
                                        <div class="code-dot red"></div>
                                        <div class="code-dot yellow"></div>
                                        <div class="code-dot green"></div>
                                    </div>
                                    <span class="code-title">bbcode.txt</span>
                                </div>
                                <div class="code-actions">
                                    <button class="code-btn" onclick="copiarBBCode('${p.id}')">
                                        <i class="fa-regular fa-copy"></i> Copiar
                                    </button>
                                </div>
                            </div>
                            <div class="code-body" id="code-body-${p.id}">
                                <div class="code-content" id="bbcode-content-${p.id}">${escapeHtml(p.bbcode)}</div>
                                <div class="code-expand-bar">
                                    <button class="btn-toggle-code" onclick="toggleCode('${p.id}')">
                                        <i class="fa-solid fa-chevron-down"></i> <span id="btn-text-${p.id}">Expandir</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                </div>
                <div class="proposta-footer">
                    <span class="proposta-id">ID: ${p.id}</span>
                    <span class="proposta-ordem-final">Ordem #${p.ordem}</span>
                </div>
            </div>
        </div>
    `;
}

function formatarDescricao(descricao) {
    // Converte tags HTML de formatação para exibição
    return descricao
        .replace(/<b>(.*?)<\/b>/g, '<strong>$1</strong>')
        .replace(/<u>(.*?)<\/u>/g, '<u>$1</u>')
        .replace(/<spoiler>(.*?)<\/spoiler>/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>')
        .replace(/<img src="(.*?)"\/?>/g, '<img src="$1" style="max-width:100%;border-radius:8px;" />')
        .replace(/<video src="(.*?)" controls\/?>/g, '<video src="$1" controls style="max-width:100%;border-radius:8px;"></video>');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function obterPropostasFiltradas() {
    let lista = [...propostas];
    
    if (abaAtual === 'meus') {
        lista = lista.filter(p => p.nick.toLowerCase().includes(usuarioAtual.nick.toLowerCase()));
    } else if (abaAtual === 'pendentes') {
        lista = lista.filter(p => p.veredito === 'Pendente' && !p.isAtualizacao);
    } else if (abaAtual === 'pesquisar') {
        const searchNick = document.getElementById('searchNick')?.value.toLowerCase() || '';
        const searchOrdem = document.getElementById('searchOrdem')?.value.toLowerCase() || '';
        const searchTema = document.getElementById('searchTema')?.value.toLowerCase() || '';
        
        lista = lista.filter(p => {
            const matchNick = !searchNick || p.nick.toLowerCase().includes(searchNick);
            const matchOrdem = !searchOrdem || p.ordem.toLowerCase().includes(searchOrdem);
            const matchTema = !searchTema || p.tema.toLowerCase().includes(searchTema);
            return matchNick && matchOrdem && matchTema;
        });
    }
    
    return lista;
}

// ==================== UI INTERAÇÕES ====================

function toggleForm() {
    const form = document.getElementById('formContainer');
    if (!form) return;
    
    form.classList.toggle('active');
    
    if (form.classList.contains('active')) {
        const ordemInput = document.getElementById('ordemInput');
        if (ordemInput) ordemInput.value = gerarProximaOrdem();
        
        setTimeout(() => {
            const firstNick = document.querySelector('.nick-input');
            if (firstNick) firstNick.focus();
        }, 100);
    }
}

function toggleAtualizacao() {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Apenas Liderança pode atualizar', 'error');
        return;
    }
    
    const panel = document.getElementById('atualizacaoPanel');
    if (!panel) return;
    
    panel.classList.toggle('active');
    
    if (panel.classList.contains('active')) {
        const tagInput = document.getElementById('atualizacaoTag');
        if (tagInput) setTimeout(() => tagInput.focus(), 100);
    }
}

function togglePendentes() {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Sem permissão', 'error');
        return;
    }
    
    const panel = document.getElementById('pendentesPanel');
    if (!panel) return;
    
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) renderizarPendentes();
}

function toggleLog() {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Sem permissão', 'error');
        return;
    }
    
    const panel = document.getElementById('logPanel');
    if (!panel) return;
    
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) renderizarLog();
}

function toggleProposta(id, event) {
    if (event && (event.target.closest('.btn') || event.target.closest('.veredito-dropdown'))) {
        return;
    }
    
    const item = document.getElementById(`proposta-${id}`);
    if (!item) return;
    
    const content = item.querySelector('.proposta-content');
    const expandBtn = item.querySelector('.proposta-expand i');
    
    if (!content) return;
    
    const isExpanded = content.style.display === 'block';
    
    if (isExpanded) {
        content.style.display = 'none';
        if (expandBtn) expandBtn.style.transform = 'rotate(0deg)';
    } else {
        content.style.display = 'block';
        if (expandBtn) expandBtn.style.transform = 'rotate(180deg)';
    }
}

function toggleCode(id) {
    const body = document.getElementById(`code-body-${id}`);
    const btnText = document.getElementById(`btn-text-${id}`);
    
    if (body.classList.contains('expanded')) {
        body.classList.remove('expanded');
        btnText.textContent = 'Expandir';
    } else {
        body.classList.add('expanded');
        btnText.textContent = 'Recolher';
    }
}

function copiarBBCode(id) {
    const proposta = propostas.find(p => p.id.toString() === id);
    if (proposta && proposta.bbcode) {
        navigator.clipboard.writeText(proposta.bbcode).then(() => {
            showToast('Copiado!', 'BBCode copiado para a área de transferência', 'success');
        });
    }
}

function toggleVereditoDropdown(event, propostaId) {
    event.stopPropagation();
    
    document.querySelectorAll('.veredito-dropdown').forEach(el => {
        if (el.dataset.propostaId != propostaId) {
            el.classList.remove('active');
        }
    });
    
    const dropdown = event.currentTarget.closest('.veredito-dropdown');
    if (dropdown) dropdown.classList.toggle('active');
}

function selecionarVeredito(event, propostaId, novoVeredito) {
    event.stopPropagation();
    alterarVeredito(propostaId, novoVeredito);
    
    const dropdown = event.currentTarget.closest('.veredito-dropdown');
    if (dropdown) dropdown.classList.remove('active');
}

// ==================== HELPERS ====================

function gerarProximaOrdem() {
    // Filtra apenas propostas normais (não atualizações)
    const propostasNormais = propostas.filter(p => !p.isAtualizacao && p.ordem !== 'UPD');
    if (propostasNormais.length === 0) return '001';
    
    const ordens = propostasNormais
        .map(p => parseInt(p.ordem))
        .filter(o => !isNaN(o));
    
    const maxOrdem = Math.max(...ordens, 0);
    return String(maxOrdem + 1).padStart(3, '0');
}

function obterTodosNicks() {
    const inputs = document.querySelectorAll('.nick-input');
    const nicks = Array.from(inputs).map(input => input.value.trim()).filter(v => v);
    return nicks.join(', ');
}

function atualizarNickPrincipal(valor) {
    nickPrincipal = valor;
}

function adicionarNick() {
    const container = document.getElementById('nicksContainer');
    if (!container) return;
    
    const row = document.createElement('div');
    row.className = 'nick-row';
    row.innerHTML = `
        <div class="nick-input-wrapper">
            <i class="fa-solid fa-user"></i>
            <input type="text" class="nick-input" placeholder="Ex: OutroNick">
        </div>
        <button type="button" class="btn-remove-nick" onclick="removerNick(this)" title="Remover nick">
            <i class="fa-solid fa-trash"></i>
        </button>
    `;
    container.appendChild(row);
    row.querySelector('input').focus();
}

function removerNick(btn) {
    const row = btn.closest('.nick-row');
    if (row) row.remove();
}

function selectTipo(element, tipo) {
    document.querySelectorAll('.tipo-option').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    tipoSelecionado = tipo;
    const tipoInput = document.getElementById('tipoProposta');
    if (tipoInput) tipoInput.value = tipo;
}

function mudarAba(aba, btn) {
    abaAtual = aba;
    paginaAtual = 1;
    
    document.querySelectorAll('.nav-tabs .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const searchPanel = document.getElementById('searchPanel');
    if (searchPanel) {
        searchPanel.classList.toggle('active', aba === 'pesquisar');
    }
    
    renderizarPropostas();
}

function filtrarPropostas() {
    if (abaAtual !== 'pesquisar') return;
    paginaAtual = 1;
    renderizarPropostas();
}

function gerarAvataresHTML(nicksString, propostaId) {
    const nicks = nicksString.split(',').map(n => n.trim()).filter(n => n);
    const maxAvataresVisiveis = 3;
    
    let html = `<div class="proposta-avatars" onclick="abrirModalAutores('${nicksString}', ${propostaId})">`;
    
    nicks.slice(0, maxAvataresVisiveis).forEach((nick, index) => {
        const zIndex = maxAvataresVisiveis - index;
        html += `
            <div class="proposta-avatar" style="z-index: ${zIndex};" title="${nick}">
                <img src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(nick)}&headonly=0&size=b&gesture=sml&direction=2&head_direction=2" 
                     alt="${nick}" 
                     onerror="this.src='https://www.habbo.com.br/habbo-imaging/avatarimage?user=habbo&headonly=0&size=b'">
            </div>
        `;
    });
    
    if (nicks.length > maxAvataresVisiveis) {
        const restantes = nicks.length - maxAvataresVisiveis;
        html += `<div class="avatar-more">+${restantes}</div>`;
    }
    
    html += '</div>';
    return html;
}

function abrirModalAutores(nicksString, propostaId) {
    const modal = document.getElementById('autoresModal');
    const modalBody = document.getElementById('modalBody');
    const modalTitle = document.getElementById('modalTitle');
    const modalCount = document.getElementById('modalCount');
    
    if (!modal || !modalBody) return;
    
    const nicks = nicksString.split(',').map(n => n.trim()).filter(n => n);
    const proposta = propostas.find(p => p.id === propostaId);
    
    if (modalTitle) modalTitle.textContent = `Autores - Ordem #${proposta ? proposta.ordem : ''}`;
    if (modalCount) modalCount.innerHTML = `<strong>${nicks.length}</strong> autor${nicks.length !== 1 ? 'es' : ''}`;
    
    let html = '<div class="autores-grid">';
    nicks.forEach(nick => {
        const isCurrentUser = nick.toLowerCase() === usuarioAtual.nick.toLowerCase();
        html += `
            <div class="autor-card" onclick="copiarNick('${nick}')">
                <div class="autor-avatar">
                    <img src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(nick)}&headonly=0&size=b&gesture=sml&direction=2&head_direction=2" 
                         alt="${nick}">
                </div>
                <div class="autor-nick">${nick}</div>
                ${isCurrentUser ? '<div class="autor-badge"><i class="fa-solid fa-user-check"></i> Você</div>' : ''}
            </div>
        `;
    });
    html += '</div>';
    
    modalBody.innerHTML = html;
    modal.classList.add('active');
}

function fecharModalAutores(event) {
    if (event && event.target !== event.currentTarget && !event.target.closest('.modal-close')) return;
    const modal = document.getElementById('autoresModal');
    if (modal) modal.classList.remove('active');
}

function copiarNick(nick) {
    navigator.clipboard.writeText(nick).then(() => {
        showToast('Copiado!', `Nick "${nick}" copiado`, 'success');
    });
}

function renderizarPendentes() {
    const container = document.getElementById('pendentesList');
    const countEl = document.getElementById('pendentesCount');
    
    if (!container || !countEl) return;
    
    const pendentes = propostas.filter(p => p.veredito === 'Pendente' && !p.isAtualizacao);
    
    countEl.textContent = pendentes.length;
    
    if (pendentes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-check-circle"></i>
                <p>Não há propostas pendentes</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = pendentes.map(p => {
        const primeiroNick = p.nick.split(',')[0].trim();
        return `
            <div class="pendente-item">
                <div class="pendente-info">
                    <div class="pendente-avatar">
                        <img src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(primeiroNick)}&headonly=0&size=b" 
                             alt="${primeiroNick}">
                    </div>
                    <div class="pendente-detalhes">
                        <div class="pendente-tema">Ordem #${p.ordem}</div>
                        <div class="pendente-meta">
                            <span><i class="fa-solid fa-user"></i> ${p.nick}</span>
                        </div>
                    </div>
                </div>
                <div class="pendente-actions">
                    <button class="btn btn-success btn-sm" onclick="alterarVeredito(${p.id}, 'Aprovado')">
                        <i class="fa-solid fa-check"></i>
                    </button>
                    <button class="btn btn-warning btn-sm" onclick="alterarVeredito(${p.id}, 'Aprovado com alteração')">
                        <i class="fa-solid fa-edit"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="alterarVeredito(${p.id}, 'Reprovado')">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function atualizarBadgePendentes() {
    const badge = document.getElementById('badgePendentes');
    if (!badge) return;
    
    const count = propostas.filter(p => p.veredito === 'Pendente' && !p.isAtualizacao).length;
    badge.textContent = count;
    badge.style.display = (count === 0 || !usuarioAtual.podeAdministrar) ? 'none' : 'inline-flex';
}

function renderizarLog() {
    const container = document.getElementById('logList');
    if (!container) return;
    
    if (logAcoes.length === 0) {
        container.innerHTML = `
            <div class="log-empty">
                <i class="fa-solid fa-clipboard-list"></i>
                <p>Nenhuma ação registrada</p>
            </div>
        `;
        return;
    }

    container.innerHTML = logAcoes.map(log => {
        let iconClass = 'update';
        let icon = 'fa-pen';
        
        switch(log.acao) {
            case 'CRIAR_PROPOSTA':
                iconClass = 'create';
                icon = 'fa-plus';
                break;
            case 'ALTERAR_VEREDITO':
                iconClass = 'veredito';
                icon = 'fa-gavel';
                break;
            case 'ATUALIZACAO_OUVIDORIA':
                iconClass = 'update';
                icon = 'fa-rotate';
                break;
        }

        return `
            <div class="log-item">
                <div class="log-icon ${iconClass}">
                    <i class="fa-solid ${icon}"></i>
                </div>
                <div class="log-content">
                    <div class="log-text">${log.detalhes}</div>
                    <div class="log-meta">
                        <span><i class="fa-solid fa-user"></i> ${log.cargo} ${log.usuario}</span>
                        <span>•</span>
                        <span><i class="fa-regular fa-clock"></i> ${log.data}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderizarPaginacao(totalItens) {
    const pagination = document.getElementById('pagination');
    if (!pagination) return;
    
    const totalPaginas = Math.ceil(totalItens / ITENS_POR_PAGINA);
    
    if (totalPaginas <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let html = `<span class="pagination-info">Página ${paginaAtual} de ${totalPaginas}</span>`;
    
    html += `<button class="pagination-btn" onclick="mudarPagina(${paginaAtual - 1})" ${paginaAtual === 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i>
    </button>`;
    
    for (let i = 1; i <= totalPaginas; i++) {
        if (i === 1 || i === totalPaginas || (i >= paginaAtual - 1 && i <= paginaAtual + 1)) {
            html += `<button class="pagination-btn ${i === paginaAtual ? 'active' : ''}" onclick="mudarPagina(${i})">${i}</button>`;
        } else if (i === paginaAtual - 2 || i === paginaAtual + 2) {
            html += `<span class="pagination-ellipsis">...</span>`;
        }
    }
    
    html += `<button class="pagination-btn" onclick="mudarPagina(${paginaAtual + 1})" ${paginaAtual === totalPaginas ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-right"></i>
    </button>`;
    
    pagination.innerHTML = html;
}

function mudarPagina(novaPagina) {
    const lista = obterPropostasFiltradas();
    const totalPaginas = Math.ceil(lista.length / ITENS_POR_PAGINA);
    
    if (novaPagina < 1 || novaPagina > totalPaginas) return;
    
    paginaAtual = novaPagina;
    renderizarPropostas();
    
    const tableCard = document.querySelector('.table-card');
    if (tableCard) tableCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function iniciarRealtime() {
    if (!usuarioAtual.podeAdministrar) return;
    
    subscription = supabaseClient
        .channel('ouvidoria-changes')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'ouvidoria' }, 
            (payload) => {
                console.log('Mudança detectada:', payload);
                carregarPropostas();
                
                const pendentesPanel = document.getElementById('pendentesPanel');
                if (pendentesPanel && pendentesPanel.classList.contains('active')) {
                    renderizarPendentes();
                }
            }
        )
        .subscribe();
}

// ==================== FORMATAÇÃO DE TEXTO ====================

function formatText(command) {
    const textarea = document.getElementById('descricaoInput');
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);
    
    let replacement = selected;
    if (command === 'bold') replacement = `<b>${selected || 'negrito'}</b>`;
    else if (command === 'underline') replacement = `<u>${selected || 'sublinhado'}</u>`;
    
    textarea.value = text.substring(0, start) + replacement + text.substring(end);
    textarea.focus();
}

function insertSpoiler() {
    insertAtCursor('<spoiler>texto</spoiler>', 'descricaoInput');
}

function insertMedia(type) {
    const url = prompt(`URL da ${type === 'image' ? 'imagem' : 'vídeo'}:`);
    if (!url) return;
    const tag = type === 'image' ? `img src="${url}"` : `video src="${url}" controls`;
    insertAtCursor(`<${tag}>`, 'descricaoInput');
}

function wrapText(tag) {
    const textarea = document.getElementById('bbcodeInput');
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end) || 'texto';
    textarea.value = `${text.substring(0, start)}[${tag}]${selected}[/${tag}]${text.substring(end)}`;
    textarea.focus();
}

function insertList(type) {
    const tag = type === 'bullet' ? 'list' : 'olist';
    insertAtCursor(`[${tag}]\n[*]Item 1\n[*]Item 2\n[/${tag}]`, 'bbcodeInput');
}

function insertLink() {
    const url = prompt("URL:");
    if (url) insertAtCursor(`[url=${url}]link[/url]`, 'bbcodeInput');
}

function insertImage() {
    const url = prompt("URL da imagem:");
    if (url) insertAtCursor(`[img]${url}[/img]`, 'bbcodeInput');
}

function insertTable() {
    const cols = parseInt(prompt("Colunas:", "2")) || 2;
    const rows = parseInt(prompt("Linhas:", "2")) || 2;
    let table = '[table]\n';
    for (let i = 0; i < rows; i++) {
        table += '[tr]';
        for (let j = 0; j < cols; j++) table += '[td]Célula[/td]';
        table += '[/tr]\n';
    }
    table += '[/table]';
    insertAtCursor(table, 'bbcodeInput');
}

function insertColor() {
    const cor = prompt("Cor (ex: #00529e):", "#00529e");
    if (cor) wrapText(`color=${cor}`);
}

function insertSize() {
    const tamanho = prompt("Tamanho:", "18");
    if (tamanho) wrapText(`size=${tamanho}`);
}

function insertAtCursor(text, textareaId) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(start);
    textarea.focus();
}

// ==================== UTILITÁRIOS ====================

function formatarData() {
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const agora = new Date();
    return `${dias[agora.getDay()]} ${meses[agora.getMonth()]} ${agora.getDate()}, ${agora.getFullYear()} ${agora.getHours().toString().padStart(2, '0')}:${agora.getMinutes().toString().padStart(2, '0')}`;
}

function formatarDataISO(isoString) {
    if (!isoString) return formatarData();
    const data = new Date(isoString);
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return `${dias[data.getDay()]} ${meses[data.getMonth()]} ${data.getDate()}, ${data.getFullYear()} ${data.getHours().toString().padStart(2, '0')}:${data.getMinutes().toString().padStart(2, '0')}`;
}

function limparFormulario() {
    const container = document.getElementById('nicksContainer');
    if (container) {
        container.innerHTML = `
            <div class="nick-row">
                <div class="nick-input-wrapper">
                    <i class="fa-solid fa-user"></i>
                    <input type="text" class="nick-input" placeholder="Ex: ???JUKA" oninput="atualizarNickPrincipal(this.value)">
                </div>
            </div>
        `;
    }
    
    const inputs = ['ordemInput', 'temaInput', 'descricaoInput', 'bbcodeInput'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    nickPrincipal = '';
}

function showToast(titulo, mensagem, tipo = 'success') {
    const toast = document.getElementById('toast');
    const toastTitle = document.getElementById('toastTitle');
    const toastMessage = document.getElementById('toastMessage');
    const toastIcon = toast?.querySelector('.toast-icon i');

    if (!toast || !toastTitle || !toastMessage) return;

    toastTitle.textContent = titulo;
    toastMessage.textContent = mensagem;
    toast.className = `toast ${tipo} show`;

    if (toastIcon) {
        toastIcon.className = tipo === 'success' ? 'fa-solid fa-check' :
            tipo === 'error' ? 'fa-solid fa-xmark' :
            tipo === 'warning' ? 'fa-solid fa-exclamation' :
            'fa-solid fa-info';
    }

    setTimeout(() => toast.classList.remove('show'), 3000);
}

function toggleTema() {
    const html = document.documentElement;
    const atual = html.getAttribute('data-theme');
    const novo = atual === 'dark' ? 'light' : 'dark';

    html.setAttribute('data-theme', novo);
    localStorage.setItem('tema', novo);

    const icon = document.querySelector('#themeToggle i');
    if (icon) {
        icon.className = novo === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
}

// ==================== EVENT LISTENERS ====================

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        fecharModalAutores();
        document.querySelectorAll('.veredito-dropdown').forEach(el => el.classList.remove('active'));
    }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.veredito-dropdown')) {
        document.querySelectorAll('.veredito-dropdown').forEach(el => el.classList.remove('active'));
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const temaSalvo = localStorage.getItem('tema');
    if (temaSalvo) {
        document.documentElement.setAttribute('data-theme', temaSalvo);
        const icon = document.querySelector('#themeToggle i');
        if (icon) icon.className = temaSalvo === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }

    inicializarSistema();
});
