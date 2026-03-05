const URL_MEMBROS = 'https://script.google.com/macros/s/AKfycbzTjAyXc2kuWyv6QoyJwfkHl2NKBWTTudrDScusmL2a2wRERXOYTX3-wFWIW5nIbmiGXg/exec';
const URL_OUVIDORIA = 'https://script.google.com/macros/s/AKfycbwjBk9m9_6HLLsrN-2_FJYX8PgvX04ZPXgrjCKPQCru8M4f0reJ8Otuvcp_zZIuG1YR/exec';
const ID_TOPICO_FORUM = '1';

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
let propostaOrdemParaVeredito = null;

// FUNÇÃO AJAX COM JSONP PARA BYPASS CORS
function ajaxJSONP(url, params = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const callbackName = 'jsonp_callback_' + Math.round(Math.random() * 1000000);
        const script = document.createElement('script');
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout JSONP'));
        }, timeout);

        function cleanup() {
            if (script.parentNode) script.parentNode.removeChild(script);
            delete window[callbackName];
            clearTimeout(timeoutId);
        }

        window[callbackName] = function(data) {
            cleanup();
            resolve(data);
        };

        // Adiciona callback aos parâmetros
        const allParams = { ...params, callback: callbackName };
        const queryString = Object.keys(allParams)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(allParams[key]))
            .join('&');

        script.src = url + (url.includes('?') ? '&' : '?') + queryString;
        script.onerror = () => {
            cleanup();
            reject(new Error('JSONP failed'));
        };

        document.head.appendChild(script);
    });
}

// POST VIA FORM (não fetch) para evitar CORS preflight
function postViaForm(url, dados) {
    return new Promise((resolve, reject) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = url;
        form.target = 'hidden_iframe';
        form.style.display = 'none';

        // Adiciona campos
        Object.keys(dados).forEach(key => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = dados[key] || '';
            form.appendChild(input);
        });

        // Cria iframe invisível para receber resposta
        let iframe = document.getElementById('hidden_iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.name = 'hidden_iframe';
            iframe.id = 'hidden_iframe';
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
        }

        // Timeout
        const timeoutId = setTimeout(() => {
            reject(new Error('Timeout no envio'));
        }, 15000);

        // Listener de resposta
        iframe.onload = function() {
            clearTimeout(timeoutId);
            try {
                // Tenta pegar resposta do iframe
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                const responseText = iframeDoc.body.innerText || iframeDoc.body.textContent;
                
                try {
                    const json = JSON.parse(responseText);
                    resolve(json);
                } catch (e) {
                    // Se não for JSON, considera sucesso se não tiver erro óbvio
                    resolve({ sucesso: true, resposta: responseText });
                }
            } catch (e) {
                // Cross-origin pode bloquear leitura, assume sucesso
                resolve({ sucesso: true });
            }
        };

        document.body.appendChild(form);
        form.submit();
        
        // Remove form após envio
        setTimeout(() => {
            if (form.parentNode) form.parentNode.removeChild(form);
        }, 100);
    });
}

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

async function buscarCargoPlanilha(nick) {
    try {
        // Usa JSONP para bypass CORS
        const dados = await ajaxJSONP(URL_MEMBROS, {});
        const listaUsuarios = dados.membros || [];
        
        const usuario = listaUsuarios.find(p => 
            p.nick && p.nick.toLowerCase() === nick.toLowerCase()
        );

        if (!usuario) {
            return { nick: nick, cargo: 'membro', cargoOriginal: 'Membro' };
        }

        return {
            nick: usuario.nick,
            cargo: usuario.cargo,
            cargoOriginal: usuario.cargoOriginal
        };
    } catch (err) {
        return { nick: nick, cargo: 'membro', cargoOriginal: 'Membro' };
    }
}

function verificarLideranca(cargo) {
    const cargosLideranca = ['lider', 'vice-lider', 'Líder', 'Vice-Líder', 'Vice-lider'];
    return cargosLideranca.includes(cargo);
}

