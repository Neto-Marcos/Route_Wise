# Criar Rota — guia de design

Atualizado em 18/10/2026. Estado: referência para padronização, com especificação das correções de celular.

Decisão corrigida do usuário: manter claro e escuro, restaurar o modo escuro e remover somente o controle duplicado dentro do planejador. Manter um único controle de tema no cabeçalho principal. A remoção total do modo escuro foi uma interpretação incorreta, revogada. Preservar a escolha do usuário após a restauração inicial.

Cartão de usuário no celular: avatar à esquerda, texto centralizado na coluna de informações, ações de editar/desativar na lateral direita em coluna própria. Centralizar texto não deve deslocar botões para o centro do cartão. Campos de busca com ícone reservam uma coluna para a lupa, sem sobreposição ao placeholder.

### Cabeçalho e conta — decisão vigente

- Cabeçalho mobile mostra título e um único acionador “Minha conta e configurações”. Retirar o anúncio “Atualização automática”. Ocultar estado saudável “Sincronizado”; preservar avisos de falta de conexão, fila pendente e ações de sincronização existentes.
- Menu “Minha conta”: nome, empresa, alterar senha e sair no fim da lista. Saída mantém confirmação e troca de senha mantém o fluxo existente.
- Configurações: aparência claro/escuro, acesso aos alertas da Central, acesso aos mapas e consulta de permissões do navegador. Consulta de permissão não solicita posição nem concede acesso automaticamente.
- Empresa: exibir apenas ações e opções já autorizadas pelo aplicativo. Autorizações continuam no servidor; menu não amplia permissões.
- Menu como disclosure nativo, com controles comuns: fechamento por Escape ou clique fora, foco devolvido ao acionador via Escape, largura limitada ao viewport e rolagem interna em tela baixa. Não duplicar tema/sair no cabeçalho ou rodapé lateral.
- Novas preferências de mapa não são inventadas: o item leva às telas existentes de mapas. Notificações leva à Central, onde ativação e configuração reais continuam disponíveis.

## Escopo e fontes

Este documento orienta telas de gestão, escritório e motorista. Preserva a identidade do produto e organiza as próximas correções; não declara que todas as telas já seguem estas regras.

Base inspecionada: `app/globals.css` do checkout `work/Route_Wise-responsive`, componentes existentes e registros da revisão mobile de 15/10. A produção continua sendo a referência funcional e precisa ser reconciliada com o Git antes da publicação completa.

## Identidade e hierarquia

- Nome do produto: **Criar Rota**. RouteWise é um identificador técnico histórico.
- Interface operacional: azul-marinho, superfícies neutras e verde para a ação principal. Preservar marca, ícones e favicon existentes.
- Cada tela apresenta título, contexto, ação principal e conteúdo, nessa ordem. Evitar vários botões com igual destaque.
- Gestão prioriza pendências, planejamento e acompanhamento. Motorista prioriza próxima parada, navegação e registro da entrega.
- Não introduzir uma nova estética em cada módulo. Reutilizar componentes existentes antes de criar variantes.

## Cores existentes

Valores abaixo extraídos do CSS; não são garantia de contraste em todas as combinações.

| Papel/token | Claro | Escuro |
|---|---|---|
| Texto `--ink` | `#0f172a` | `#f8fafc` |
| Base `--navy` | `#14243a` | `#0d1726` |
| Ação principal `--blue` | `#059669` | `#10b981` |
| Hover principal `--blue-hover` | `#047857` | `#34d399` |
| Fundo `--paper` | `#f8fafc` | `#0a111c` |
| Superfície `--card` | `#ffffff` | `#131d2e` |
| Superfície secundária `--card-subtle` | `#f1f5f9` | `#19263c` |
| Hover de superfície `--card-hover` | `#f8fafc` | `#1f304c` |
| Texto secundário `--muted` | `#64748b` | `#94a3b8` |
| Borda `--line` | `#e2e8f0` | `#20304a` |
| Sucesso `--green` | `#059669` | `#10b981` |
| Erro `--red` | `#dc2626` | `#ef4444` |
| Atenção `--amber` | `#d97706` | `#f59e0b` |

O nome legado `--blue` representa verde. Reutilizá-lo enquanto houver consumidores existentes. Uma futura migração pode criar aliases semânticos como `--action-primary`, com revisão de todas as referências; este guia não renomeia tokens.

