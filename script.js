
    const SUPABASE_URL = 'https://mhssvjeklhqyauzbvntf.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oc3N2amVrbGhxeWF1emJ2bnRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTQwMDUsImV4cCI6MjA4ODIzMDAwNX0.p8gD3cmLBpiACGwbv8SCA315QV_3CwNdlHWZAFAwc-c';
    const URL_MEMBROS = 'https://script.google.com/macros/s/AKfycbzTjAyXc2kuWyv6QoyJwfkHl2NKBWTTudrDScusmL2a2wRERXOYTX3-wFWIW5nIbmiGXg/exec';
    const URL_PROPOSTAS = 'https://script.google.com/macros/s/AKfycbwjBk9m9_6HLLsrN-2_FJYX8PgvX04ZPXgrjCKPQCru8M4f0reJ8Otuvcp_zZIuG1YR/exec';
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
    let subscriptionPendentes = null;

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
            throw new Error('Não autenticado no fórum');
        } catch (err) {
            const fallback = localStorage.getItem("forumUser");
            if (fallback) return fallback;
            showToast('Erro', 'Você precisa estar logado no fórum', 'error');
            throw err;
        }
    }

    async function buscarCargoPlanilha(nick) {
        try {
            const response = await fetch(URL_MEMBROS);
            const dados = await response.json();
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
            iniciarRealtimePendentes();
            
            const firstNick = document.querySelector('.nick-input');
            if (firstNick) {
                firstNick.value = nick;
                atualizarNickPrincipal(nick);
            }
            
            document.getElementById('atualizacaoNick').value = nick;

            showToast('Bem-vindo', `${nick} - ${dadosPlanilha.cargoOriginal}`, 'success');
            
        } catch (err) {
            usuarioAtual = { nick: 'Visitante', cargo: 'Visitante', isLideranca: false, podeAdministrar: false };
            verificarPermissoesUI();
            await carregarPropostas();
        }
    }

    function verificarPermissoesUI() {
        const btnPendentes = document.getElementById('btnPendentes');
        if (btnPendentes) {
            btnPendentes.style.display = usuarioAtual.podeAdministrar ? 'inline-flex' : 'none';
        }

        const btnAtualizar = document.querySelector('button[onclick="toggleAtualizacao()"]');
        if (btnAtualizar) {
            btnAtualizar.style.display = usuarioAtual.podeAdministrar ? 'inline-flex' : 'none';
        }

        const btnLog = document.querySelector('button[onclick="toggleLog()"]');
        if (btnLog) {
            btnLog.style.display = usuarioAtual.podeAdministrar ? 'inline-flex' : 'none';
        }

        const badge = document.getElementById('badgePendentes');
        if (badge) {
            badge.style.display = (usuarioAtual.podeAdministrar && parseInt(badge.textContent) > 0) ? 'block' : 'none';
        }

        const btnCriar = document.querySelector('button[onclick="toggleForm()"]');
        if (btnCriar) {
            btnCriar.style.display = 'inline-flex';
        }

        if (!usuarioAtual.podeAdministrar) {
            const pendentesPanel = document.getElementById('pendentesPanel');
            if (pendentesPanel) pendentesPanel.classList.remove('active');
            
            const atualizacaoPanel = document.getElementById('atualizacaoPanel');
            if (atualizacaoPanel) atualizacaoPanel.classList.remove('active');
            
            const logPanel = document.getElementById('logPanel');
            if (logPanel) logPanel.classList.remove('active');
        }
    }

    async function carregarPropostas() {
        try {
            const { data, error } = await supabaseClient
                .from('propostas_ouvidoria')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            propostas = (data || []).map(p => ({
                id: p.id,
                nick: p.nick,
                ordem: p.ordem,
                veredito: p.veredito || 'Pendente',
                isAtualizacaoSimples: p.is_atualizacao || false,
                tagAtualizacao: p.tag_atualizacao || '',
                data: formatarDataISO(p.created_at)
            }));

            atualizarBadgePendentes();
            renderizarPropostas();
            
        } catch (err) {
            showToast('Erro', 'Falha ao carregar propostas', 'error');
        }
    }

    async function salvarPropostaSupabase(proposta) {
        try {
            const { data, error } = await supabaseClient
                .from('propostas_ouvidoria')
                .insert([{
                    nick: proposta.nick,
                    ordem: proposta.ordem,
                    veredito: 'Pendente',
                    is_atualizacao: proposta.isAtualizacaoSimples || false,
                    tag_atualizacao: proposta.tagAtualizacao || null
                }])
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
                .from('propostas_ouvidoria')
                .update({ veredito: novoVeredito })
                .eq('id', id);

            if (error) throw error;
            
            await inserirLog('ALTERAR_VEREDITO', `Alterou veredito para ${novoVeredito}`, id);
            
        } catch (err) {
            throw err;
        }
    }

    async function inserirLog(acao, detalhes, propostaId = null) {
        try {
            await supabaseClient
                .from('logs_ouvidoria')
                .insert([{
                    acao: acao,
                    detalhes: detalhes,
                    proposta_id: propostaId,
                    usuario: usuarioAtual.nick,
                    tag: usuarioAtual.cargo,
                    ip_address: null
                }]);
        } catch (err) {
            console.error('Erro ao inserir log:', err);
        }
    }

    async function carregarLogs() {
        if (!usuarioAtual.podeAdministrar) return;
        
        try {
            const { data, error } = await supabaseClient
                .from('logs_ouvidoria')
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
                tag: l.tag,
                data: formatarDataISO(l.created_at)
            }));

            renderizarLog();
            
        } catch (err) {
            console.error('Erro ao carregar logs:', err);
        }
    }

    async function enviarParaPlanilha(proposta) {
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
                criadoPor: usuarioAtual.nick
            };

            const response = await fetch(URL_PROPOSTAS, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(dados),
                mode: 'no-cors'
            });

            return { sucesso: true };
            
        } catch (err) {
            console.error('Erro ao enviar para planilha:', err);
            return { sucesso: false, erro: err.message };
        }
    }

    async function postarNoForum(idTopico, titulo, mensagem) {
        return new Promise((resolve, reject) => {
            function fazerPostagem() {
                $.ajax({
                    url: '/post',
                    type: 'POST',
                    data: {
                        t: idTopico,
                        mode: 'reply',
                        subject: titulo,
                        message: mensagem,
                        post: 'Enviar'
                    },
                    success: function(response) {
                        resolve(response);
                    },
                    error: function(xhr, status, error) {
                        reject(new Error(`Erro na postagem: ${status}`));
                    }
                });
            }

            if (typeof $ === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js';
                script.onload = () => fazerPostagem();
                script.onerror = () => reject(new Error('Falha ao carregar jQuery'));
                document.head.appendChild(script);
            } else {
                fazerPostagem();
            }
        });
    }

    function gerarBBCodeForum(proposta) {
        const checkboxProjeto = proposta.tipo === 'Projeto' ? '(X)' : '(  )';
        const checkboxSugestao = proposta.tipo === 'Sugestão' ? '(X)' : '(  )';
        const checkboxAlteracao = proposta.tipo === 'Correção/Alteração' ? '(X)' : '(  )';
        
        const bbcodeSpoiler = proposta.bbcode ? `[spoiler=BBCode]${proposta.bbcode}[/spoiler]` : '';
        
        return `[b]Nick:[/b] ${proposta.nick}
[b]Número de ordem:[/b] ${proposta.ordem}
${checkboxProjeto} Projeto ${checkboxSugestao} Sugestão ${checkboxAlteracao} Alteração/Correção
[b]Tema:[/b] ${proposta.tema}
[b]Descrição:[/b] ${proposta.descricao}

${bbcodeSpoiler}`;
    }

    function toggleForm() {
        const form = document.getElementById('formContainer');
        form.classList.toggle('active');
        
        if (form.classList.contains('active')) {
            document.getElementById('ordemInput').value = gerarProximaOrdem();
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
        document.getElementById('tipoProposta').value = tipo;
    }

    function adicionarNick() {
        const container = document.getElementById('nicksContainer');
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
        row.remove();
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
            .filter(p => !p.isAtualizacaoSimples)
            .map(p => parseInt(p.ordem))
            .filter(o => !isNaN(o));
        const maxOrdem = Math.max(...ordens, 0);
        return String(maxOrdem + 1).padStart(3, '0');
    }

    async function enviarProposta() {
        const nicks = obterTodosNicks();
        const ordem = document.getElementById('ordemInput')?.value.trim();
        const tema = document.getElementById('temaInput')?.value.trim();
        const descricao = document.getElementById('descricaoInput')?.value.trim();
        const bbcode = document.getElementById('bbcodeInput')?.value.trim();

        if (!nicks || !ordem || !tema || !descricao) {
            showToast('Erro', 'Preencha todos os campos obrigatórios', 'error');
            return;
        }

        const novaProposta = {
            id: Date.now(),
            nick: nicks,
            tipo: tipoSelecionado,
            ordem: ordem,
            tema: tema,
            descricao: descricao,
            descricaoFormatada: descricao,
            bbcode: bbcode || '',
            data: formatarData(),
            veredito: 'Pendente',
            isAtualizacaoSimples: false
        };

        try {
            showToast('Enviando', 'Salvando proposta...', 'info');
            
            await salvarPropostaSupabase(novaProposta);
            
            showToast('Enviando', 'Enviando para planilha...', 'info');
            await enviarParaPlanilha(novaProposta);
            
            showToast('Enviando', 'Postando no fórum...', 'info');
            const tituloPost = `[Ouvidoria] Proposta #${ordem} - ${tema}`;
            const mensagemForum = gerarBBCodeForum(novaProposta);
            await postarNoForum(ID_TOPICO_FORUM, tituloPost, mensagemForum);
            
            document.getElementById('nicksContainer').innerHTML = `
                <div class="nick-row">
                    <div class="nick-input-wrapper">
                        <i class="fa-solid fa-user"></i>
                        <input type="text" class="nick-input" placeholder="Ex: ???JUKA" oninput="atualizarNickPrincipal(this.value)">
                    </div>
                </div>
            `;
            document.getElementById('ordemInput').value = '';
            document.getElementById('temaInput').value = '';
            document.getElementById('descricaoInput').value = '';
            document.getElementById('bbcodeInput').value = '';
            nickPrincipal = '';
            
            toggleForm();
            await carregarPropostas();
            
            showToast('Sucesso', 'Proposta enviada e postada no fórum!', 'success');
            
        } catch (err) {
            console.error('Erro ao enviar proposta:', err);
            showToast('Erro', 'Falha ao enviar proposta: ' + err.message, 'error');
        }
    }

    function toggleAtualizacao() {
        if (!usuarioAtual.podeAdministrar) {
            showToast('Acesso Negado', 'Apenas Líder e Vice-Líder podem atualizar a ouvidoria', 'error');
            return;
        }
        
        const panel = document.getElementById('atualizacaoPanel');
        panel.classList.toggle('active');
        
        if (panel.classList.contains('active')) {
            document.getElementById('atualizacaoNick').value = usuarioAtual.nick;
            document.getElementById('atualizacaoTag').value = '';
            setTimeout(() => document.getElementById('atualizacaoTag').focus(), 100);
        }
    }

    async function postarAtualizacao() {
        if (!usuarioAtual.podeAdministrar) {
            showToast('Acesso Negado', 'Sem permissão para esta ação', 'error');
            return;
        }

        const tag = document.getElementById('atualizacaoTag').value.trim();
        const nick = document.getElementById('atualizacaoNick').value.trim();
        
        if (!tag) {
            showToast('Erro', 'Digite sua TAG', 'error');
            return;
        }

        const atualizacaoSimples = {
            id: Date.now(),
            nick: nick,
            tipo: 'Atualização',
            ordem: 'UPD',
            tema: `Atualização de ${tag}`,
            descricao: `Atualização postada por ${tag} ${nick}`,
            descricaoFormatada: `Atualização postada por <b>${tag}</b> ${nick}`,
            bbcode: '',
            data: formatarData(),
            veredito: 'Atualização',
            isAtualizacaoSimples: true,
            tagAtualizacao: tag
        };

        try {
            await salvarPropostaSupabase(atualizacaoSimples);
            
            const bbcode = `[center][table bgcolor="005fb2" style="border-radius: 14px; overflow: hidden; width: 80%; box-shadow: 0 1px 2px #f233be;"][tr][td][color=#f8f8ff][img(45px,45px)]https://www.habbo.com.br/habbo-imaging/badge/b09064s43084s50134eda71d18c813ca341e7e285475586bf5.gif[/img]

[size=13][font=Poppins][b][SRC] Atualização realizada! ${tag}[/size]

[size=11]Foi realizada uma atualização neste horário, em caso de erros, consulte um membro da Liderança.[/b][/font][/size][/color][/td][/tr][/table][/center]`;

            await postarNoForum(ID_TOPICO_FORUM, `[Ouvidoria] Atualização - ${new Date().toLocaleDateString('pt-BR')}`, bbcode);
            
            await inserirLog('ATUALIZACAO_OUVIDORIA', `Postou atualização como ${tag} ${nick}`);
            
            toggleAtualizacao();
            await carregarPropostas();
            
            showToast('Sucesso', 'Atualização postada!', 'success');
            
        } catch (err) {
            showToast('Erro', 'Falha ao postar atualização', 'error');
        }
    }

    async function alterarVeredito(id, novoVeredito) {
        if (!usuarioAtual.podeAdministrar) {
            showToast('Acesso Negado', 'Apenas Líder e Vice-Líder podem alterar vereditos', 'error');
            return;
        }

        const proposta = propostas.find(p => p.id === id);
        if (!proposta) return;

        try {
            await atualizarVereditoSupabase(id, novoVeredito);
            
            proposta.veredito = novoVeredito;
            
            showToast('Sucesso', `Proposta #${proposta.ordem} marcada como ${novoVeredito}`, 'success');
            atualizarBadgePendentes();
            renderizarPropostas();
            
        } catch (err) {
            showToast('Erro', 'Falha ao alterar veredito', 'error');
        }
    }

    function toggleVereditoDropdown(event, propostaId) {
        if (!usuarioAtual.podeAdministrar) {
            showToast('Acesso Negado', 'Apenas Líder e Vice-Líder podem alterar vereditos', 'error');
            return;
        }
        event.stopPropagation();
        
        document.querySelectorAll('.veredito-dropdown').forEach(el => {
            if (el.dataset.propostaId != propostaId) {
                el.classList.remove('active');
            }
        });
        
        const dropdown = event.currentTarget.closest('.veredito-dropdown');
        dropdown.classList.toggle('active');
    }

    function selecionarVereditoSutil(event, propostaId, novoVeredito) {
        event.stopPropagation();
        alterarVeredito(propostaId, novoVeredito);
        
        const dropdown = event.currentTarget.closest('.veredito-dropdown');
        if (dropdown) dropdown.classList.remove('active');
    }

    function togglePendentes() {
        if (!usuarioAtual.podeAdministrar) {
            showToast('Acesso Negado', 'Apenas Líder e Vice-Líder podem ver pendentes', 'error');
            return;
        }
        
        const panel = document.getElementById('pendentesPanel');
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) {
            renderizarPendentes();
        }
    }

    function iniciarRealtimePendentes() {
        if (!usuarioAtual.podeAdministrar) return;
        
        subscriptionPendentes = supabaseClient
            .channel('propostas-pendentes')
            .on('postgres_changes', 
                { 
                    event: '*', 
                    schema: 'public', 
                    table: 'propostas_ouvidoria',
                    filter: 'veredito=eq.Pendente'
                }, 
                (payload) => {
                    console.log('Mudança detectada:', payload);
                    carregarPropostas();
                    if (document.getElementById('pendentesPanel').classList.contains('active')) {
                        renderizarPendentes();
                    }
                }
            )
            .subscribe();
    }

    function renderizarPendentes() {
        const container = document.getElementById('pendentesList');
        const countEl = document.getElementById('pendentesCount');
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
        
        const count = propostas.filter(p => p.veredito === 'Pendente' && !p.isAtualizacaoSimples).length;
        badge.textContent = count;
        badge.style.display = (usuarioAtual.podeAdministrar && count > 0) ? 'block' : 'none';
    }

    function toggleLog() {
        if (!usuarioAtual.podeAdministrar) {
            showToast('Acesso Negado', 'Apenas Líder e Vice-Líder podem ver o log', 'error');
            return;
        }
        
        const panel = document.getElementById('logPanel');
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) {
            renderizarLog();
        }
    }

    function renderizarLog() {
        const container = document.getElementById('logList');
        
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
                            <div class="atualizacao-tag-texto">${p.tagAtualizacao}</div>
                            <div class="atualizacao-nick-texto">${p.nick}</div>
                            <div class="atualizacao-data-texto">${p.data}</div>
                        </div>
                    </div>
                `;
            }

            const avataresHTML = gerarAvataresHTML(p.nick, p.id);
            
            const vereditoDropdownHTML = usuarioAtual.podeAdministrar ? `
                <div class="veredito-dropdown" data-proposta-id="${p.id}">
                    <div class="veredito-trigger" onclick="toggleVereditoDropdown(event, ${p.id})">
                        <div class="veredito-dot ${p.veredito.toLowerCase().replace(/\s+/g, '')}"></div>
                        <span>${p.veredito}</span>
                        <i class="fa-solid fa-chevron-down" style="font-size: 10px;"></i>
                    </div>
                    <div class="veredito-menu">
                        <div class="veredito-option pendente" onclick="selecionarVereditoSutil(event, ${p.id}, 'Pendente')">
                            <i class="fa-solid fa-clock"></i> Pendente
                        </div>
                        <div class="veredito-option aprovado" onclick="selecionarVereditoSutil(event, ${p.id}, 'Aprovado')">
                            <i class="fa-solid fa-check-circle"></i> Aprovado
                        </div>
                        <div class="veredito-option alteracao" onclick="selecionarVereditoSutil(event, ${p.id}, 'Aprovado com alteração')">
                            <i class="fa-solid fa-edit"></i> Com Alteração
                        </div>
                        <div class="veredito-option reprovado" onclick="selecionarVereditoSutil(event, ${p.id}, 'Reprovado')">
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
                            <div class="proposta-status">
                                ${vereditoDropdownHTML}
                            </div>
                        </div>
                        <button class="proposta-expand" onclick="toggleProposta(${p.id}, event)" title="Expandir/Recolher">
                            <i class="fa-solid fa-chevron-down"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function obterPropostasFiltradas() {
        let lista = [...propostas];
        
        if (abaAtual === 'meus') {
            lista = lista.filter(p => p.nick.toLowerCase().includes(usuarioAtual.nick.toLowerCase()));
        } else if (abaAtual === 'pendentes') {
            lista = lista.filter(p => p.veredito === 'Pendente' && !p.isAtualizacaoSimples);
        } else if (abaAtual === 'pesquisar') {
            const nick = document.getElementById('searchNick')?.value.toLowerCase() || '';
            const ordem = document.getElementById('searchOrdem')?.value.toLowerCase() || '';
            
            lista = lista.filter(p => {
                const matchNick = !nick || p.nick.toLowerCase().includes(nick);
                const matchOrdem = !ordem || p.ordem.toLowerCase().includes(ordem);
                return matchNick && matchOrdem;
            });
        }
        
        return lista.sort((a, b) => new Date(b.data) - new Date(a.data));
    }

    function renderizarPaginacao(totalItens) {
        const totalPaginas = Math.ceil(totalItens / ITENS_POR_PAGINA);
        const pagination = document.getElementById('pagination');
        
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
        document.querySelector('.table-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function gerarAvataresHTML(nicksString, propostaId) {
        const nicks = nicksString.split(',').map(n => n.trim()).filter(n => n);
        const maxAvataresVisiveis = 3;
        
        let html = `<div class="proposta-avatars" onclick="abrirModalAutores('${nicksString}', ${propostaId})" title="Clique para ver todos os autores">`;
        
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
        if (aba === 'pesquisar') {
            searchPanel.classList.add('active');
        } else {
            searchPanel.classList.remove('active');
        }
        
        renderizarPropostas();
    }

    function filtrarPropostas() {
        if (abaAtual !== 'pesquisar') return;
        paginaAtual = 1;
        renderizarPropostas();
    }

    function toggleProposta(id, event) {
        if (event && (event.target.closest('.btn') || event.target.closest('.proposta-avatars'))) {
            return;
        }
        
        const item = document.getElementById(`proposta-${id}`);
        if (item) {
            document.querySelectorAll('.proposta-item.expanded').forEach(el => {
                if (el.id !== `proposta-${id}`) {
                    el.classList.remove('expanded');
                }
            });
            item.classList.toggle('expanded');
        }
    }

    function abrirModalAutores(nicksString, propostaId) {
        const modal = document.getElementById('autoresModal');
        const modalBody = document.getElementById('modalBody');
        const modalTitle = document.getElementById('modalTitle');
        const modalCount = document.getElementById('modalCount');
        
        const nicks = nicksString.split(',').map(n => n.trim()).filter(n => n);
        const proposta = propostas.find(p => p.id === propostaId);
        
        modalTitle.textContent = `Autores - Ordem #${proposta ? proposta.ordem : ''}`;
        modalCount.innerHTML = `<strong>${nicks.length}</strong> autor${nicks.length !== 1 ? 'es' : ''}`;
        
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
        document.getElementById('autoresModal').classList.remove('active');
    }

    function copiarNick(nick) {
        navigator.clipboard.writeText(nick).then(() => {
            showToast('Copiado!', `Nick "${nick}" copiado`, 'success');
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
        const textarea = document.getElementById('descricaoInput');
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
        const start = textarea.selectionStart;
        textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(start);
        textarea.focus();
    }

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