async function inicializarSistema() {
    showToast('Carregando', 'Verificando permissões...', 'info');
    
    try {
        const nick = await pegarUsernameForum();
        const dadosPlanilha = await buscarCargoPlanilha(nick);
        
        const isLideranca = verificarLideranca(dadosPlanilha.cargo);
        
        usuarioAtual = {
            nick: nick,
            cargo: dadosPlanilha.cargoOriginal,
            isLideranca: isLideranca,
            podeAdministrar: isLideranca
        };

        verificarPermissoesUI();
        
        await carregarPropostas();
        await carregarLogs();
        
        const firstNick = document.querySelector('.nick-input');
        if (firstNick) {
            firstNick.value = nick;
            atualizarNickPrincipal(nick);
        }
        
        const atualizacaoNick = document.getElementById('atualizacaoNick');
        if (atualizacaoNick) atualizacaoNick.value = nick;

        showToast('Bem-vindo', `${nick} - ${dadosPlanilha.cargoOriginal}`, 'success');
        
    } catch (err) {
        usuarioAtual = { nick: 'Visitante', cargo: 'Visitante', isLideranca: false, podeAdministrar: false };
        verificarPermissoesUI();
        await carregarPropostas();
    }
}

function verificarPermissoesUI() {
    const elementosParaRemover = [
        '#btnPendentes',
        'button[onclick="toggleAtualizacao()"]',
        'button[onclick="toggleLog()"]',
        '#badgePendentes',
        '#pendentesPanel',
        '#atualizacaoPanel', 
        '#logPanel'
    ];

    elementosParaRemover.forEach(seletor => {
        const el = document.querySelector(seletor);
        if (el && !usuarioAtual.podeAdministrar) {
            el.remove();
        }
    });

    if (!usuarioAtual.podeAdministrar) {
        document.querySelectorAll('.veredito-dropdown').forEach(el => {
            el.style.display = 'none';
        });
    }
}

// GET PROPOSTAS VIA JSONP
async function carregarPropostas() {
    try {
        const dados = await ajaxJSONP(URL_OUVIDORIA, { action: 'getPropostas' });
        
        propostas = (dados.propostas || []).map(p => ({
            ordem: String(p.ordem),
            nick: p.nick,
            tema: p.tema || 'Sem tema',
            descricao: p.descricao || '',
            bbcode: p.bbcode || '',
            tipo: p.tipo || 'Projeto',
            veredito: p.veredito || 'Pendente',
            data: p.data || formatarData(),
            criadoPor: p.criadoPor || p.nick,
            timestamp: p.timestamp || new Date().toISOString(),
            isAtualizacaoSimples: String(p.ordem) === 'UPD' || p.tipo === 'Atualização'
        }));

        propostas.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        atualizarBadgePendentes();
        renderizarPropostas();
        
    } catch (err) {
        console.error('Erro ao carregar propostas:', err);
        showToast('Erro', 'Falha ao carregar propostas', 'error');
    }
}

// POST PROPOSTA VIA FORM (evita CORS preflight)
async function salvarPropostaPlanilha(proposta) {
    try {
        const dados = {
            acao: 'criarProposta',
            ordem: proposta.ordem,
            nick: proposta.nick,
            tipo: proposta.tipo,
            tema: proposta.tema,
            descricao: proposta.descricao,
            bbcode: proposta.bbcode || '',
            veredito: 'Pendente',
            data: proposta.data,
            criadoPor: usuarioAtual.nick,
            timestamp: new Date().toISOString()
        };

        // Usa POST via form em vez de fetch
        const resultado = await postViaForm(URL_OUVIDORIA, dados);
        return resultado;
        
    } catch (err) {
        console.error('Erro ao salvar:', err);
        throw err;
    }
}