Usar tokens em novas regras. Cores fixas só para necessidades específicas, como mapas ou impressão, e com justificativa. Estado exige texto/ícone além de cor. Validar contraste de texto normal de pelo menos 4,5:1 e texto grande de 3:1. Não presumir que texto branco sobre verde atende automaticamente.

## Tipografia e medidas — padrão a aplicar

### Padrão mobile aplicado em 18/10/2026

Regras em `app/mobile-ui.css`, limitadas a `screen` até 600 px. No artefato recuperado, a mesma folha é acrescentada pelo adaptador local. Tablet e desktop não recebem esta nova escala.

| Elemento | Medida |
|---|---|
| Família | Inter, system-ui, -apple-system, Segoe UI, sans-serif |
| Título de tela | 24 px, linha 1,25 |
| Título de seção | 18 px, linha 1,35 |
| Subtítulo | 16 px, linha 1,4 |
| Corpo / mensagem de erro | 14 px, linha 1,5 |
| Auxiliar | 12 px, linha 1,5 |
| Rótulo de campo | 13 px, linha 1,5 |
| Campo de entrada | 16 px, altura mínima 44 px |
| Botão | 13 px / 18 px, altura mínima 44 px, padding 10 × 12 px |
| Painel / cartão | padding 16 px, raio 12 px, borda 1 px |
| Campo / botão | raio 8 px |
| Modal | raio 16 px, margem lateral mínima 12 px |
| Distância entre ações | 8 px |

Textos extensos podem aumentar a altura dos controles; não truncar para impor uma altura fixa. No comercial, as quatro abas usam duas colunas no celular. Na Central, destinatário, mensagem e envio ocupam linhas separadas. Cabeçalho do roteirizador usa título acima das ações e etapas em quatro colunas adaptáveis. Campos não podem herdar larguras mínimas rígidas que excedam seu painel.

Validação local: 11 destinos da gestão em 320, 390 e 430 px; regressão de layout em 768, 1024 e 1440 px. Sem transbordamento da página nem exceções JavaScript nesses cenários. Base sintética vazia: essa conferência não cobre registros reais, todas as variantes de modais, teclado físico de aparelho ou permissões de todos os perfis.

Revisão adicional após dez capturas de falhas: banner de código sem largura mínima rígida, cartão de usuário com alinhamento à esquerda, ações das rotas em grade de duas colunas e painéis analíticos em uma coluna. Central com três abas iguais e composição em linhas separadas; comercial com quatro abas em duas colunas. Cabeçalho do roteirizador e campo SSW adaptáveis. Grupos de navegação permanecem ocultos no celular com regra de prioridade suficiente.

Verificação adicional: seis telas (equipe, rotas, roteirizador, SSW, Central e comercial) em 320/360/390/430 px, total de 24 cenários. Rota de nome extenso simulada apenas na resposta GET do teste, sem gravação no banco. Foram conferidos limites das caixas, além da largura da página, e capturas em tema escuro. A inspeção não substitui testes com todas as combinações de dados e permissões.

Entrega local de CSS: gerar nome de arquivo a partir do hash do conteúdo e atualizar HTML/RSC juntos. Não sobrescrever um endereço tratado como imutável e esperar que o navegador ou service worker descarte a cópia anterior. HTML local recebe `Cache-Control: no-store`; preservar a fila offline no IndexedDB.

- Fonte existente: Inter, system-ui, -apple-system, Segoe UI, sans-serif. Não exigir download de outra fonte.
- Corpo e formulários: 16 px como referência; conteúdo de tabelas densas pode usar 14 px. Texto auxiliar: 12–14 px, sem informação essencial minúscula.
- Títulos internos: 24–32 px; subtítulos: 18–20 px; altura de linha do corpo: 1,4–1,6. A abertura pode ter escala própria responsiva.
- Espaçamentos: escala de 4, 8, 12, 16, 24 e 32 px. Padding de página: 16 px em celular e 24–32 px em telas largas.
- Referência de raios para componentes novos: 8 px em campos/botões, 12 px em painéis e 16 px em modais. Não substituir variantes existentes em massa.
- Sombras discretas; usar bordas e espaçamento para separar conteúdo.

## Componentes

### Botões e formulários

