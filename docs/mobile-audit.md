# Revisão de responsividade — 15/10/2026

Base: `origin/main` em `22f68c6`. Correções na branch `codex/mobile-layout`, em checkout separado. O checkout antigo contém desenvolvimento comercial não commitado e não foi sobrescrito.

## Problemas reproduzidos e corrigidos

- Tela inicial: espaçamento de `8vw` dentro de uma coluna reduzia a área dos perfis; grades com mínimo intrínseco e cartões desalinhados agravavam a distribuição. Espaçamento limitado, colunas que podem encolher, cartões centralizados e composição em uma coluna até 900 px.
- Celular/tablet: regras móveis em 700 px e de desktop em 861 px deixavam uma faixa intermediária inconsistente. Navegação inferior unificada até 860 px, com arrasto horizontal e espaço reservado no conteúdo. O estado de menu recolhido do desktop não oculta os textos no celular. Removido o override por tela tátil que deslocava o conteúdo para baixo da barra lateral em tablets de 1024 px.
- Central operacional: as colunas de 210 px + botão consumiam a largura do formulário, fazendo o campo de mensagem desaparecer. O destinatário ocupa uma linha própria em telas estreitas.
- Histórico de rotas: filtros, motorista com nome longo e ações excediam a largura disponível. Filtros podem quebrar linhas; as ações vão para uma linha própria em áreas menores.
- Painéis: mínimos fixos de 160–280 px em grades aninhadas podiam superar o conteúdo disponível. Aplicado mínimo limitado a 100% do contêiner. Busca de notas e filtro de frete não competem com o botão de exportação no celular.
- Roteirizador: cabeçalho com altura fixa, botões de configuração sem quebra e passos largos. Cabeçalho flexível, ações com quebra e navegação dos passos com rolagem própria. Textos secundários da tabela agora usam as cores do tema em vez de branco semitransparente.
- Motorista: nome e ações comprimiam o cabeçalho; barra e botões do mapa tinham fundos brancos no tema escuro. Cabeçalho em grade e mapa com controles que quebram linhas, cores do tema e altura que acomoda os controles. Expandir/recolher mantém o mapa dentro do próprio componente.
- Pagamentos/modais: campos podem encolher, altura usa viewport dinâmica e controles de fechar têm nome acessível. Principais ações móveis têm área de toque de 44 px.
- Viewport: removido bloqueio de ampliação por gesto. Campos móveis continuam em 16 px para evitar zoom automático ao editar no iOS.

## Evidência

- 103 observações automatizadas no navegador Edge headless, em 320, 390, 768, 1024 e 1920 px. Incluem acesso, visão geral, Central operacional, pagamentos, SSW, histórico/detalhes, motoristas, veículos, upload/configuração/resultados/detalhe do roteirizador, planejador, comercial/notas e estado de menu recolhido. PIN, portal, pagamentos, rota ativa e comprovante do motorista foram percorridos em 320/390/768 px.
- Temas claro e escuro exercitados; capturas inspecionadas da tela inicial, Central operacional, comercial, configuração de carga, rota do motorista e comprovantes/pagamentos.
- Zero transbordamentos horizontais da página e zero exceções JavaScript nas 103 observações. Tabelas, passos e menus podem ter rolagem horizontal intencional dentro de seus contêineres.
- Campo da mensagem com largura útil e texto do menu móvel são verificados explicitamente.
- TypeScript e build de produção passaram.
- 31 testes de regras de pedido mínimo, parser, fotos e fila offline passaram.

Os testes de interface usam dados sintéticos e APIs interceptadas no navegador local. Não validam permissões reais do servidor, recebimento de push, localização de um aparelho físico, envio real de fotos/pagamentos ou disponibilidade dos serviços externos de mapas/SSW. Não houve deploy nesta revisão.

## Repetir

Inicie a aplicação local em `http://127.0.0.1:3135` e execute `node scripts/audit-responsive.cjs`. Requer Playwright e navegador Microsoft Edge disponíveis no ambiente de testes; `PLAYWRIGHT_MODULE_PATH` pode apontar para um módulo já instalado. Não adiciona dependências ao aplicativo.

Variáveis opcionais: `RESPONSIVE_BASE_URL` (somente localhost/127.0.0.1), `RESPONSIVE_WIDTHS` (larguras separadas por vírgula). JSON e capturas são gravados em `.tools/responsive-results/`, ignorado pelo Git. O comando termina com erro se detectar exceções JavaScript ou largura da página maior que a viewport.