// ATUALIZAR VEREDITO VIA FORM
async function atualizarVereditoPlanilha(ordem, novoVeredito) {
    try {
        const dados = {
            acao: 'atualizarVeredito',
            ordem: ordem,
            veredito: novoVeredito,
            atualizadoPor: usuarioAtual.nick,
            timestampAtualizacao: new Date().toISOString()
        };

        const resultado = await postViaForm(URL_OUVIDORIA, dados);
        
        if (resultado.sucesso) {
            await inserirLog('ALTERAR_VEREDITO', `Alterou veredito da ordem #${ordem} para ${novoVeredito}`);
        }
        
        return resultado;
        
    } catch (err) {
        console.error('Erro ao atualizar veredito:', err);
        throw err;
    }
}

// LOG VIA FORM
async function inserirLog(acao, detalhes) {
    try {
        const dados = {
            acao: 'inserirLog',
            tipoAcao: acao,
            detalhes: detalhes,
            usuario: usuarioAtual.nick,
            tag: usuarioAtual.cargo,
            timestamp: new Date().toISOString()
        };

        await postViaForm(URL_OUVIDORIA, dados);
    } catch (err) {
        console.error('Erro ao inserir log:', err);
    }
}

// GET LOGS VIA JSONP
async function carregarLogs() {
    if (!usuarioAtual.podeAdministrar) return;
    
    try {
        const dados = await ajaxJSONP(URL_OUVIDORIA, { action: 'getLogs' });
        
        logAcoes = (dados.logs || []).map(l => ({
            id: l.id || Date.now() + Math.random(),
            acao: l.acao || l.tipoAcao,
            detalhes: l.detalhes,
            usuario: l.usuario,
            tag: l.tag,
            data: formatarDataISO(l.timestamp || l.data)
        }));

        renderizarLog();
        
    } catch (err) {
        console.error('Erro ao carregar logs:', err);
    }
}

// POST FÓRUM (mantém igual, funciona no mesmo domínio)
async function postarNoForum(idTopico, titulo, mensagem) {
    return new Promise((resolve, reject) => {
        async function fazerPostagem() {
            try {
                const formData = new FormData();
                formData.append('t', idTopico);
                formData.append('mode', 'reply');
                formData.append('subject', titulo);
                formData.append('message', mensagem);
                formData.append('post', 'Enviar');

                const response = await fetch('/post', {
                    method: 'POST',
                    body: formData,
                    credentials: 'same-origin'
                });

                if (response.ok || response.status === 302) {
                    resolve({ sucesso: true });
                } else {
                    reject(new Error('HTTP ' + response.status));
                }

            } catch (err) {
                reject(err);
            }
        }

        fazerPostagem();
    });
}

function gerarBBCodeForum(proposta) {
    const checkboxProjeto = proposta.tipo === 'Projeto' ? '☑' : '☐';
    const checkboxSugestao = proposta.tipo === 'Sugestão' ? '☑' : '☐';
    const checkboxAlteracao = proposta.tipo === 'Correção/Alteração' ? '☑' : '☐';
    
    const bbcodeSpoiler = proposta.bbcode ? `[spoiler="BBCode"]${proposta.bbcode}[/spoiler]` : '';
    
    return `[b]Nick:[/b] ${proposta.nick}
[b]Número de ordem:[/b] ${proposta.ordem}
${checkboxProjeto} Projeto ${checkboxSugestao} Sugestão ${checkboxAlteracao} Alteração/Correção
[b]Tema:[/b] ${proposta.tema}
[b]Descrição:[/b] ${proposta.descricao}

${bbcodeSpoiler}`;
}

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

function selectTipo(element, tipo) {
    document.querySelectorAll('.tipo-option').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    tipoSelecionado = tipo;
    const tipoInput = document.getElementById('tipoProposta');
    if (tipoInput) tipoInput.value = tipo;
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
    const input = row.querySelector('input');
    if (input) input.focus();
}

function removerNick(btn) {
    const row = btn.closest('.nick-row');
    if (row) row.remove();
}

function atualizarNickPrincipal(valor) {
    nickPrincipal = valor;
}