- No celular até 600 px: botões comuns com altura mínima de 44 px, padding horizontal de 12 px, fonte de 13 px/18 px, ícone de 16 px, intervalo de 6 px e raio de 8 px. Largura conforme o texto, mínimo de 44 px; largura total apenas para ações que exigem essa apresentação, como envio principal de formulário.
- Não fixar a largura de todos os botões no mesmo número: rótulos têm comprimentos diferentes. Mensagens longas, inclusive estados de alertas, podem quebrar em linhas e aumentar a altura, mantendo o mínimo de 44 px.
- Navegação inferior: itens com altura de 56 px e ícones de 18 px; barra de 68 px mais área segura. Não reduzir a área de toque para diminuir o ícone. Preservar a reserva de espaço do conteúdo.

- Reutilizar `.button`, `.button.primary`, `.panel`, `.metric` e `.status` onde aplicáveis; conferir a implementação antes de estender.
- Uma ação principal por seção. Ações secundárias neutras; destrutivas identificadas e com confirmação proporcional ao impacto.
- Área de toque mínima de 44 × 44 px. Botões com ícone precisam de nome acessível.
- Campos têm rótulo persistente, indicação de obrigatoriedade e erro próximo. Placeholder não substitui rótulo.
- Carregamento impede envio duplicado e mantém feedback visível. Falha preserva dados preenchidos e oferece recuperação.

### Tabelas e indicadores

- Cartão de rota: identidade/status na primeira linha, barra de progresso na segunda linha em toda a largura útil e ações na terceira linha. Não permitir posicionamento absoluto, deslocamento ou reaproveitamento da coluna antiga de ações após expandir a barra. No desktop, ações compactas alinhadas à direita; no celular, grade de duas colunas.

- Busca, filtros, período e ações ficam identificáveis acima do resultado. Permitir limpar filtros e distinguir resultado vazio de erro.
- Valores monetários alinhados à direita, formato brasileiro e unidade explícita. Datas e horários seguem o contexto operacional informado.
- Indicador financeiro mostra conceito, período e origem/data de atualização da planilha. Sem dado: `—`; zero somente quando apurado.
- Nunca rotular carteira inteira como faturamento mensal. Distinguir Total Item e Total NF deduplicado.
- No celular, priorizar colunas ou usar cartões. Quando a comparação exigir tabela, limitar rolagem horizontal ao contêiner, sem alargar a página.

### Mapas e modais

- Planejador em telas a partir de 701 px: formulário e mapa lado a lado com divisória arrastável de 12 px. Manter painel com pelo menos 260 px quando houver espaço e mapa com pelo menos 240 px; limitar a posição dentro da largura disponível.
- Divisória acessível por teclado: setas esquerda/direita ajustam 24 px; Home/End levam aos limites; duplo clique restaura a proporção inicial. Salvar a proporção em preferência local, sem alterar dados da rota.
- Ambos os painéis terminam na mesma altura, aproveitando o viewport até 16 px acima da navegação inferior (quando fixa). Conteúdo do formulário rola internamente; mapa acompanha o novo tamanho. Até 700 px, preservar alternância formulário/mapa e ocultar a divisória.

- Mapa deve ter altura útil e controles legíveis nos dois temas. Preservar atribuições Leaflet/OpenStreetMap.
- Status e dados essenciais também precisam estar disponíveis fora do mapa.
- Modal tem título, fechamento visível, foco inicial, navegação por teclado e devolução do foco ao fechar. Conter rolagem no modal e respeitar teclado virtual e áreas seguras.

## Responsividade e acessibilidade

### Telas grandes

Folha `app/wide-ui.css` ativa a partir de 1600 px, sem zoom ou transformações de escala. Corpo cresce de 16 a 22 px, títulos de tela de 30 a 44 px, texto auxiliar de 14 a 18 px, controles com pelo menos 48 px e sidebar de 280 a 360 px. Limitar o crescimento com `clamp`, mantendo hierarquia tipográfica e espaço útil.

Exceção de densidade solicitada para o planejador desktop: botões de ação de 40 px, opções de critério de 36 px e campos Cx/m³ de 32 px; fonte de controles de 13–16 px. Manter os rótulos completos, permitindo quebra em painel estreito. Não ampliar estes controles junto com a tipografia geral.

