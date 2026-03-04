    // ==========================================
    // CONFIGURAÇÃO - MUDE AQUI AS URLs
    // ==========================================
    
    // SUPABASE (mesmo de antes)
    const SUPABASE_URL = 'https://mhssvjeklhqyauzbvntf.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oc3N2amVrbGhxeWF1emJ2bnRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NTQwMDUsImV4cCI6MjA4ODIzMDAwNX0.p8gD3cmLBpiACGwbv8SCA315QV_3CwNdlHWZAFAwc-c';
    
    // ⬇️⬇️⬇️ URL DO APPSCRIPT DE MEMBROS (JÁ EXISTE, NÃO MUDA)
    const URL_MEMBROS = 'https://script.google.com/macros/s/AKfycbzTjAyXc2kuWyv6QoyJwfkHl2NKBWTTudrDScusmL2a2wRERXOYTX3-wFWIW5nIbmiGXg/exec';
    
    // ⬇️⬇️⬇️ URL DO NOVO APPSCRIPT DE PROPOSTAS (COLE AQUI DEPOIS DE PUBLICAR)
    const URL_PROPOSTAS = 'https://script.google.com/macros/s/AKfycbwjBk9m9_6HLLsrN-2_FJYX8PgvX04ZPXgrjCKPQCru8M4f0reJ8Otuvcp_zZIuG1YR/exec';
    
    // ID do tópico do fórum
    const ID_TOPICO_FORUM = '39296';

    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ==========================================
    // ESTADO DO USUÁRIO
    // ==========================================
    let usuarioAtual = {
        nick: '',
        cargo: '',
        isLideranca: false,
        podeAdministrar: false
    };

    // Dados em memória
    let propostas = [];
    let logAcoes = [];
    let tipoSelecionado = 'Projeto';
    let abaAtual = 'todos';
    let paginaAtual = 1;
    const ITENS_POR_PAGINA = 10;
    let nickPrincipal = '';

    // ==========================================
    // FUNÇÕES DE AUTENTICAÇÃO E PERMISSÕES
    // ==========================================
    
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
            console.error("Erro ao buscar username:", err);
            const fallback = localStorage.getItem("forumUser");
            if (fallback) return fallback;
            showToast('Erro', 'Você precisa estar logado no fórum', 'error');
            throw err;
        }
    }

    async function buscarCargoPlanilha(nick) {
        try {
            const response = await fetch(URL_MEMBROS); // ⬅️ USA URL_MEMBROS
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
            console.error("Erro ao buscar cargo:", err);
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

            // Atualizar UI baseado nas permissões
            verificarPermissoesUI();
            
            // Carregar dados do Supabase
            await carregarPropostas();
            await carregarLogs();
            
            // Preencher nick no formulário
            const firstNick = document.querySelector('.nick-input');
            if (firstNick) {
                firstNick.value = nick;
                atualizarNickPrincipal(nick);
            }
            
            // Preencher nick na atualização
            document.getElementById('atualizacaoNick').value = nick;

            showToast('Bem-vindo', `${nick} - ${dadosPlanilha.cargoOriginal}`, 'success');
            
        } catch (err) {
            console.error("Erro na inicialização:", err);
            // Modo visitante - só pode ver
            usuarioAtual = { nick: 'Visitante', cargo: 'Visitante', isLideranca: false, podeAdministrar: false };
            verificarPermissoesUI();
            await carregarPropostas();
        }
    }

    function verificarPermissoesUI() {
        // Botões só para liderança
        const botoesLideranca = [
            document.getElementById('btnPendentes'),
            document.querySelector('[onclick="toggleAtualizacao()"]'),
            document.querySelector('[onclick="toggleLog()"]')
        ];

        botoesLideranca.forEach(btn => {
            if (btn) btn.style.display = usuarioAtual.podeAdministrar ? 'inline-flex' : 'none';
        });

        // Badge de pendentes só para liderança
        const badge = document.getElementById('badgePendentes');
        if (badge && !usuarioAtual.podeAdministrar) {
            badge.style.display = 'none';
        }

        // Botão de criar proposta disponível para TODOS
        const btnCriar = document.querySelector('[onclick="toggleForm()"]');
        if (btnCriar) btnCriar.style.display = 'inline-flex';
    }

    // ==========================================
    // SUPABASE - PROPOSTAS
    // ==========================================
    
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
                tipo: p.tipo,
                ordem: p.ordem,
                tema: p.tema,
                descricao: p.descricao,
                descricaoFormatada: p.descricao,
                bbcode: p.bbcode || '',
                data: formatarDataISO(p.created_at),
                veredito: p.veredito || 'Pendente',
                comentarios: p.comentarios || [],
                isAtualizacaoSimples: p.is_atualizacao || false,
                tagAtualizacao: p.tag_atualizacao || ''
            }));

            atualizarBadgePendentes();
            renderizarPropostas();
            
        } catch (err) {
            console.error('Erro ao carregar propostas:', err);
            showToast('Erro', 'Falha ao carregar propostas', 'error');
        }
    }

    async function salvarPropostaSupabase(proposta) {
        try {
            const { data, error } = await supabaseClient
                .from('propostas_ouvidoria')
                .insert([{
                    nick: proposta.nick,
                    tipo: proposta.tipo,
                    ordem: proposta.ordem,
                    tema: proposta.tema,
                    descricao: proposta.descricao,
                    bbcode: proposta.bbcode || '',
                    veredito: 'Pendente',
                    is_atualizacao: proposta.isAtualizacaoSimples || false,
                    tag_atualizacao: proposta.tagAtualizacao || null,
                    comentarios: [],
                    criado_por: usuarioAtual.nick
                }])
                .select();

            if (error) throw error;
            return data[0];
            
        } catch (err) {
            console.error('Erro ao salvar no Supabase:', err);
            throw err;
        }
    }

    async function atualizarVereditoSupabase(id, novoVeredito) {
        try {
            const { error } = await supabaseClient
                .from('propostas_ouvidoria')
                .update({ veredito: novoVeredito, updated_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;
            
            // Registrar log
            await inserirLog('ALTERAR_VEREDITO', `Alterou veredito para ${novoVeredito}`, id);
            
        } catch (err) {
            console.error('Erro ao atualizar veredito:', err);
            throw err;
        }
    }

    async function adicionarComentarioSupabase(id, comentario) {
        try {
            // Primeiro busca a proposta atual
            const { data: proposta, error: fetchError } = await supabaseClient
                .from('propostas_ouvidoria')
                .select('comentarios')
                .eq('id', id)
                .single();

            if (fetchError) throw fetchError;

            const comentarios = proposta.comentarios || [];
            comentarios.push(comentario);

            const { error } = await supabaseClient
                .from('propostas_ouvidoria')
                .update({ comentarios: comentarios, updated_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;
            
            await inserirLog('ADICIONAR_COMENTARIO', 'Adicionou comentário', id);
            
        } catch (err) {
            console.error('Erro ao adicionar comentário:', err);
            throw err;
        }
    }

    // ==========================================
    // SUPABASE - LOGS
    // ==========================================
    
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

    // ==========================================
    // PLANILHA - ENVIO DE DADOS
    // ==========================================
    
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
                veredito: proposta.veredito || 'Pendente',
                data: proposta.data,
                criadoPor: usuarioAtual.nick
            };

            const response = await fetch(URL_PROPOSTAS, { // ⬅️ USA URL_PROPOSTAS
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(dados)
            });

            const resultado = await response.json();
            return resultado;
            
        } catch (err) {
            console.error('Erro ao enviar para planilha:', err);
            return { sucesso: false, erro: err.message };
        }
    }

    // ==========================================
    // FÓRUM - POSTAGEM
    // ==========================================
    
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

    // ==========================================
    // FUNÇÕES DE FORMULÁRIO
    // ==========================================
    
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
            comentarios: [],
            isAtualizacaoSimples: false
        };

        try {
            // 1. Salvar no Supabase
            await salvarPropostaSupabase(novaProposta);
            
            // 2. Enviar para Planilha
            await enviarParaPlanilha(novaProposta);
            
            // 3. Postar no Fórum
            const tituloPost = `[Ouvidoria] Proposta #${ordem} - ${tema}`;
            const mensagemForum = gerarBBCodeForum(novaProposta);
            await postarNoForum(ID_TOPICO_FORUM, tituloPost, mensagemForum);
            
            // 4. Limpar e atualizar
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

    // ==========================================
    // ATUALIZAÇÃO DA OUVIDORIA (SÓ LIDERANÇA)
    // ==========================================
    
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
            comentarios: [],
            isAtualizacaoSimples: true,
            tagAtualizacao: tag
        };

        try {
            // Salvar no Supabase
            await salvarPropostaSupabase(atualizacaoSimples);
            
            // Postar no fórum
            const bbcode = `[center][table bgcolor="005fb2" style="border-radius: 14px; overflow: hidden; width: 80%; box-shadow: 0 1px 2px #f233be;"][tr][td][color=#f8f8ff][img(45px,45px)]https://www.habbo.com.br/habbo-imaging/badge/b09064s43084s50134eda71d18c813ca341e7e285475586bf5.gif[/img]

[size=13][font=Poppins][b][SRC] Atualização realizada! ${tag}[/size]

[size=11]Foi realizada uma atualização neste horário, em caso de erros, consulte um membro da Liderança.[/b][/font][/size][/color][/td][/tr][/table][/center]`;

            await postarNoForum(ID_TOPICO_FORUM, `[Ouvidoria] Atualização - ${new Date().toLocaleDateString('pt-BR')}`, bbcode);
            
            await inserirLog('ATUALIZACAO_OUVIDORIA', `Postou atualização como ${tag} ${nick}`);
            
            toggleAtualizacao();
            await carregarPropostas();
            
            showToast('Sucesso', 'Atualização postada!', 'success');
            
        } catch (err) {
            console.error('Erro:', err);
            showToast('Erro', 'Falha ao postar atualização', 'error');
        }
    }

    // ==========================================
    // VEREDITO (SÓ LIDERANÇA)
    // ==========================================
    
    async function alterarVeredito(id, novoVeredito) {
        if (!usuarioAtual.podeAdministrar) {
            showToast('Acesso Negado', 'Apenas Líder e Vice-Líder podem alterar vereditos', 'error');
            return;
        }

        const proposta = propostas.find(p => p.id === id);
        if (!proposta) return;

        try {
            const vereditoAnterior = proposta.veredito;
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

    // ==========================================
    // PENDENTES (SÓ LIDERANÇA)
    // ==========================================
    
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
                            <div class="pendente-tema">${p.tema}</div>
                            <div class="pendente-meta">
                                <span><i class="fa-solid fa-hashtag"></i> ${p.ordem}</span>
                                <span><i class="fa-solid fa-user"></i> ${p.nick.split(',').length} autor(es)</span>
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
        if (!badge || !usuarioAtual.podeAdministrar) return;
        
        const count = propostas.filter(p => p.veredito === 'Pendente' && !p.isAtualizacaoSimples).length;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'block' : 'none';
    }

    // ==========================================
    // LOG (SÓ LIDERANÇA)
    // ==========================================
    
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
                case 'ADICIONAR_COMENTARIO':
                    iconClass = 'comment';
                    icon = 'fa-comment';
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

    // ==========================================
    // COMENTÁRIOS
    // ==========================================
    
    function toggleComentarioInput(propostaId) {
        if (!usuarioAtual.podeAdministrar) {
            showToast('Acesso Negado', 'Apenas Líder e Vice-Líder podem comentar', 'error');
            return;
        }
        
        const inputArea = document.getElementById(`comentario-area-${propostaId}`);
        inputArea.classList.toggle('active');
        if (inputArea.classList.contains('active')) {
            setTimeout(() => {
                document.getElementById(`comentario-input-${propostaId}`).focus();
            }, 100);
        }
    }

    async function adicionarComentario(propostaId) {
        if (!usuarioAtual.podeAdministrar) {
            showToast('Acesso Negado', 'Sem permissão para comentar', 'error');
            return;
        }

        const input = document.getElementById(`comentario-input-${propostaId}`);
        const texto = input.value.trim();
        
        if (!texto) {
            showToast('Erro', 'Digite um comentário', 'error');
            return;
        }

        const comentario = {
            tag: usuarioAtual.cargo,
            nick: usuarioAtual.nick,
            texto: texto,
            data: formatarData()
        };

        try {
            await adicionarComentarioSupabase(propostaId, comentario);
            
            const proposta = propostas.find(p => p.id === propostaId);
            if (proposta) {
                proposta.comentarios.push(comentario);
            }
            
            showToast('Sucesso', 'Comentário adicionado!', 'success');
            renderizarPropostas();
            
        } catch (err) {
            showToast('Erro', 'Falha ao adicionar comentário', 'error');
        }
    }

    // ==========================================
    // RENDERIZAÇÃO
    // ==========================================
    
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
            // Se for atualização simples
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

            // Proposta normal
            const avataresHTML = gerarAvataresHTML(p.nick, p.id);
            const temComentarios = p.comentarios && p.comentarios.length > 0;
            
            // Veredito dropdown (só visual para não-liderança, funcional para liderança)
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
                                <span class="proposta-tipo ${getTipoClass(p.tipo)}">
                                    <i class="fa-solid ${getTipoIcon(p.tipo)}"></i> ${p.tipo}
                                </span>
                            </div>
                            <div class="proposta-tema">${p.tema}</div>
                            <div class="proposta-status">
                                ${vereditoDropdownHTML}
                            </div>
                        </div>
                        <button class="proposta-expand" onclick="toggleProposta(${p.id}, event)" title="Expandir/Recolher">
                            <i class="fa-solid fa-chevron-down"></i>
                        </button>
                    </div>
                    <div class="proposta-content">
                        <div class="proposta-detalhes-externo">
                            <div class="detalhe-item-externo">
                                <span class="detalhe-label-externo">Ordem</span>
                                <span class="detalhe-valor-externo">#${p.ordem}</span>
                            </div>
                            <div class="detalhe-item-externo">
                                <span class="detalhe-label-externo">Tipo</span>
                                <span class="detalhe-valor-externo">${p.tipo}</span>
                            </div>
                            <div class="detalhe-item-externo">
                                <span class="detalhe-label-externo">Autor(es)</span>
                                <span class="detalhe-valor-externo">${p.nick.split(',').length}</span>
                            </div>
                        </div>
                        
                        <div class="proposta-bbcode">
                            <div class="descricao-label">
                                <i class="fa-solid fa-align-left"></i> Descrição
                            </div>
                            <div class="descricao-formatada">
                                ${p.descricaoFormatada || p.descricao}
                            </div>
                        </div>

                        ${p.bbcode ? `
                        <div class="proposta-bbcode">
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
                                        <button class="code-btn" onclick="copyCode(${p.id})">
                                            <i class="fa-regular fa-copy"></i> Copiar
                                        </button>
                                    </div>
                                </div>
                                <div class="code-body">
                                    <div class="code-content">${highlightBBCode(p.bbcode)}</div>
                                </div>
                            </div>
                        </div>
                        ` : ''}

                        <div class="comentarios-section">
                            <div class="comentarios-header">
                                <i class="fa-solid fa-comments"></i> Comentários (${p.comentarios.length})
                            </div>
                            
                            ${temComentarios ? `
                            <div class="comentarios-list">
                                ${p.comentarios.map(c => `
                                    <div class="comentario-item">
                                        <div class="comentario-avatar">
                                            <img src="https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(c.nick)}&headonly=0&size=b&gesture=sml&direction=2&head_direction=2" 
                                                 alt="${c.nick}">
                                        </div>
                                        <div class="comentario-content">
                                            <div class="comentario-header">
                                                <span class="comentario-tag">${c.tag}</span>
                                                <span class="comentario-nick">${c.nick}</span>
                                                <span class="comentario-data">${c.data}</span>
                                            </div>
                                            <div class="comentario-texto">${c.texto}</div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                            ` : '<p style="color: var(--text-tertiary); font-size: 13px; margin-bottom: 16px;">Nenhum comentário ainda.</p>'}
                            
                            ${usuarioAtual.podeAdministrar ? `
                            <div class="comentario-input-area" id="comentario-area-${p.id}">
                                <textarea class="comentario-input" id="comentario-input-${p.id}" placeholder="Adicione um comentário..."></textarea>
                                <button class="btn btn-primary btn-sm" onclick="adicionarComentario(${p.id})">
                                    <i class="fa-solid fa-paper-plane"></i> Enviar Comentário
                                </button>
                            </div>
                            ` : ''}
                        </div>
                    </div>

                    ${usuarioAtual.podeAdministrar ? `
                    <div class="proposta-actions-sutis">
                        <button class="btn-sutil comentario" onclick="toggleComentarioInput(${p.id})">
                            <i class="fa-solid fa-comment"></i> Comentar
                        </button>
                    </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    // ==========================================
    // FUNÇÕES AUXILIARES
    // ==========================================
    
    function obterPropostasFiltradas() {
        let lista = [...propostas];
        
        if (abaAtual === 'meus') {
            lista = lista.filter(p => p.nick.toLowerCase().includes(usuarioAtual.nick.toLowerCase()));
        } else if (abaAtual === 'pendentes') {
            lista = lista.filter(p => p.veredito === 'Pendente' && !p.isAtualizacaoSimples);
        } else if (abaAtual === 'pesquisar') {
            const nick = document.getElementById('searchNick')?.value.toLowerCase() || '';
            const ordem = document.getElementById('searchOrdem')?.value.toLowerCase() || '';
            const tema = document.getElementById('searchTema')?.value.toLowerCase() || '';
            
            lista = lista.filter(p => {
                const matchNick = !nick || p.nick.toLowerCase().includes(nick);
                const matchOrdem = !ordem || p.ordem.toLowerCase().includes(ordem);
                const matchTema = !tema || p.tema.toLowerCase().includes(tema);
                return matchNick && matchOrdem && matchTema;
            });
        }
        
        return lista.sort((a, b) => {
            // Atualizações primeiro, depois por ordem decrescente
            if (a.isAtualizacaoSimples && !b.isAtualizacaoSimples) return -1;
            if (!a.isAtualizacaoSimples && b.isAtualizacaoSimples) return 1;
            return parseInt(b.ordem) - parseInt(a.ordem);
        });
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
        
        modalTitle.textContent = `Autores - ${proposta ? proposta.tema : 'Proposta'}`;
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

    async function copyCode(id) {
        const proposta = propostas.find(p => p.id === id);
        if (!proposta || !proposta.bbcode) return;
        
        try {
            await navigator.clipboard.writeText(proposta.bbcode);
            showToast('Sucesso', 'BBCode copiado!', 'success');
        } catch (err) {
            showToast('Erro', 'Não foi possível copiar', 'error');
        }
    }

    function highlightBBCode(code) {
        if (!code) return '';
        return code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function getTipoClass(tipo) {
        const map = { 'Projeto': 'tipo-projeto', 'Sugestão': 'tipo-sugestao', 'Correção/Alteração': 'tipo-correcao' };
        return map[tipo] || 'tipo-projeto';
    }

    function getTipoIcon(tipo) {
        const map = { 'Projeto': 'fa-lightbulb', 'Sugestão': 'fa-star', 'Correção/Alteração': 'fa-pen-to-square' };
        return map[tipo] || 'fa-lightbulb';
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
        return formatarData.call({ getDate: () => data });
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

    // Toolbar functions
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

    // Event listeners
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

    // Inicialização
    document.addEventListener('DOMContentLoaded', () => {
        const temaSalvo = localStorage.getItem('tema');
        if (temaSalvo) {
            document.documentElement.setAttribute('data-theme', temaSalvo);
            const icon = document.querySelector('#themeToggle i');
            if (icon) icon.className = temaSalvo === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        }

        inicializarSistema();
    });