function obterTodosNicks() {
    const inputs = document.querySelectorAll('.nick-input');
    const nicks = Array.from(inputs).map(input => input.value.trim()).filter(v => v);
    return nicks.join(', ');
}

function gerarProximaOrdem() {
    if (propostas.length === 0) return '001';
    const ordens = propostas
        .filter(p => !p.isAtualizacaoSimples && p.ordem !== 'UPD')
        .map(p => parseInt(p.ordem))
        .filter(o => !isNaN(o));
    const maxOrdem = Math.max(...ordens, 0);
    return String(maxOrdem + 1).padStart(3, '0');
}

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

    const novaProposta = {
        ordem: ordem,
        nick: nicks,
        tipo: tipoSelecionado,
        tema: tema,
        descricao: descricao,
        bbcode: bbcode || '',
        data: formatarData(),
        veredito: 'Pendente'
    };

    try {
        showToast('Enviando', 'Salvando na planilha...', 'info');
        
        // Salva via form POST (evita CORS)
        await salvarPropostaPlanilha(novaProposta);
        
        // Posta no fórum
        showToast('Enviando', 'Postando no fórum...', 'info');
        const tituloPost = `[Ouvidoria] Proposta #${ordem} - ${tema}`;
        const mensagemForum = gerarBBCodeForum(novaProposta);
        
        try {
            await postarNoForum(ID_TOPICO_FORUM, tituloPost, mensagemForum);
            showToast('Sucesso', 'Postagem realizada!', 'success');
        } catch (forumErr) {
            console.error('Erro fórum:', forumErr);
            showToast('Aviso', 'Proposta salva, mas falha no fórum', 'warning');
        }
        
        // Log
        await inserirLog('CRIAR_PROPOSTA', `Criou proposta #${ordem}`);
        
        // Limpa formulário
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
        if (ordemInput) ordemInput.value = '';
        if (temaInput) temaInput.value = '';
        if (descricaoInput) descricaoInput.value = '';
        if (bbcodeInput) bbcodeInput.value = '';
        nickPrincipal = '';
        
        toggleForm();
        await carregarPropostas();
        
        showToast('Sucesso', 'Proposta enviada!', 'success');
        
    } catch (err) {
        console.error('Erro:', err);
        showToast('Erro', 'Falha ao enviar: ' + err.message, 'error');
    }
}

function toggleAtualizacao() {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Sem permissão', 'error');
        return;
    }
    
    const panel = document.getElementById('atualizacaoPanel');
    if (!panel) return;
    
    panel.classList.toggle('active');
    
    if (panel.classList.contains('active')) {
        const atualizacaoNick = document.getElementById('atualizacaoNick');
        const atualizacaoTag = document.getElementById('atualizacaoTag');
        
        if (atualizacaoNick) atualizacaoNick.value = usuarioAtual.nick;
        if (atualizacaoTag) atualizacaoTag.value = '';
        
        setTimeout(() => {
            if (atualizacaoTag) atualizacaoTag.focus();
        }, 100);
    }
}

async function postarAtualizacao() {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Sem permissão', 'error');
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
        tipo: 'Atualização',
        tema: `Atualização de ${tag}`,
        descricao: `Atualização postada por ${tag} ${nick}`,
        bbcode: '',
        data: formatarData(),
        veredito: 'Atualização'
    };

    try {
        await salvarPropostaPlanilha(atualizacao);
        
        const bbcode = `[center][table bgcolor="005fb2" style="border-radius: 14px; overflow: hidden; width: 80%;"][tr][td][color=#f8f8ff][img(45px,45px)]https://www.habbo.com.br/habbo-imaging/badge/b09064s43084s50134eda71d18c813ca341e7e285475586bf5.gif[/img]

[size=13][font=Poppins][b][SRC] Atualização realizada! ${tag}[/size]

[size=11]Foi realizada uma atualização neste horário.[/b][/font][/size][/color][/td][/tr][/table][/center]`;

        await postarNoForum(ID_TOPICO_FORUM, `[Ouvidoria] Atualização - ${new Date().toLocaleDateString('pt-BR')}`, bbcode);
        
        await inserirLog('ATUALIZACAO_OUVIDORIA', `Postou atualização como ${tag}`);
        
        toggleAtualizacao();
        await carregarPropostas();
        
        showToast('Sucesso', 'Atualização postada!', 'success');
        
    } catch (err) {
        console.error('Erro:', err);
        showToast('Erro', 'Falha ao postar atualização', 'error');
    }
}