Mapa de rastreio usa altura entre 480 e 1500 px, guiada por 68dvh. Planejador mantém altura disponível e divisória funcional. A folha não se aplica a celular/tablet. Verificado em 1920×1080, 2560×1440 e 3840×2160 nas telas de rastreio, planejamento e comercial, além da preservação do título mobile em 24 px.

- Projetar o fluxo de celular antes de ampliar para desktop. Reorganizar conteúdo conforme espaço disponível, sem reduzir tudo proporcionalmente.
- Aproveitar os breakpoints existentes; não adicionar um breakpoint para cada correção isolada.
- Verificar larguras de 320, 390, 768, 1024 e 1920 px, além dos pontos de transição do layout.
- Nenhuma rolagem horizontal na página. Filhos de flex/grid devem poder encolher; não usar largura mínima rígida sem necessidade.
- Navegação de celular precisa de abertura/fechamento claros. Ações fixas não podem cobrir campos ou conteúdo.
- Preservar zoom, foco visível e navegação por teclado. Respeitar preferência de movimento reduzido.
- Validar ambos os temas, inclusive tabelas, mapas, menus, campos, modais e estados desabilitados.

## Correções prioritárias de celular

As quatro capturas fornecidas em 18/10/2026 documentam problemas de layout no celular. Elas não demonstram falha de cálculo, backend ou comportamento em desktop. As regras abaixo especificam a correção; sua implementação e validação continuam pendentes. Preservar o layout funcional de tablet e desktop e verificar regressões após cada ajuste.

### Estrutura compartilhada

- A largura da página acompanha a área disponível, inclusive dentro de painéis. Usar `min-width: 0` em filhos flex/grid e `max-width: 100%` nos contêineres relevantes.
- Não esconder conteúdo com `overflow-x: hidden` no documento para mascarar transbordamento. Encontrar o elemento que excede a largura e corrigir sua distribuição.
- Manter margem externa de 16 px; padding interno de painéis pode cair para 12 px nos menores aparelhos para evitar margens acumuladas que comprimam campos.
- Cabeçalhos e grupos de ações podem quebrar em linhas. Valores financeiros completos e rótulos essenciais não podem ser truncados.
- Campos de digitação usam pelo menos 16 px. Testar com teclado virtual aberto, barras do navegador visíveis e orientação horizontal.
- Reservar no conteúdo a altura real da navegação fixa, incluindo `env(safe-area-inset-bottom)`. Não presumir altura constante quando rótulos quebrarem em linhas.
- Definir uma única rolagem vertical principal por tela; áreas independentes só quando necessárias, como lista de mensagens ou menu. O usuário não deve ficar preso entre vários painéis roláveis.

### Comercial: abas e filtros

**Observado:** parte das abas e seus rótulos fica fora da área visível.

- Usar uma faixa de abas com rolagem horizontal restrita ao próprio componente, espaçamento consistente e rótulos completos. Cada aba mantém sua largura legível, sem encolher até cortar texto.
- Sinalizar a continuação da faixa, por exemplo com parte da próxima aba visível. Esse recorte é intencional apenas na faixa rolável; todas as opções precisam ser alcançáveis.
- Ao selecionar uma aba, trazê-la inteiramente para a área visível sem deslocar horizontalmente a página. Quando implementar o padrão ARIA de abas, incluir foco, seleção e navegação por teclado correspondentes.
- Em largura insuficiente, título/contexto, seletor de mês e atualização ocupam linhas próprias. Não usar larguras fixas que ultrapassem o painel.
- Indicadores em uma coluna no celular, com valores e descrições completos. A faixa de abas não pode empurrar os cartões para fora do painel.

**Aceite:** acessar todas as abas, alterar mês e atualizar em 320–430 px; nenhuma opção inacessível, valor cortado ou rolagem horizontal da página.

### Menu: painel de navegação móvel

**Observado:** menu largo com ícones sem os respectivos rótulos, grandes espaços entre grupos e ações inferiores ocupando quase toda a largura.

- No celular, abrir um painel sobreposto com fundo de bloqueio, botão Fechar e largura limitada à tela; referência de largura: `min(320px, calc(100vw - 32px))`.
- Exibir rótulos de todos os destinos. O estado de barra recolhida com apenas ícones pertence ao desktop e não pode vazar para o painel móvel.
- Distribuir itens em lista compacta, com altura de toque mínima de 44 px e grupos separados por 16–24 px. Não distribuir grupos usando espaço livre da altura inteira.
- Cabeçalho e rodapé têm altura do próprio conteúdo; a lista recebe o espaço restante e pode rolar. Alterar senha e Sair permanecem alcançáveis também em tela baixa.
- Ao abrir, mover foco para o painel, manter foco dentro dele e impedir interação/rolagem do conteúdo de fundo. Ao fechar, devolver foco ao acionador.
- Fechar pelo botão, toque no fundo e Escape. Após escolher um destino, fechar o painel e mostrar o título da tela selecionada.

