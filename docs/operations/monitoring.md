# Monitoração operacional

Notificações Railway: Deployment.crashed, Deployment.failed e VolumeAlert.triggered, apenas para a conta do proprietário. Destinatário solicitado: secundariamarcosneto07@gmail.com. O proprietário confirmou recebimento de um alerta real de crash durante a configuração; o primeiro job de backup falhou por configuração libpq, corrigida e revalidada com restauração. Não era uma queda do aplicativo principal.

O serviço independente criar-rota-monitor roda a cada cinco minutos, verifica /api/health (conexão, routes e upload_objects), /api/health/monitor (token secreto, cinco falhas técnicas em cinco minutos) e backup restaurado há no máximo 36 horas. Faz três tentativas com intervalo de dez segundos. Registra falha nova, recuperação ou lembrete após seis horas; evita notificações iguais a cada execução.

Falha do monitor termina com código 1 para acionar alerta de crash do Railway. Um crash de teste comprovou a entrega de e-mail; não é garantia de entrega em todos os incidentes. O monitor depende do Railway e do bucket: uma indisponibilidade total do provedor também pode comprometer seus alertas.

Coleta técnica: erros de cliente, API, sincronização e upload; exige sessão, origem válida e limite de cinco eventos por minuto por usuário/empresa. Não coleta mensagens de erro livres, conteúdo de planilhas, imagens ou query strings. Caminhos têm identificadores removidos. /api/health é público; /api/health/monitor exige Bearer MONITOR_TOKEN.

Ao receber alerta: conferir serviço/deployment e logs estruturados (campos attributes, mesmo quando message está vazio), testar /api/health, verificar última restauração aprovada e comparar versão /api/version com o Git. Não reiniciar repetidamente nem restaurar sobre o banco ativo. Rollback deve usar versão conhecida e preservar dados.