function abrirModalVeredito(ordem) {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Sem permissão', 'error');
        return;
    }
    
    propostaOrdemParaVeredito = ordem;
    const proposta = propostas.find(p => p.ordem === ordem);
    if (!proposta) return;
    
    document.querySelectorAll('.veredito-option-modal').forEach(el => {
        el.classList.remove('selected');
        if (el.querySelector('span').textContent === proposta.veredito) {
            el.classList.add('selected');
        }
    });
    
    const modal = document.getElementById('vereditoModal');
    if (modal) modal.classList.add('active');
}

function fecharModalVeredito(event) {
    if (event && event.target !== event.currentTarget && !event.target.closest('.modal-close')) return;
    
    const modal = document.getElementById('vereditoModal');
    if (modal) modal.classList.remove('active');
    propostaOrdemParaVeredito = null;
}

function selectVereditoModal(element, veredito) {
    document.querySelectorAll('.veredito-option-modal').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
}

async function salvarVeredito() {
    if (!propostaOrdemParaVeredito) return;
    
    const selectedOption = document.querySelector('.veredito-option-modal.selected');
    if (!selectedOption) {
        showToast('Erro', 'Selecione um veredito', 'error');
        return;
    }
    
    const novoVeredito = selectedOption.querySelector('span').textContent;
    
    try {
        await alterarVeredito(propostaOrdemParaVeredito, novoVeredito);
        fecharModalVeredito();
    } catch (err) {
        showToast('Erro', 'Falha ao salvar veredito', 'error');
    }
}

async function alterarVeredito(ordem, novoVeredito) {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Sem permissão', 'error');
        return;
    }

    try {
        await atualizarVereditoPlanilha(ordem, novoVeredito);
        
        const proposta = propostas.find(p => p.ordem === ordem);
        if (proposta) {
            proposta.veredito = novoVeredito;
        }
        
        showToast('Sucesso', `Proposta #${ordem} marcada como ${novoVeredito}`, 'success');
        atualizarBadgePendentes();
        renderizarPropostas();
        
    } catch (err) {
        showToast('Erro', 'Falha ao alterar veredito', 'error');
    }
}

function toggleVereditoDropdown(event, ordem) {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Sem permissão', 'error');
        return;
    }
    event.stopPropagation();
    
    document.querySelectorAll('.veredito-dropdown').forEach(el => {
        if (el.dataset.ordem !== ordem) {
            el.classList.remove('active');
        }
    });
    
    const dropdown = event.currentTarget.closest('.veredito-dropdown');
    if (dropdown) dropdown.classList.toggle('active');
}

function selecionarVereditoSutil(event, ordem, novoVeredito) {
    event.stopPropagation();
    alterarVeredito(ordem, novoVeredito);
    
    const dropdown = event.currentTarget.closest('.veredito-dropdown');
    if (dropdown) dropdown.classList.remove('active');
}

function togglePendentes() {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Sem permissão', 'error');
        return;
    }
    
    const panel = document.getElementById('pendentesPanel');
    if (!panel) return;
    
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) {
        renderizarPendentes();
    }
}