**Aceite:** todos os destinos com texto, sem vazios artificiais; abrir, navegar, rolar e fechar em retrato e paisagem, preservando o menu de desktop.

### Central operacional: composição de mensagem

**Observado:** o seletor de destinatário e o botão Enviar comprimem o campo de mensagem até torná-lo praticamente inutilizável.

- No celular, destinatário ocupa a primeira linha inteira, com rótulo visível.
- Mensagem ocupa a linha seguinte inteira, preferencialmente em textarea com altura inicial para duas linhas e expansão limitada. Botão Enviar fica abaixo, alinhado ao fim ou ocupando a largura disponível.
- Não colocar seletor, campo e botão em três colunas na largura de celular. Aplicar a mudança ao componente e breakpoint existentes.
- Aprovar pagamentos, ativar alertas e navegação entre Chat/Entregas/Pagamentos devem quebrar em linhas ou ter distribuição própria sem comprimir o formulário.
- Com teclado aberto, manter campo e ação de envio alcançáveis por rolagem e impedir que a navegação fixa os cubra. Não desabilitar zoom.
- Envio em andamento bloqueia duplicidade; falha mantém texto e destinatário. Sucesso só limpa a mensagem após confirmação do envio.

**Aceite:** selecionar destinatário, digitar uma mensagem longa, revisar e enviar usando teclado virtual; campo legível e botão alcançável em 320 e 390 px.

### Rastreio: mapa e navegação inferior

**Observado:** a barra inferior disputa espaço com o mapa, e destinos nas extremidades aparecem cortados.

- Barra inferior deve caber integralmente na largura. Usar itens com distribuição uniforme, `min-width: 0`, ícone e rótulo legível em até duas linhas.
- Se o número de destinos exceder o espaço legível, agrupar destinos secundários em “Mais”, com lista acessível. Não diminuir indefinidamente a fonte nem cortar as opções das bordas.
- Conteúdo e mapa terminam acima da barra fixa e da área segura. Atribuições do mapa e controles não podem ficar atrás da navegação.
- Cabeçalho de posições permite quebra de linha sem comprimir o aviso “Nenhuma posição recebida”. Manter diferenciação entre ausência de posições e falha de carregamento.
- Dimensionar o mapa pelo espaço disponível, considerando cabeçalho e navegação. Usar unidades de viewport dinâmicas quando apropriado e testar telas baixas; não aplicar altura fixa que inviabilize o restante da tela.
- Após mudar orientação, abrir/fechar menu ou alterar o tamanho do contêiner, atualizar o tamanho do mapa pela API do Leaflet quando necessário.

**Aceite:** primeiro e último destinos inteiramente visíveis, todos acionáveis; mapa, zoom e atribuições acessíveis, inclusive após rotação e abertura/fechamento do menu.

### Matriz de verificação da correção

| Cenário | Verificação obrigatória |
|---|---|
| 320, 360, 390 e 430 px em retrato | Quatro telas sem transbordamento da página; controles de toque e textos legíveis |
| Paisagem em celular | Menu com rodapé alcançável; formulário e mapa utilizáveis em pouca altura |
| Teclado virtual aberto | Mensagem e envio alcançáveis; nenhuma sobreposição por barra fixa |
| Temas claro e escuro | Rótulos, seleção, campos, controles de mapa e estados legíveis |
| Zoom de texto/navegador | Conteúdo reorganiza sem perder ações ou impedir ampliação |
| Android/Chrome e iPhone/Safari reais | Conferir teclado, áreas seguras, barras dinâmicas e gestos; emulação não substitui esses testes |
| 768, 1024 e 1920 px | Preservar layout funcional e navegação de tablet/desktop |

Registrar capturas antes/depois e resultados por tela, largura, navegador e commit. Usar dados sintéticos ou anonimizados nas evidências compartilhadas. Conferir geometria dos elementos e interação: uma captura sem transbordamento não prova que todas as abas ou ações são alcançáveis.