function renderizarPendentes() {
    const container = document.getElementById('pendentesList');
    const countEl = document.getElementById('pendentesCount');
    
    if (!container || !countEl) return;
    
    const pendentes = propostas.filter(p => p.veredito === 'Pendente' && !p.isAtualizacaoSimples);
    
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
                        <img src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(primeiroNick)}&headonly=0&size=b&gesture=sml&direction=2&head_direction=2" 
                             alt="${primeiroNick}"
                             onerror="this.src='https://www.habbo.com.br/habbo-imaging/avatarimage?user=habbo&headonly=0&size=b'">
                    </div>
                    <div class="pendente-detalhes">
                        <div class="pendente-tema">Ordem #${p.ordem}</div>
                        <div class="pendente-meta">
                            <span><i class="fa-solid fa-user"></i> ${p.nick}</span>
                        </div>
                    </div>
                </div>
                <div class="pendente-actions">
                    <button class="btn btn-success btn-sm" onclick="alterarVeredito('${p.ordem}', 'Aprovado')">
                        <i class="fa-solid fa-check"></i>
                    </button>
                    <button class="btn btn-warning btn-sm" onclick="alterarVeredito('${p.ordem}', 'Aprovado com alteração')">
                        <i class="fa-solid fa-edit"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="alterarVeredito('${p.ordem}', 'Reprovado')">
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
    
    const count = propostas.filter(p => p.veredito === 'Pendente' && !p.isAtualizacaoSimples).length;
    badge.textContent = count;
    
    if (count === 0 || !usuarioAtual.podeAdministrar) {
        badge.style.display = 'none';
    } else {
        badge.style.display = 'block';
    }
}

function toggleLog() {
    if (!usuarioAtual.podeAdministrar) {
        showToast('Acesso Negado', 'Sem permissão', 'error');
        return;
    }
    
    const panel = document.getElementById('logPanel');
    if (!panel) return;
    
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) {
        renderizarLog();
    }
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
                        <span><i class="fa-solid fa-user"></i> ${log.tag} ${log.usuario}</span>
                        <span>•</span>
                        <span><i class="fa-regular fa-clock"></i> ${log.data}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderizarPropostas() {
    const container = document.getElementById('propostasList');
    const countEl = document.getElementById('countPropostas');
    
    if (!container) return;

    const listaCompleta = obterPropostasFiltradas();
    const totalItens = listaCompleta.length;
    
    const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
    const fim = inicio + ITENS_POR_PAGINA;
    const lista = listaCompleta.slice(inicio, fim);
    
    if (countEl) {
        countEl.textContent = `${totalItens} registro${totalItens !== 1 ? 's' : ''}`;
    }

    renderizarPaginacao(totalItens);

    if (lista.length === 0) {
        let mensagem = 'Nenhuma proposta encontrada';
        if (abaAtual === 'meus') mensagem = 'Você ainda não enviou nenhuma proposta';
        else if (abaAtual === 'pendentes') mensagem = 'Não há propostas pendentes';
        else if (abaAtual === 'pesquisar') mensagem = 'Nenhuma proposta corresponde à pesquisa';
        
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-inbox"></i>
                <p>${mensagem}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = lista.map(p => {
        if (p.isAtualizacaoSimples) {
            return `
                <div class="atualizacao-item-simples">
                    <div class="atualizacao-icon">
                        <i class="fa-solid fa-rotate"></i>
                    </div>
                    <div class="atualizacao-conteudo">
                        <div class="atualizacao-tag-texto">${p.tema.replace('Atualização de ', '')}</div>
                        <div class="atualizacao-nick-texto">${p.nick}</div>
                        <div class="atualizacao-data-texto">${p.data}</div>
                    </div>
                </div>
            `;
        }

        const avataresHTML = gerarAvataresHTML(p.nick, p.ordem);
        
        const vereditoDropdownHTML = usuarioAtual.podeAdministrar ? `
            <div class="veredito-dropdown" data-ordem="${p.ordem}">
                <div class="veredito-trigger" onclick="toggleVereditoDropdown(event, '${p.ordem}')">
                    <div class="veredito-dot ${p.veredito.toLowerCase().replace(/\s+/g, '')}"></div>
                    <span>${p.veredito}</span>
                    <i class="fa-solid fa-chevron-down" style="font-size: 10px;"></i>
                </div>
                <div class="veredito-menu">
                    <div class="veredito-option pendente" onclick="selecionarVereditoSutil(event, '${p.ordem}', 'Pendente')">
                        <i class="fa-solid fa-clock"></i> Pendente
                    </div>
                    <div class="veredito-option aprovado" onclick="selecionarVereditoSutil(event, '${p.ordem}', 'Aprovado')">
                        <i class="fa-solid fa-check-circle"></i> Aprovado
                    </div>
                    <div class="veredito-option alteracao" onclick="selecionarVereditoSutil(event, '${p.ordem}', 'Aprovado com alteração')">
                        <i class="fa-solid fa-edit"></i> Com Alteração
                    </div>
                    <div class="veredito-option reprovado" onclick="selecionarVereditoSutil(event, '${p.ordem}', 'Reprovado')">
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
            <div class="proposta-item" id="proposta-${p.ordem}">
                <div class="proposta-header">
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
                            ${vereditoDropdownHTML}
                        </div>
                    </div>
                    <button class="proposta-expand" onclick="toggleProposta('${p.ordem}', event)" title="Expandir/Recolher">
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function gerarConteudoExpandido(p) {
    const bbcodeSection = p.bbcode ? `
        <div class="detalhe-item-externo" style="grid-column: 1/-1;">
            <span class="detalhe-label-externo">BBCode</span>
            <div style="position: relative; margin-top: 8px;">
                <textarea id="bbcode-text-${p.ordem}" readonly style="width: 100%; min-height: 120px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-family: monospace; font-size: 12px; color: var(--text-primary); resize: vertical;">${p.bbcode}</textarea>
                <button onclick="copiarBBCode('${p.ordem}')" style="position: absolute; top: 8px; right: 8px; background: var(--primary); color: white; border: none; border-radius: 6px; padding: 6px 12px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-copy"></i> Copiar
                </button>
            </div>
        </div>
    ` : '';

    return `
        <div class="proposta-content">
            <div class="proposta-detalhes-externo">
                <div class="detalhe-item-externo">
                    <span class="detalhe-label-externo">Tema</span>
                    <span class="detalhe-valor-externo">${p.tema || 'N/A'}</span>
                </div>
                <div class="detalhe-item-externo">
                    <span class="detalhe-label-externo">Tipo</span>
                    <span class="detalhe-valor-externo">${p.tipo || 'N/A'}</span>
                </div>
                <div class="detalhe-item-externo">
                    <span class="detalhe-label-externo">Ordem</span>
                    <span class="detalhe-valor-externo">#${p.ordem}</span>
                </div>
                <div class="detalhe-item-externo">
                    <span class="detalhe-label-externo">Status</span>
                    <span class="detalhe-valor-externo">${p.veredito}</span>
                </div>
                ${p.descricao ? `
                <div class="detalhe-item-externo" style="grid-column: 1/-1;">
                    <span class="detalhe-label-externo">Descrição</span>
                    <span class="detalhe-valor-externo" style="white-space: pre-wrap;">${p.descricao}</span>
                </div>
                ` : ''}
                ${bbcodeSection}
            </div>
            <div class="proposta-actions-sutis">
                ${usuarioAtual.podeAdministrar ? `<button class="btn-sutil" onclick="abrirModalVeredito('${p.ordem}')"><i class="fa-solid fa-gavel"></i> Alterar Veredito</button>` : ''}
            </div>
        </div>
    `;
}

function copiarBBCode(ordem) {
    const textarea = document.getElementById(`bbcode-text-${ordem}`);
    if (!textarea) return;
    
    textarea.select();
    textarea.setSelectionRange(0, 99999);
    
    try {
        navigator.clipboard.writeText(textarea.value).then(() => {
            showToast('Copiado!', 'BBCode copiado', 'success');
        }).catch(() => {
            document.execCommand('copy');
            showToast('Copiado!', 'BBCode copiado', 'success');
        });
    } catch (err) {
        document.execCommand('copy');
        showToast('Copiado!', 'BBCode copiado', 'success');
    }
}

function obterPropostasFiltradas() {
    let lista = [...propostas];
    
    if (abaAtual === 'meus') {
        lista = lista.filter(p => p.nick.toLowerCase().includes(usuarioAtual.nick.toLowerCase()));
    } else if (abaAtual === 'pendentes') {
        lista = lista.filter(p => p.veredito === 'Pendente' && !p.isAtualizacaoSimples);
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

function toggleProposta(ordem, event) {
    if (event) {
        if (event.target.closest('.btn') || 
            event.target.closest('.veredito-dropdown') || 
            event.target.closest('.proposta-avatars') ||
            event.target.closest('.btn-sutil')) {
            return;
        }
    }
    
    const item = document.getElementById(`proposta-${ordem}`);
    if (!item) return;
    
    const isExpanded = item.classList.contains('expanded');
    
    document.querySelectorAll('.proposta-item.expanded').forEach(el => {
        if (el.id !== `proposta-${ordem}`) {
            el.classList.remove('expanded');
            const content = el.querySelector('.proposta-content');
            if (content) content.remove();
        }
    });
    
    if (isExpanded) {
        item.classList.remove('expanded');
        const content = item.querySelector('.proposta-content');
        if (content) content.remove();
    } else {
        item.classList.add('expanded');
        const proposta = propostas.find(p => p.ordem === ordem);
        if (proposta) {
            const contentHTML = gerarConteudoExpandido(proposta);
            item.insertAdjacentHTML('beforeend', contentHTML);
        }
    }
}

function gerarAvataresHTML(nicksString, ordem) {
    const nicks = nicksString.split(',').map(n => n.trim()).filter(n => n);
    const maxAvataresVisiveis = 3;
    
    let html = `<div class="proposta-avatars" onclick="abrirModalAutores('${nicksString}', '${ordem}')" title="Clique para ver todos os autores">`;
    
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
        html += `
            <div class="avatar-more" title="Clique para ver todos os autores">
                +${restantes}
            </div>
        `;
    }
    
    html += '</div>';
    return html;
}

function mudarAba(aba, btn) {
    abaAtual = aba;
    paginaAtual = 1;
    
    document.querySelectorAll('.nav-tabs .btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const searchPanel = document.getElementById('searchPanel');
    if (searchPanel) {
        if (aba === 'pesquisar') {
            searchPanel.classList.add('active');
        } else {
            searchPanel.classList.remove('active');
        }
    }
    
    renderizarPropostas();
}

function filtrarPropostas() {
    if (abaAtual !== 'pesquisar') return;
    paginaAtual = 1;
    renderizarPropostas();
}

function abrirModalAutores(nicksString, ordem) {
    const modal = document.getElementById('autoresModal');
    const modalBody = document.getElementById('modalBody');
    const modalTitle = document.getElementById('modalTitle');
    const modalCount = document.getElementById('modalCount');
    
    if (!modal || !modalBody) return;
    
    const nicks = nicksString.split(',').map(n => n.trim()).filter(n => n);
    const proposta = propostas.find(p => p.ordem === ordem);
    
    if (modalTitle) modalTitle.textContent = `Autores - Ordem #${proposta ? proposta.ordem : ''}`;
    if (modalCount) modalCount.innerHTML = `<strong>${nicks.length}</strong> autor${nicks.length !== 1 ? 'es' : ''}`;
    
    let html = '<div class="autores-grid">';
    nicks.forEach(nick => {
        const isCurrentUser = nick.toLowerCase() === usuarioAtual.nick.toLowerCase();
        html += `
            <div class="autor-card" onclick="copiarNick('${nick}')" title="Clique para copiar">
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
    }).catch(err => {
        console.error('Erro ao copiar:', err);
    });
}

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

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        fecharModalAutores();
        fecharModalVeredito();
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