## Estados e linguagem

### Telas de erro — implementação de 18/10/2026

- Catálogo com 40 códigos HTTP padronizados 4xx/5xx e dois estados adicionais: offline e falha inesperada. Galeria em `/erros`; cada prévia usa `/erros/{codigo}?preview=1`. Sem preview, as rotas HTTP retornam o código correspondente.
- Layout: marca, código, título objetivo, orientação e ação de recuperação. Cartão de até 560 px, margem de celular de 16 px, botões de pelo menos 44 px; temas claro/escuro seguem a preferência do navegador.
- Login expirado direciona à entrada; conflito e timeout orientam conferir o resultado antes de repetir um envio. Não repetir automaticamente operações que alteram dados.
- Nunca exibir stack trace, senha, conteúdo da requisição ou mensagem bruta de exceção. Exibir somente o identificador de diagnóstico quando disponível.
- Fonte Next.js: `not-found.tsx`, `error.tsx`, `global-error.tsx` e página offline usam a apresentação compartilhada. A falha global inclui estrutura HTML própria.
- APIs mantêm status e JSON. Validação de formulário continua próxima ao campo; ter uma tela para um código não obriga redirecionar toda falha de API.
- Na cópia compilada recuperada, um adaptador exclusivamente local apresenta as telas em falhas de navegação GET/HEAD; encaminha as demais respostas sem convertê-las para HTML. Não foi publicado no Railway.
- Erros de DNS, TLS e ausência total de rede podem ocorrer antes de qualquer página ser carregada; uma tela do aplicativo não substitui mensagens do navegador nesses casos.

- Toda consulta precisa prever carregamento, vazio, erro e sucesso.
- Diferenciar **sem conexão**, **pendente de envio**, **sincronizando**, **sincronizado** e **falha no envio**. Não comunicar sucesso remoto antes da confirmação do servidor.
- GPS informa indisponibilidade, permissão negada e idade da última posição. Push não deve parecer habilitado sem inscrição/permissão confirmadas.
- Português brasileiro, verbos diretos: “Salvar rota”, “Registrar entrega”, “Enviar comprovante”. Erros explicam o que aconteceu e a próxima ação possível.
- Ocorrências preservam as distinções do domínio: entregue, cliente ausente, endereço incorreto e recusada. Não inventar transições apenas para simplificar a interface.
- Telas e exportações seguem permissões reais do backend. Ocultar botão não substitui autorização.

## Impressão e exportação

- Documento impresso com fundo claro, contraste legível, título, filtros/período e identificação da rota ou relatório.
- Remover navegação e controles; conferir que tabelas, totais e unidades não sejam cortados.
- Exportação deve refletir a visão filtrada e distinguir ausência de dado de zero.

## Aplicação e aceite

Este guia é normativo para alterações futuras, mas não comprova implementação. A adoção ocorre por módulo, junto das correções funcionais.

1. Reconciliar a fonte publicada com o Git.
2. Integrar as correções mobile existentes, evitando reaplicar patches duplicados.
3. Padronizar painel comercial e Central operacional com os componentes e tokens existentes.
4. Revisar portal do motorista, estados offline, modais e mapas.
5. Conferir impressão e exportações.

Antes de declarar um módulo concluído:

- [ ] Fluxo principal conferido com backend real e perfil correspondente.
- [ ] Celular, tablet e desktop sem conteúdo inacessível ou página alargada.
- [ ] Temas claro/escuro, teclado e foco conferidos.
- [ ] Estados de carregamento, vazio, falha e ausência de conexão conferidos quando aplicáveis.
- [ ] Valores, rótulos, unidades e permissões preservados.
- [ ] Capturas e resultado da verificação registrados com o commit.

Atualizar este documento quando uma decisão visual compartilhada mudar. Registrar aqui a regra; manter detalhes de implementação no CSS/componentes e evidências no relatório de validação. Não criar um segundo guia divergente em outro checkout.
`nRevisão18/10: foco visível global3px azul; botões principais verdes #008060 com texto branco (contraste4,93:1), hover #006b50; mensagens de erro #9f1239 sobre #fff1f2; campos nativos acompanham o tema. Botões do conteúdo mobile com mínimo44px. Evidências e limites em revisao-ui-ux.md.
